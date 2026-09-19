/**
 * sld 运行时组件的纯函数:数值格式化、标签颜色、电压等级取色、告警匹配、设计态假值。
 * 不依赖 Vue,单测直接调。
 */
import type { AlarmInfo } from '@grid/tb-client'
import type { SldLabelColor, SldPointValue, SldValueFormat } from '../../sld'

/* ───────────── 数值标签 ───────────── */

export interface SldFormatted {
  /** 显示文字(不含前缀 title 与单位) */
  text: string
  /** 单位;枚举命中 / 没值 / 非数值时为空 */
  unit: string
  /** 没值(null / undefined / 对象) */
  empty: boolean
}

const own = (o: Record<string, string> | undefined, k: string): string | undefined =>
  o && Object.prototype.hasOwnProperty.call(o, k) ? o[k] : undefined

/**
 * 测点值 → 显示文字。顺序:没值 →「--」;`format.map` 按 String(值) 命中(布尔另按 '1' / '0' 再比一次)→ 枚举文字,
 * **不套 digits / unit**;数值(含 TB 常给的数字字符串)→ × scale、toFixed(digits,缺省 1)、带 unit;其余原样转字符串。
 */
export function formatSldValue(raw: unknown, format?: SldValueFormat): SldFormatted {
  if (raw === null || raw === undefined || typeof raw === 'object') return { text: '--', unit: '', empty: true }
  const keys = [String(raw)]
  if (typeof raw === 'boolean') keys.push(raw ? '1' : '0')
  for (const k of keys) {
    const hit = own(format?.map, k)
    if (typeof hit === 'string') return { text: hit, unit: '', empty: false }
  }
  const num = typeof raw === 'number' ? raw : typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : NaN
  if (Number.isFinite(num)) {
    const digits = Math.min(Math.max(Math.trunc(format?.digits ?? 1), 0), 10)
    return { text: (num * (format?.scale ?? 1)).toFixed(digits), unit: format?.unit ?? '', empty: false }
  }
  return { text: String(raw), unit: '', empty: false }
}

/** `pt.*` 槽位的值是否是 `{ v, ts }` 形状 */
export function asPointValue(x: unknown): SldPointValue | undefined {
  return x && typeof x === 'object' && 'ts' in x && 'v' in x ? (x as SldPointValue) : undefined
}

/** 数据是否过期:staleMs ≤ 0 / 未给不判;ts 不是有限数不判 */
export function isStale(ts: number | undefined, now: number, staleMs: number | undefined): boolean {
  if (!staleMs || staleMs <= 0 || typeof ts !== 'number' || !Number.isFinite(ts)) return false
  return now - ts > staleMs
}

const p2 = (n: number): string => String(n).padStart(2, '0')
/** 本地时间 `YYYY-MM-DD HH:mm:ss`(过期提示用) */
export function formatTs(ts: number): string {
  const d = new Date(ts)
  if (Number.isNaN(d.getTime())) return String(ts)
  return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())} ${p2(d.getHours())}:${p2(d.getMinutes())}:${p2(d.getSeconds())}`
}

/* ───────────── 颜色 ───────────── */

/** 相色:a 黄 / b 绿 / c 红(现有一次图的习惯) */
export const SLD_PHASE_COLORS: Record<'a' | 'b' | 'c', string> = { a: '#ffe14d', b: '#3ddc84', c: '#ff5a5a' }

/** 标签颜色:'a' / 'b' / 'c' → 相色;其他非空字符串当 CSS 颜色;没给返回 undefined(随主题) */
export function labelColor(c: SldLabelColor | undefined): string | undefined {
  if (typeof c !== 'string' || !c.trim()) return undefined
  return c === 'a' || c === 'b' || c === 'c' ? SLD_PHASE_COLORS[c] : c
}

export interface SldKvColor {
  kv: number
  color: string
}

/** 缺省电压等级配色:35 kV 黄、10 kV 红、0.4 kV 橙(案例图的低压是橙色);其余等级用主题强调色 */
export const DEFAULT_KV_COLORS: SldKvColor[] = [
  { kv: 35, color: '#ffd21f' },
  { kv: 10, color: '#ff4d4f' },
  { kv: 0.4, color: '#ff9f1a' },
]

/**
 * 电压等级 → 颜色。先找相等的;没有就找相对偏差 ≤ 15% 里最近的一档(10.5 kV 归 10 kV、0.38 kV 归 0.4 kV);
 * 再没有(或 kv 未知)返回 undefined —— 调用方不设 color,继承主题强调色。
 */
export function kvColor(kv: number | undefined, table: readonly SldKvColor[] | undefined): string | undefined {
  if (typeof kv !== 'number' || !Number.isFinite(kv) || !Array.isArray(table)) return undefined
  let best: SldKvColor | undefined
  let bestErr = Infinity
  for (const row of table) {
    if (!row || typeof row.kv !== 'number' || typeof row.color !== 'string' || !row.color) continue
    const err = row.kv === kv ? 0 : Math.abs(row.kv - kv) / Math.max(Math.abs(row.kv), 1e-9)
    if (err < bestErr) {
      best = row
      bestErr = err
    }
  }
  return best && bestErr <= 0.15 ? best.color : undefined
}

/* ───────────── 告警 ───────────── */

/** 告警闪烁的两档:bad = CRITICAL / MAJOR(红),warn = 其余(黄) */
export type SldAlarmLevel = 'bad' | 'warn'

const looksLikeAlarm = (x: unknown): x is AlarmInfo =>
  !!x && typeof x === 'object' && typeof (x as AlarmInfo).status === 'string' && 'originator' in x

/**
 * `alarms` 槽位的值 → 告警列表。正常是 AlarmInfo[];槽位声明了 multiple,宿主 / 将来的解析器可能给「数组的数组」,
 * 一并摊平;认不出的元素(如解析器对多条绑定给的 SeriesValue)跳过。
 */
export function flattenAlarms(x: unknown, depth = 0): AlarmInfo[] {
  if (!Array.isArray(x) || depth > 2) return []
  const out: AlarmInfo[] = []
  for (const item of x) {
    if (Array.isArray(item)) out.push(...flattenAlarms(item, depth + 1))
    else if (looksLikeAlarm(item)) out.push(item)
  }
  return out
}

/** 实体匹配键:类型 + 名称(图里只有名字,ADR-005 D4);分隔符用 `|`,TB 设备名里不会出现在类型那一侧 */
export const entityKey = (type: string | undefined, name: string): string => `${type ?? ''}|${name}`

/**
 * 本组件绑定里出现的实体:「类型 + 名称」→ id(方案 A,2026-09-19:组件定义声明 receivesBindings,宿主把绑定传进来)。
 * 图里只存名字(ADR-005 D4),发布器按名解析后 id 在绑定里;没解析(id 为空)的跳过。ext 绑定的实体在 params.entity。
 */
export function entityIdsFromBindings(bindings: Record<string, unknown> | undefined): Map<string, string> {
  const out = new Map<string, string>()
  const take = (e: unknown) => {
    const x = e as { type?: string; id?: string; name?: string } | undefined
    if (x && typeof x === 'object' && x.id && x.name) out.set(entityKey(x.type, x.name), x.id)
  }
  for (const b of Object.values(bindings ?? {}))
    for (const one of Array.isArray(b) ? b : [b]) {
      const o = one as { entity?: unknown; params?: { entity?: unknown } } | undefined
      take(o?.entity)
      take(o?.params?.entity)
    }
  return out
}

/**
 * 未清除(status 以 ACTIVE 开头)的告警按节点实体归并,取最高严重级别;返回键是 entityKey(类型, 名称)。
 * 优先按 originator 的 **id** 反查(`keyById` 由 entityIdsFromBindings 反转而来,可靠);
 * 查不到再按名称(`originatorName`,没有再取 `originator.name`)——两个都没有的告警匹配不了任何节点。
 */
export function alarmLevelsByEntity(alarms: AlarmInfo[], keyById?: Map<string, string>): Map<string, SldAlarmLevel> {
  const out = new Map<string, SldAlarmLevel>()
  for (const a of alarms) {
    if (!a.status.startsWith('ACTIVE')) continue
    const byId = a.originator?.id ? keyById?.get(a.originator.id) : undefined
    const name = a.originatorName || a.originator?.name
    if (!byId && !name) continue
    const level: SldAlarmLevel = a.severity === 'CRITICAL' || a.severity === 'MAJOR' ? 'bad' : 'warn'
    const key = byId ?? entityKey(a.originator?.type, name!)
    if (out.get(key) !== 'bad') out.set(key, level)
  }
  return out
}

/* ───────────── 设计态假值 ───────────── */

const SAMPLE_BY_UNIT: Array<[RegExp, number]> = [
  [/^kv$/i, 10.5],
  [/^v$/i, 400],
  [/^ka$/i, 0.12],
  [/^a$/i, 86.5],
  [/^mw$/i, 1.2],
  [/^kw$/i, 125.6],
  [/^kvar$/i, 32.1],
  [/^kva$/i, 130],
  [/^kwh$/i, 12345],
  [/^hz$/i, 50],
  [/^%(rh)?$/i, 85],
  [/^(℃|°c)$/i, 28.5],
]

/** 设计态数值标签的占位原值:按单位给个看起来合理的数(显示值 = 原值 × scale,所以这里除回去);枚举取第一项 */
export function sampleValueFor(format?: SldValueFormat): unknown {
  const first = format?.map ? Object.keys(format.map)[0] : undefined
  if (first !== undefined) return /^-?\d+(\.\d+)?$/.test(first) ? Number(first) : first
  const unit = (format?.unit ?? '').trim()
  const shown = SAMPLE_BY_UNIT.find(([re]) => re.test(unit))?.[1] ?? 1
  const scale = format?.scale
  return typeof scale === 'number' && Number.isFinite(scale) && scale !== 0 ? shown / scale : shown
}
