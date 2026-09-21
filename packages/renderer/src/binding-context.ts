/**
 * 绑定上下文(0.9.0,方案讨论-BindingContext-2026-09-21):把绑定里「取自上下文」的实体 / 测点 / 时间范围
 * 换成具体值。不依赖 Vue——`applyContext()` 是纯函数,Vitest 里直接断言;响应式与按组件重订在 widget-runtime。
 *
 * 分工:宿主只管给上下文(当前站点 / 设备 / 测点 / 时间范围),渲染器只读不写;组件想让宿主换设备,
 * 抛 widget-event,由宿主自己改上下文。上下文经 props / provide 传递,限定在组件树内,没有全局单例。
 */
import type { AbsoluteRange, EntityRef } from '@grid/tb-client'
import type {
  AlarmBinding,
  AttrBinding,
  Binding,
  ConstBinding,
  ContextEntityRef,
  ContextKeyRef,
  ContextWindowRef,
  ExtBinding,
  TsBinding,
  TsHistoryBinding,
  WhenMissing,
  WidgetConfig,
} from './schema/page-config'

/** 测点:key 加可选的显示名 / 单位(显示名会成为曲线图例、表格列名) */
export interface MeasurePoint {
  key: string
  label?: string
  unit?: string
}

/** 上下文里的时间范围:窗口字面量('24h'),或绝对区间;起止可以是毫秒、ISO 字符串或 Date */
export type ContextTimeRange = string | { from: number | string | Date; to: number | string | Date }

/**
 * 宿主提供的上下文。标准键四个 + 预留的 selectedAlarm;其余业务键放 `custom` 下。
 * 登录用户、权限不放这里(归宿主的认证模块)。值为 null / undefined = 没选。
 */
export interface BindingContext {
  selectedSite?: EntityRef | null
  selectedDevice?: EntityRef | null
  selectedMeasurePoint?: string | MeasurePoint | null
  timeRange?: ContextTimeRange | null
  /** 预留:告警列表联动详情时用;一期没有绑定会读它 */
  selectedAlarm?: unknown
  /** 自定义键:值的形状同上(实体 / 测点 / 时间范围),由引用它的绑定位置决定怎么解释 */
  custom?: Record<string, unknown>
}

// ───────── 解析后的「具体绑定」:解析器只认这种 ─────────
export type ConcreteTs = Omit<TsBinding, 'entity' | 'key'> & { entity: EntityRef; key: string; label?: string }
export type ConcreteTsHistory = Omit<TsHistoryBinding, 'entity' | 'keys' | 'window'> & {
  entity: EntityRef
  keys: string[]
  window: string | AbsoluteRange
  label?: string
}
export type ConcreteAttr = Omit<AttrBinding, 'entity' | 'key'> & { entity: EntityRef; key: string; label?: string }
export type ConcreteAlarm = Omit<AlarmBinding, 'entity'> & { entity: EntityRef }
export type ConcreteExt = Omit<ExtBinding, 'window'> & { window?: string; range?: AbsoluteRange }
export type ConcreteBinding = ConcreteTs | ConcreteTsHistory | ConcreteAttr | ConcreteAlarm | ConstBinding | ConcreteExt
export type ConcreteWidget = Omit<WidgetConfig, 'bindings'> & {
  bindings: Record<string, ConcreteBinding | ConcreteBinding[]>
}

export type ContextStatus = 'ok' | 'empty' | 'hide' | 'error'

export interface ContextResolution {
  status: ContextStatus
  /** status 为 ok 时:绑定已全部换成具体值的组件配置 */
  widget?: ConcreteWidget
  /** 非 ok 时给人看的一句话(「未选择设备」/「上下文 selectedDevice 需要 DEVICE,给的是 ASSET」) */
  message?: string
  /** 这张卡引用了哪些上下文键(去重,按出现顺序) */
  keys: string[]
}

export const isContextRef = (x: unknown): x is { source: 'context'; key: string } =>
  !!x &&
  typeof x === 'object' &&
  (x as { source?: unknown }).source === 'context' &&
  typeof (x as { key?: unknown }).key === 'string'

/** 按键取值:`custom.xxx` 去 custom 下找,其余取顶层 */
export function lookupContext(ctx: BindingContext | null | undefined, key: string): unknown {
  if (!ctx) return undefined
  if (key.startsWith('custom.')) return ctx.custom?.[key.slice(7)]
  return (ctx as Record<string, unknown>)[key]
}

const MISSING_TEXT: Record<string, string> = {
  selectedSite: '未选择站点',
  selectedDevice: '未选择设备',
  selectedMeasurePoint: '未选择测点',
  timeRange: '未选择时间范围',
}
const missingText = (key: string) => MISSING_TEXT[key] ?? `未提供「${key.replace(/^custom\./, '')}」`

const WINDOW_RE = /^\d+(m|h|d)$/
const toMs = (v: unknown): number =>
  v instanceof Date ? v.getTime() : typeof v === 'string' ? Date.parse(v) : Number(v)

/** 一处引用的解析结果:具体值,或「缺了 / 错了」 */
type Got<T> = { ok: T; label?: string } | { miss: Exclude<WhenMissing, 'fallback'>; key: string } | { err: string }

function whenMissing<T>(
  ref: { key: string; whenMissing?: WhenMissing; fallback?: unknown },
  useFallback: (f: unknown) => Got<T>
): Got<T> {
  const mode = ref.whenMissing ?? 'empty'
  if (mode !== 'fallback') return { miss: mode, key: ref.key }
  if (ref.fallback === undefined || ref.fallback === null)
    return { err: `上下文 ${ref.key} 配了 whenMissing: "fallback" 却没给 fallback` }
  return useFallback(ref.fallback)
}

function entityFrom(v: unknown, where: string, want?: 'DEVICE' | 'ASSET'): Got<EntityRef> {
  const e = v as Partial<EntityRef> | null
  if (!e || typeof e !== 'object' || (e.type !== 'DEVICE' && e.type !== 'ASSET') || typeof e.id !== 'string' || !e.id)
    return { err: `${where} 不是有效的实体(要 { type: 'DEVICE' | 'ASSET', id })` }
  if (want && e.type !== want) return { err: `${where} 需要 ${want},给的是 ${e.type}` }
  return { ok: { type: e.type, id: e.id, ...(typeof e.name === 'string' && e.name ? { name: e.name } : {}) } }
}

function resolveEntity(src: EntityRef | ContextEntityRef, ctx: BindingContext | null | undefined): Got<EntityRef> {
  if (!isContextRef(src)) return { ok: src }
  const v = lookupContext(ctx, src.key)
  if (v === null || v === undefined) return whenMissing(src, f => entityFrom(f, `${src.key} 的 fallback`, src.type))
  return entityFrom(v, `上下文 ${src.key}`, src.type)
}

function keyFrom(v: unknown, where: string): Got<string> {
  if (typeof v === 'string' && v) return { ok: v }
  const m = v as Partial<MeasurePoint> | null
  if (m && typeof m === 'object' && typeof m.key === 'string' && m.key)
    return { ok: m.key, ...(typeof m.label === 'string' && m.label ? { label: m.label } : {}) }
  return { err: `${where} 不是有效的测点(要 key 字符串或 { key, label? })` }
}

function resolveKey(src: string | ContextKeyRef, ctx: BindingContext | null | undefined): Got<string> {
  if (!isContextRef(src)) return { ok: src as string }
  const v = lookupContext(ctx, src.key)
  if (v === null || v === undefined || v === '') return whenMissing(src, f => keyFrom(f, `${src.key} 的 fallback`))
  return keyFrom(v, `上下文 ${src.key}`)
}

function windowFrom(v: unknown, where: string): Got<string | AbsoluteRange> {
  if (typeof v === 'string')
    return WINDOW_RE.test(v) ? { ok: v } : { err: `${where}「${v}」不是有效的时间窗口(如 24h / 7d)` }
  if (v && typeof v === 'object' && 'from' in v && 'to' in v) {
    const from = toMs((v as { from: unknown }).from)
    const to = toMs((v as { to: unknown }).to)
    if (!Number.isFinite(from) || !Number.isFinite(to)) return { err: `${where} 的起止时间无法识别` }
    if (from >= to) return { err: `${where} 的起始时间必须早于结束时间` }
    return { ok: { from, to } }
  }
  return { err: `${where} 不是有效的时间范围(要 '24h' 这样的窗口或 { from, to })` }
}

function resolveWindow(
  src: string | AbsoluteRange | ContextWindowRef,
  ctx: BindingContext | null | undefined
): Got<string | AbsoluteRange> {
  if (!isContextRef(src)) return typeof src === 'string' ? { ok: src } : windowFrom(src, '时间范围')
  const v = lookupContext(ctx, src.key)
  if (v === null || v === undefined || v === '') return whenMissing(src, f => windowFrom(f, `${src.key} 的 fallback`))
  return windowFrom(v, `上下文 ${src.key}`)
}

/** 一条绑定引用的上下文键 */
function refsOf(b: Binding): string[] {
  const out: string[] = []
  const add = (x: unknown) => {
    if (isContextRef(x)) out.push(x.key)
  }
  if ('entity' in b) add(b.entity)
  if (b.mode === 'ts' || b.mode === 'attr') add(b.key)
  if (b.mode === 'ts-history') b.keys.forEach(add)
  if (b.mode === 'ts-history' || b.mode === 'ext') add(b.window)
  if (b.mode === 'ext') {
    add(b.params?.entity)
    if (Array.isArray(b.params?.keys)) b.params.keys.forEach(add)
  }
  return out
}

/** 一组组件引用了哪些上下文键(去重):宿主据此决定要不要显示设备 / 时间选择器 */
export function contextKeysOf(widgets: Pick<WidgetConfig, 'bindings'>[]): string[] {
  const seen = new Set<string>()
  for (const w of widgets)
    for (const b of Object.values(w.bindings ?? {}))
      for (const one of Array.isArray(b) ? b : [b]) for (const k of refsOf(one)) seen.add(k)
  return [...seen]
}

/** 这组组件眼里的上下文「指纹」:只含被引用的键,值变了指纹才变(响应式层拿它当 watch 源) */
export function contextSignature(
  widgets: Pick<WidgetConfig, 'bindings'>[],
  ctx: BindingContext | null | undefined
): string {
  return JSON.stringify(contextKeysOf(widgets).map(k => [k, lookupContext(ctx, k) ?? null]))
}

const SEVERITY: Record<Exclude<ContextStatus, 'ok'>, number> = { empty: 1, hide: 2, error: 3 }

/**
 * 把一张卡的绑定换成具体值。任何一处引用缺了,整张卡按该引用的 whenMissing 处理(多处同时缺时取最重的:
 * error > hide > empty)——卡片是最小的显示单位,半张有数半张空着比整张空态更让人困惑。
 * 没有任何上下文引用的卡原样返回(同一个对象),零开销。
 */
export function applyContext(w: WidgetConfig, ctx: BindingContext | null | undefined): ContextResolution {
  const keys = contextKeysOf([w])
  if (!keys.length) return { status: 'ok', widget: w as ConcreteWidget, keys }

  let worst: { status: Exclude<ContextStatus, 'ok'>; message: string } | null = null
  const note = (status: Exclude<ContextStatus, 'ok'>, message: string) => {
    if (!worst || SEVERITY[status] > SEVERITY[worst.status]) worst = { status, message }
  }
  function take<T>(g: Got<T>): { v: T; label?: string } | null {
    if ('ok' in g) return { v: g.ok, ...(g.label ? { label: g.label } : {}) }
    if ('miss' in g) note(g.miss, g.miss === 'error' ? `${missingText(g.key)}(上下文缺 ${g.key})` : missingText(g.key))
    else note('error', g.err)
    return null
  }

  const one = (b: Binding): ConcreteBinding | null => {
    switch (b.mode) {
      case 'const':
        return b
      case 'ts':
      case 'attr': {
        const e = take(resolveEntity(b.entity, ctx))
        const k = take(resolveKey(b.key, ctx))
        return e && k ? { ...b, entity: e.v, key: k.v, ...(k.label ? { label: k.label } : {}) } : null
      }
      case 'alarm': {
        const e = take(resolveEntity(b.entity, ctx))
        return e ? { ...b, entity: e.v } : null
      }
      case 'ts-history': {
        const e = take(resolveEntity(b.entity, ctx))
        const ks = b.keys.map(k => take(resolveKey(k, ctx)))
        const win = take(resolveWindow(b.window, ctx))
        if (!e || !win || ks.some(k => !k)) return null
        const label = ks[0]!.label
        return { ...b, entity: e.v, keys: ks.map(k => k!.v), window: win.v, ...(label ? { label } : {}) }
      }
      case 'ext': {
        const { window: rawWindow, ...rest } = b
        let params = b.params
        let okAll = true
        if (isContextRef(params?.entity)) {
          const e = take(resolveEntity(params.entity as ContextEntityRef, ctx))
          if (e) params = { ...params, entity: e.v }
          else okAll = false
        }
        if (Array.isArray(params?.keys) && params.keys.some(isContextRef)) {
          const ks = (params.keys as unknown[]).map(k =>
            isContextRef(k) ? take(resolveKey(k as ContextKeyRef, ctx)) : { v: k }
          )
          if (ks.every(Boolean)) params = { ...params, keys: ks.map(k => k!.v) }
          else okAll = false
        }
        let win: string | AbsoluteRange | undefined
        if (rawWindow !== undefined) {
          const got = take(resolveWindow(rawWindow, ctx))
          if (got) win = got.v
          else okAll = false
        }
        if (!okAll) return null
        return {
          ...rest,
          params,
          ...(typeof win === 'string' ? { window: win } : {}),
          ...(win && typeof win === 'object' ? { range: win } : {}),
        }
      }
    }
  }

  const bindings: ConcreteWidget['bindings'] = {}
  for (const [slot, b] of Object.entries(w.bindings)) {
    if (Array.isArray(b)) {
      const list = b.map(one)
      if (list.every(Boolean)) bindings[slot] = list as ConcreteBinding[]
    } else {
      const c = one(b)
      if (c) bindings[slot] = c
    }
  }
  if (worst) {
    const { status, message } = worst as { status: Exclude<ContextStatus, 'ok'>; message: string }
    return { status, message, keys }
  }
  return { status: 'ok', widget: { ...w, bindings }, keys }
}
