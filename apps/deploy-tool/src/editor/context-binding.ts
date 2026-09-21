/**
 * 「跟随页面上下文」的绑定(渲染器 0.9.0 BindingContext)在编辑器这一侧的读写助手。纯函数,不依赖 Vue。
 *
 * 编辑器的老代码(完整性检查、测点列表、发布前的存在性核对)都假设绑定里是「具体的实体 + 测点 + 窗口」。
 * 上下文绑定没有具体值,但有**样例**(fallback):编辑器用样例挑测点、出预览、做存在性核对。
 * 所以统一走 `sampleBinding()` 把上下文引用换成样例值,老代码看到的还是熟悉的形状。
 */
import { isContextRef } from '@grid/scada-renderer'
import type { Binding, BindingContext, ConcreteBinding, WhenMissing } from '@grid/scada-renderer'
import type { EntityRef } from '@grid/tb-client'

/** 绑定面板下拉里给的实体上下文键;其余业务键走 custom.xxx 手填 */
export const ENTITY_CONTEXT_KEYS: { key: string; label: string; type: 'DEVICE' | 'ASSET' | undefined }[] = [
  { key: 'selectedDevice', label: '当前设备', type: 'DEVICE' },
  { key: 'selectedSite', label: '当前站点', type: undefined },
]
export const MEASURE_POINT_KEY = 'selectedMeasurePoint'
export const TIME_RANGE_KEY = 'timeRange'
export const WHEN_MISSING: { value: WhenMissing; label: string }[] = [
  { value: 'empty', label: '显示「未选择」空态' },
  { value: 'hide', label: '整张卡不显示' },
  { value: 'error', label: '显示错误' },
  { value: 'fallback', label: '用样例值' },
]
/** 自定义键的写法:custom.<名字> */
export const CUSTOM_KEY_RE = /^custom\.[A-Za-z][A-Za-z0-9_]*$/

type Ref = { source: 'context'; key: string; fallback?: unknown; whenMissing?: WhenMissing; type?: string }
type Loose = Record<string, unknown>
const asLoose = (b: Binding | null | undefined): Loose => (b ?? {}) as unknown as Loose
const paramsOf = (b: Binding | null | undefined): Loose => (asLoose(b).params ?? {}) as Loose

/** 绑定里实体那一格的原始内容(固定实体或上下文引用);ext 在 params.entity */
export function entitySourceOf(b: Binding | null | undefined): unknown {
  if (!b) return undefined
  return b.mode === 'ext' ? paramsOf(b).entity : asLoose(b).entity
}
/** 测点那一格的原始内容:ts / attr 的 key,ts-history 的 keys[0],ext 的 params.keys[0] */
export function keySourceOf(b: Binding | null | undefined): unknown {
  if (!b) return undefined
  if (b.mode === 'ts' || b.mode === 'attr') return asLoose(b).key
  if (b.mode === 'ts-history') return (asLoose(b).keys as unknown[] | undefined)?.[0]
  if (b.mode === 'ext') return (paramsOf(b).keys as unknown[] | undefined)?.[0]
  return undefined
}
export const windowSourceOf = (b: Binding | null | undefined): unknown => asLoose(b).window

/** 这条绑定里全部上下文引用 */
export function contextRefsOf(b: Binding | null | undefined): Ref[] {
  if (!b) return []
  const out: Ref[] = []
  const add = (x: unknown) => {
    if (isContextRef(x)) out.push(x as Ref)
  }
  add(entitySourceOf(b))
  if (b.mode === 'ts' || b.mode === 'attr') add(asLoose(b).key)
  for (const k of (asLoose(b).keys as unknown[] | undefined) ?? []) add(k)
  for (const k of (paramsOf(b).keys as unknown[] | undefined) ?? []) add(k)
  add(windowSourceOf(b))
  return out
}
export const usesContext = (b: Binding | null | undefined): boolean => contextRefsOf(b).length > 0

/** 实体的样例:固定实体就是它自己;上下文引用取 fallback(没给就是 undefined) */
export function sampleEntityOf(src: unknown): EntityRef | undefined {
  if (isContextRef(src)) return (src as Ref).fallback as EntityRef | undefined
  return src as EntityRef | undefined
}
export const sampleKeyOf = (src: unknown): string => sampleKeyOfRaw(src)
const sampleKeyOfRaw = (src: unknown): string =>
  isContextRef(src) ? String((src as Ref).fallback ?? '') : typeof src === 'string' ? src : ''
/** 窗口的样例:只回字面量;绝对区间 / 没给样例回 '' */
export function sampleWindowOf(src: unknown): string {
  const v = isContextRef(src) ? (src as Ref).fallback : src
  return typeof v === 'string' ? v : ''
}

/**
 * 把上下文引用换成样例值,得到一条「具体」的绑定给老代码用(完整性、测点类型、存在性核对、预览)。
 * 没给样例的地方:实体留空 id、测点留空串、窗口回 24h。
 */
export function sampleBinding(b: Binding, opts?: { placeholder?: boolean }): ConcreteBinding
export function sampleBinding(b: Binding | null | undefined, opts?: { placeholder?: boolean }): ConcreteBinding | null
export function sampleBinding(
  b: Binding | null | undefined,
  opts: { placeholder?: boolean } = {}
): ConcreteBinding | null {
  if (!b) return null
  if (!usesContext(b)) return b as ConcreteBinding
  // placeholder:没给样例的地方填占位(只用于「形状填完整了吗」的判断,不拿去查 TB)
  const hole = opts.placeholder ? '(context)' : ''
  const ent = (src: unknown): EntityRef =>
    sampleEntityOf(src) ?? { type: ((src as Ref).type as EntityRef['type']) ?? 'DEVICE', id: hole, name: '' }
  const sampleKeyOf = (src: unknown): string => sampleKeyOfRaw(src) || hole
  const next: Loose = { ...asLoose(b) }
  if (isContextRef(next.entity)) next.entity = ent(next.entity)
  if (isContextRef(next.key)) next.key = sampleKeyOf(next.key)
  if (Array.isArray(next.keys)) next.keys = next.keys.map(k => (isContextRef(k) ? sampleKeyOf(k) : k)).filter(Boolean)
  if (isContextRef(next.window)) next.window = sampleWindowOf(next.window) || '24h'
  if (b.mode === 'ext') {
    const p = { ...paramsOf(b) }
    if (isContextRef(p.entity)) p.entity = ent(p.entity)
    if (Array.isArray(p.keys)) p.keys = p.keys.map(k => (isContextRef(k) ? sampleKeyOf(k) : k)).filter(Boolean)
    next.params = p
  }
  return next as unknown as ConcreteBinding
}

/**
 * 上下文绑定是否填完整:引用的键名合法即可——样例不是必填(没有样例只是编辑器里挑不了测点、看不了预览);
 * 但 whenMissing 选了「用样例值」就必须给样例。固定的那部分仍按老规则(由调用方对 sampleBinding 的结果判断)。
 */
export function contextProblems(b: Binding | null | undefined): string[] {
  const out: string[] = []
  for (const r of contextRefsOf(b)) {
    if (!r.key) out.push('上下文键没填')
    else if (r.key.startsWith('custom.') && !CUSTOM_KEY_RE.test(r.key))
      out.push(`自定义键「${r.key}」写法不对(要 custom.名字,名字以字母开头)`)
    if (r.whenMissing === 'fallback' && (r.fallback === undefined || r.fallback === null || r.fallback === ''))
      out.push(`「${r.key}」选了缺省时用样例值,但还没给样例`)
  }
  return out
}

// ───────── 写 ─────────

const put = (b: Binding, patch: Loose): Binding => {
  const next = { ...asLoose(b), ...patch }
  for (const k of Object.keys(next)) if (next[k] === undefined) delete next[k]
  return next as unknown as Binding
}
const putParams = (b: Binding, patch: Loose): Binding => put(b, { params: { ...paramsOf(b), ...patch } })
const setEntitySource = (b: Binding, src: unknown): Binding =>
  b.mode === 'ext' ? putParams(b, { entity: src }) : put(b, { entity: src })

/** 实体:固定 ⇄ 跟随上下文。切过去时当前实体留作样例;切回来时样例变回固定实体 */
export function setEntityFollows(b: Binding, key: string | null): Binding {
  const cur = entitySourceOf(b)
  if (key === null) {
    if (!isContextRef(cur)) return b
    return setEntitySource(b, sampleEntityOf(cur) ?? { type: 'DEVICE', id: '', name: '' })
  }
  const known = ENTITY_CONTEXT_KEYS.find(k => k.key === key)
  const sample = sampleEntityOf(cur)
  const prev = isContextRef(cur) ? (cur as Ref) : null
  return setEntitySource(b, {
    source: 'context',
    key,
    ...(known?.type ? { type: known.type } : {}),
    ...(sample?.id || sample?.name ? { fallback: sample } : {}),
    ...(prev?.whenMissing ? { whenMissing: prev.whenMissing } : {}),
  })
}

/** 选了一个实体:固定绑定直接换;上下文绑定换的是样例 */
export function withPickedEntity(src: unknown, e: EntityRef): unknown {
  return isContextRef(src) ? { ...(src as Ref), fallback: e } : e
}

/** 选了一个测点:固定的直接是字符串;跟随上下文的写进样例 */
export function withPickedKey(src: unknown, key: string): unknown {
  return isContextRef(src) ? { ...(src as Ref), fallback: key || undefined } : key
}

/** 测点:固定 ⇄ 跟随 selectedMeasurePoint */
export function setKeyFollows(b: Binding, on: boolean): Binding {
  const cur = keySourceOf(b)
  if (isContextRef(cur) === on) return b
  const sample = sampleKeyOf(cur)
  const wm = contextRefsOf(b)[0]?.whenMissing
  const next: unknown = on
    ? {
        source: 'context',
        key: MEASURE_POINT_KEY,
        ...(sample ? { fallback: sample } : {}),
        ...(wm ? { whenMissing: wm } : {}),
      }
    : sample
  if (b.mode === 'ts' || b.mode === 'attr') return put(b, { key: next })
  if (b.mode === 'ts-history') return put(b, { keys: next === '' ? [] : [next] })
  if (b.mode === 'ext') return putParams(b, { keys: next === '' ? [] : [next] })
  return b
}

/** 时间窗口:固定 ⇄ 跟随 timeRange(切过去时当前窗口留作样例) */
export function setWindowFollows(b: Binding, on: boolean): Binding {
  const cur = windowSourceOf(b)
  if (isContextRef(cur) === on) return b
  const sample = sampleWindowOf(cur)
  const wm = contextRefsOf(b)[0]?.whenMissing
  return put(b, {
    window: on
      ? { source: 'context', key: TIME_RANGE_KEY, fallback: sample || '24h', ...(wm ? { whenMissing: wm } : {}) }
      : sample || (b.mode === 'ext' ? undefined : '24h'),
  })
}
export function withPickedWindow(src: unknown, w: string): unknown {
  return isContextRef(src) ? { ...(src as Ref), fallback: w || undefined } : w || undefined
}

/** 缺上下文时怎么办:一条绑定里的所有引用用同一个设置(界面上只有一个下拉) */
export function whenMissingOf(b: Binding | null | undefined): WhenMissing {
  return contextRefsOf(b)[0]?.whenMissing ?? 'empty'
}
export function setWhenMissing(b: Binding, mode: WhenMissing): Binding {
  const fix = (x: unknown): unknown => {
    if (!isContextRef(x)) return x
    const { whenMissing: _drop, ...rest } = x as Ref
    return mode === 'empty' ? rest : { ...rest, whenMissing: mode }
  }
  const next: Loose = { ...asLoose(b) }
  for (const f of ['entity', 'key', 'window']) if (f in next) next[f] = fix(next[f])
  if (Array.isArray(next.keys)) next.keys = next.keys.map(fix)
  if (b.mode === 'ext') {
    const p = { ...paramsOf(b) }
    if ('entity' in p) p.entity = fix(p.entity)
    if (Array.isArray(p.keys)) p.keys = p.keys.map(fix)
    next.params = p
  }
  return next as unknown as Binding
}

/**
 * 用各绑定的样例拼一份上下文:预览的「上下文模拟」拿它当初值,一打开就有数可看。
 * 同一个键在多处给了不同样例时取先出现的。
 */
export function sampleContext(widgets: { bindings: Record<string, Binding | Binding[]> }[]): BindingContext {
  const ctx: BindingContext = {}
  const seen = new Set<string>()
  for (const w of widgets)
    for (const v of Object.values(w.bindings ?? {}))
      for (const b of Array.isArray(v) ? v : [v])
        for (const r of contextRefsOf(b)) {
          if (seen.has(r.key) || r.fallback === undefined || r.fallback === null || r.fallback === '') continue
          seen.add(r.key)
          if (r.key.startsWith('custom.')) (ctx.custom ??= {})[r.key.slice(7)] = r.fallback
          else (ctx as Record<string, unknown>)[r.key] = r.fallback
        }
  return ctx
}

/** 一组组件引用了哪些上下文键(预览的「上下文模拟」条据此决定显示哪些选择器) */
export { contextKeysOf } from '@grid/scada-renderer'
