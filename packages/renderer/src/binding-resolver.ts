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
  /** 多项标量槽位(valueType 为 number/string/boolean 且 multiple)时:该项当前值(已按 valueType 整形) */
  value?: SlotValue
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
        // 多项槽位:每项一个 SeriesValue,槽位值为数组;任一项更新都整体重设(数组小,直接复制)
        const scalar = spec?.valueType === 'number' || spec?.valueType === 'string' || spec?.valueType === 'boolean'
        const series: SeriesValue[] = list.map((one, i) => ({
          name: seriesName(one, i),
          entity: entityOf(one),
          points: [],
          ...(scalar ? { value: null } : {}),
        }))
        set(w.id, slot, series.slice())
        list.forEach((one, i) => {
          bindSeries(one, w, slot, spec, pts => {
            series[i]!.points = pts
            if (scalar) series[i]!.value = shapeScalar(lastValue(pts), spec?.valueType)
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
                ds.subscribeTs(
                  one.entity,
                  [one.key],
                  ups => {
                    const u = ups.find(x => x.key === one.key)
                    if (u) set(w.id, slot, shapeScalar(lastValue(u.points), spec?.valueType))
                  },
                  e => fail(w.id, slot, e)
                )
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
                ds.subscribeAttr(
                  one.entity,
                  one.scope,
                  [one.key],
                  ups => {
                    const u = ups.find(x => x.key === one.key)
                    if (u) set(w.id, slot, shapeScalar(u.value as TsPoint['value'], spec?.valueType))
                  },
                  e => fail(w.id, slot, e)
                )
              )
            } catch (e) {
              fail(w.id, slot, e)
            }
            break
          }
          case 'alarm': {
            set(w.id, slot, [] as AlarmInfo[])
            try {
              track(
                ds.subscribeAlarms(
                  one.entity,
                  one.types,
                  alarms => set(w.id, slot, alarms),
                  e => fail(w.id, slot, e)
                )
              )
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
      if (Array.isArray(one.value)) emit(one.value as TsPoint[])
      else if (one.value !== null && one.value !== undefined && typeof one.value !== 'object')
        emit([{ ts: 0, value: one.value as TsPoint['value'] }])
      else emit([])
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
      // 一条绑定 = 一条序列(上面 multiple 槽位是 list.map 出的 SeriesValue,按绑定条数走)。
      // 早期编辑器让人在一条绑定里加多个测点,多出来的会被悄悄丢掉 —— 现在至少喊一声(审查 R3)。
      // 编辑器与校验层已经拦住新建这种配置,这里只面对历史遗留页面,所以不改渲染行为、不让整个组件报错。
      if (one.keys.length > 1)
        console.warn(
          `[scada-renderer] ${w.id}/${slot}:一条历史曲线绑定只画一条序列,只用第一个测点「${one.keys[0]}」;` +
            `多余的 ${one.keys.slice(1).join('、')} 被忽略。要画多条请在该槽位配多条绑定。`
        )
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
              ds.subscribeTs(
                one.entity,
                [key],
                ups => {
                  const u = ups.find(x => x.key === key)
                  if (!u) return
                  // 追加时按 ts 去重:订阅首包的「最新值」可能与历史末点重复
                  const lastTs = buf.length ? buf[buf.length - 1]!.ts : -Infinity
                  const fresh = u.points.filter(pt => pt.ts > lastTs)
                  if (!fresh.length) return
                  buf.push(...fresh)
                  if (buf.length > maxPoints) buf = buf.slice(buf.length - maxPoints)
                  emit(buf.slice())
                },
                e => fail(w.id, slot, e)
              )
            )
          } catch (e) {
            fail(w.id, slot, e)
          }
        })
        .catch(e => fail(w.id, slot, e))
      return
    }
    // 标量 mode 出现在序列 / 多项槽位:实时推送累积成点列(按 ts 去重、maxPoints 截断);
    // 多项标量槽位(概览卡 items)由调用方取最后一点整形为 value
    let acc: TsPoint[] = []
    const append = (pts: TsPoint[]) => {
      const lastTs = acc.length ? acc[acc.length - 1]!.ts : -Infinity
      const fresh = pts.filter(pt => pt.ts > lastTs)
      if (!fresh.length) return
      acc = acc.concat(fresh)
      if (acc.length > maxPoints) acc = acc.slice(acc.length - maxPoints)
      emit(acc.slice())
    }
    if (one.mode === 'ts') {
      try {
        track(
          ds.subscribeTs(
            one.entity,
            [one.key],
            ups => {
              const u = ups.find(x => x.key === one.key)
              if (u) append(u.points)
            },
            e => fail(w.id, slot, e)
          )
        )
      } catch (e) {
        fail(w.id, slot, e)
      }
      return
    }
    if (one.mode === 'attr') {
      try {
        track(
          ds.subscribeAttr(
            one.entity,
            one.scope,
            [one.key],
            ups => {
              const u = ups.find(x => x.key === one.key)
              if (u) append([{ ts: u.ts, value: u.value as TsPoint['value'] }])
            },
            e => fail(w.id, slot, e)
          )
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
    case 'ext': {
      // 图例名:业务统计用 metric(inc / cost / net);通用历史用第一个 key;都没有才退到 kz-<序号>
      const p = b.params as { metric?: unknown; keys?: unknown }
      const key = Array.isArray(p.keys) ? p.keys[0] : undefined
      return String(p.metric ?? key ?? `${b.source}-${i}`)
    }
    default:
      return `series-${i}`
  }
}
function entityOf(b: Binding): EntityRef | undefined {
  return 'entity' in b ? b.entity : undefined
}
