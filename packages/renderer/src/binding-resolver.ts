/**
 * 绑定解析器:把一份 PageConfig 的 bindings 翻译成对 DataSource 的订阅 / 查询,产出按 (widgetId, slotName) 组织的槽位值。
 * 不依赖 Vue(可在 Vitest 里用 MockDataSource 直接断言);<ScadaPage> 用 useBindings() 把它接进响应式状态。
 *
 * 按 mode 分派(架构 §8「绑定解析器」):
 *   ts         → subscribeTs(首包给最新值)          → number | string | boolean
 *   ts-history → getHistory 后 subscribeTs 追加        → SeriesValue
 *   attr       → subscribeAttr                          → 值
 *   alarm      → subscribeAlarms                        → AlarmInfo[]
 *   const      → 直接注入
 *   ext        → ds.ext(query)(一次性;不订阅)        → SeriesValue[](按返回的序列名)
 * 卸载时全部退订;退订次数 == 订阅次数由测试保证。
 */
import type { DataSource, TsPoint, AlarmInfo, Unsubscribe, EntityRef } from '@grid/tb-client'
import type { PageConfig, Binding, WidgetConfig } from './schema/page-config'
import type { BindingSlotSpec, SlotValueType } from './schema/registry'

export interface SeriesValue {
  /** 序列名:key(ts-history)或 ext 返回的序列名 */
  name: string
  entity?: EntityRef
  points: TsPoint[]
}

export type SlotValue = number | string | boolean | null | SeriesValue | SeriesValue[] | AlarmInfo[] | unknown

export interface ResolverHandle {
  /** 当前值:values[widgetId][slotName] */
  readonly values: Record<string, Record<string, SlotValue>>
  /** 退订全部 */
  dispose(): void
  /** 统计(测试 / 排障用) */
  readonly stats: { subscriptions: number; unsubscribed: number; errors: number }
}

export interface ResolverOptions {
  /** 值变化回调(响应式层在这里 set) */
  onValue: (widgetId: string, slot: string, value: SlotValue) => void
  /** 单个绑定出错(网络 / 403 / 未实现 ext):不影响其他绑定 */
  onError?: (widgetId: string, slot: string, err: unknown) => void
  /** 槽位规格查找:决定值怎么整形;缺省按 mode 猜 */
  slotSpec?: (widget: WidgetConfig, slot: string) => BindingSlotSpec | undefined
  /** 历史点数上限,超出丢弃最早的(防内存增长) */
  maxPoints?: number
}

const lastValue = (points: TsPoint[]): TsPoint['value'] => (points.length ? points[points.length - 1]!.value : null)

function shapeScalar(v: TsPoint['value'], vt: SlotValueType | undefined): SlotValue {
  if (v === null || v === undefined) return null
  switch (vt) {
    case 'number': {
      const n = typeof v === 'number' ? v : Number(v)
      return Number.isFinite(n) ? n : null
    }
    case 'boolean':
      return typeof v === 'boolean' ? v : v === 1 || v === '1' || v === 'true'
    case 'string':
      return String(v)
    default:
      return v
  }
}

export function resolveBindings(config: PageConfig, ds: DataSource, opts: ResolverOptions): ResolverHandle {
  const values: Record<string, Record<string, SlotValue>> = {}
  const unsubs: Unsubscribe[] = []
  const stats = { subscriptions: 0, unsubscribed: 0, errors: 0 }
  const maxPoints = opts.maxPoints ?? 5000
  let disposed = false

  const set = (wid: string, slot: string, v: SlotValue) => {
    ;(values[wid] ??= {})[slot] = v
    opts.onValue(wid, slot, v)
  }
  const fail = (wid: string, slot: string, err: unknown) => {
    stats.errors++
    opts.onError?.(wid, slot, err)
  }
  const track = (u: Unsubscribe) => {
    stats.subscriptions++
    unsubs.push(() => {
      stats.unsubscribed++
      u()
    })
  }

  for (const w of config.widgets) {
    for (const [slot, b] of Object.entries(w.bindings)) {
      const spec = opts.slotSpec?.(w, slot)
      const list = Array.isArray(b) ? b : [b]
      const multiple = Array.isArray(b)
      if (multiple) {
        // 多序列:每项一个 SeriesValue,槽位值为数组;任一项更新都整体重设(数组小,直接复制)
        const series: SeriesValue[] = list.map((one, i) => ({
          name: seriesName(one, i),
          entity: entityOf(one),
          points: [],
        }))
        set(w.id, slot, series.slice())
        list.forEach((one, i) => {
          bindSeries(one, w, slot, spec, pts => {
            series[i]!.points = pts
            set(w.id, slot, series.slice())
          })
        })
      } else {
        const one = list[0]!
        switch (one.mode) {
          case 'const':
            set(w.id, slot, one.value as SlotValue)
            break
          case 'ts': {
            set(w.id, slot, null)
            try {
              track(
                ds.subscribeTs(one.entity, [one.key], ups => {
                  const u = ups.find(x => x.key === one.key)
                  if (u) set(w.id, slot, shapeScalar(lastValue(u.points), spec?.valueType))
                })
              )
            } catch (e) {
              fail(w.id, slot, e)
            }
            break
          }
          case 'attr': {
            set(w.id, slot, null)
            try {
              track(
                ds.subscribeAttr(one.entity, one.scope, [one.key], ups => {
                  const u = ups.find(x => x.key === one.key)
                  if (u) set(w.id, slot, shapeScalar(u.value as TsPoint['value'], spec?.valueType))
                })
              )
            } catch (e) {
              fail(w.id, slot, e)
            }
            break
          }
          case 'alarm': {
            set(w.id, slot, [] as AlarmInfo[])
            try {
              track(ds.subscribeAlarms(one.entity, one.types, alarms => set(w.id, slot, alarms)))
            } catch (e) {
              fail(w.id, slot, e)
            }
            break
          }
          case 'ts-history':
          case 'ext': {
            const sv: SeriesValue = { name: seriesName(one, 0), entity: entityOf(one), points: [] }
            set(w.id, slot, sv)
            bindSeries(one, w, slot, spec, pts => set(w.id, slot, { ...sv, points: pts }))
            break
          }
        }
      }
    }
  }

  function bindSeries(
    one: Binding,
    w: WidgetConfig,
    slot: string,
    _spec: BindingSlotSpec | undefined,
    emit: (pts: TsPoint[]) => void
  ) {
    if (one.mode === 'const') {
      emit(Array.isArray(one.value) ? (one.value as TsPoint[]) : [])
      return
    }
    if (one.mode === 'ext') {
      if (!ds.ext) {
        fail(w.id, slot, new Error('DataSource 未实现 ext()'))
        return
      }
      ds.ext({ source: one.source, window: one.window, interval: one.interval, params: one.params })
        .then(r => {
          if (disposed) return
          const first = Object.values(r.series)[0] ?? []
          emit(first)
        })
        .catch(e => fail(w.id, slot, e))
      return
    }
    if (one.mode === 'ts-history') {
      const key = one.keys[0]!
      let buf: TsPoint[] = []
      ds.getHistory(one.entity, one.keys, one.window, one.agg)
        .then(h => {
          if (disposed) return
          buf = (h[key] ?? []).slice()
          emit(buf.slice())
          // 历史拉完再订阅追加,避免乱序
          try {
            track(
              ds.subscribeTs(one.entity, [key], ups => {
                const u = ups.find(x => x.key === key)
                if (!u) return
                // 追加时按 ts 去重:订阅首包的「最新值」可能与历史末点重复
                const lastTs = buf.length ? buf[buf.length - 1]!.ts : -Infinity
                const fresh = u.points.filter(pt => pt.ts > lastTs)
                if (!fresh.length) return
                buf.push(...fresh)
                if (buf.length > maxPoints) buf = buf.slice(buf.length - maxPoints)
                emit(buf.slice())
              })
            )
          } catch (e) {
            fail(w.id, slot, e)
          }
        })
        .catch(e => fail(w.id, slot, e))
      return
    }
    // ts / attr / alarm 出现在多序列槽位:按单值当作长度 1 的序列(容错,不推荐)
    if (one.mode === 'ts') {
      try {
        track(
          ds.subscribeTs(one.entity, [one.key], ups => {
            const u = ups.find(x => x.key === one.key)
            if (u) emit(u.points.slice())
          })
        )
      } catch (e) {
        fail(w.id, slot, e)
      }
    }
  }

  return {
    values,
    stats,
    dispose() {
      if (disposed) return
      disposed = true
      for (const u of unsubs.splice(0)) {
        try {
          u()
        } catch {
          /* ignore */
        }
      }
    },
  }
}

function seriesName(b: Binding, i: number): string {
  switch (b.mode) {
    case 'ts':
      return b.key
    case 'ts-history':
      return b.keys[0] ?? `series-${i}`
    case 'attr':
      return b.key
    case 'ext':
      return String((b.params as Record<string, unknown>).metric ?? `${b.source}-${i}`)
    default:
      return `series-${i}`
  }
}
function entityOf(b: Binding): EntityRef | undefined {
  return 'entity' in b ? b.entity : undefined
}
