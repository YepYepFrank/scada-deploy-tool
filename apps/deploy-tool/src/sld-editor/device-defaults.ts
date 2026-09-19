/**
 * 从设备树拖设备进画布时的默认规则(T5.6):按设备名 / 类型选图元,按设备实际有的 key 挑状态测点与数值标签。
 * 纯函数、规则写成数据(下面三张表),以后加规则只加行;无 Vue、无 DOM,可单测。
 */
import { getSldSymbol, type SldLabelColor, type SldSymbolLookup } from '@grid/scada-renderer'

/* ───────────── 图元 ───────────── */

export interface SldSymbolRule {
  symbol: string
  /**
   * 关键字,不分大小写。纯 ASCII 的按「词」匹配:前后不能紧挨着字母(数字、下划线、横线、中文都算分隔),
   * 所以 `TR` 命中 `TR1` / `1#TR` 而不命中 `CONTROL`;含中文的按子串匹配。
   */
  keywords: string[]
}

/** 自上而下第一条命中的生效;都不中 → FALLBACK_SYMBOL */
export const SYMBOL_RULES: SldSymbolRule[] = [
  { symbol: 'breaker', keywords: ['IED', '保护', 'QF', '断路器'] },
  { symbol: 'meter', keywords: ['METER', '电表', '电能表'] },
  { symbol: 'pcs', keywords: ['PCS', '变流器'] },
  { symbol: 'battery', keywords: ['BMS', '电池'] },
  { symbol: 'inverter', keywords: ['PV', '光伏', '逆变'] },
  { symbol: 'charger', keywords: ['充电', 'CHARGER'] },
  { symbol: 'transformer-2w', keywords: ['变压器', 'TR', '主变'] },
]
export const FALLBACK_SYMBOL = 'device-box'

const isAscii = (s: string): boolean => /^[\x20-\x7e]+$/.test(s)
const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

export function matchKeyword(text: string, keyword: string): boolean {
  if (!text || !keyword) return false
  if (!isAscii(keyword)) return text.includes(keyword)
  return new RegExp(`(?<![A-Za-z])${escapeRe(keyword)}(?![A-Za-z])`, 'i').test(text)
}

const ruleFor = (text: string | undefined): SldSymbolRule | undefined =>
  text ? SYMBOL_RULES.find(r => r.keywords.some(k => matchKeyword(text, k))) : undefined

/** 先看设备名,名字里看不出来再看设备类型(TB 的 device profile);都看不出来 → device-box */
export function pickSymbol(entity: { name: string; deviceType?: string }): string {
  return (ruleFor(entity.name) ?? ruleFor(entity.deviceType))?.symbol ?? FALLBACK_SYMBOL
}

/* ───────────── 测点 ───────────── */

export type SldStateMap = Record<string, 'open' | 'closed'>
export const DEFAULT_STATE_MAP: Readonly<SldStateMap> = { '1': 'closed', '0': 'open' }

export interface SldStateKeyRule {
  /** 对整个 key 匹配(不分大小写由正则自己带 i) */
  pattern: RegExp
  map?: SldStateMap
}

/** 开关状态的常见 key 命名;自上而下第一条在设备上找得到 key 的生效 */
export const STATE_KEY_RULES: SldStateKeyRule[] = [
  { pattern: /^switch_?(state|status)$/i },
  { pattern: /^(breaker|cb|qf)(_?(state|status|pos|position))?$/i },
  { pattern: /^(开关|断路器)(状态|位置)$/ },
  { pattern: /^(合闸位置|合位)$/ },
  { pattern: /^(分闸位置|分位)$/, map: { '1': 'open', '0': 'closed' } },
  { pattern: /^(sw|di)_?(state|status)$/i },
]

export interface SldValueRule {
  id: string
  /** 一条规则的若干个量要么一起加、要么都不加(三相电流只绑上 Ia 一个没意义);单个量的规则只有一项 */
  items: Array<{ pattern: RegExp; title: string; color?: SldLabelColor }>
  unit?: string
  digits?: number
  /** 为 true 时 items 找到几个加几个(不要求齐全) */
  partial?: boolean
}

const PHASE: SldLabelColor[] = ['a', 'b', 'c']
const phase3 = (titles: [string, string, string], patterns: [RegExp, RegExp, RegExp]): SldValueRule['items'] =>
  titles.map((title, i) => ({ title, pattern: patterns[i]!, color: PHASE[i]! }))

/** 数值标签的常见 key 命名(ADR-005:三相量按 A 黄 / B 绿 / C 红) */
export const VALUE_RULES: SldValueRule[] = [
  {
    id: 'P',
    items: [{ title: 'P', pattern: /^(p|p_?(total|sum)|pt|active_?power|总?有功功率)$/i }],
    unit: 'kW',
    digits: 1,
  },
  {
    id: 'Q',
    items: [{ title: 'Q', pattern: /^(q|q_?(total|sum)|qt|reactive_?power|总?无功功率)$/i }],
    unit: 'kvar',
    digits: 1,
  },
  {
    id: 'I3',
    items: phase3(['Ia', 'Ib', 'Ic'], [/^(ia|i_a|a相电流)$/i, /^(ib|i_b|b相电流)$/i, /^(ic|i_c|c相电流)$/i]),
    unit: 'A',
    digits: 1,
  },
  {
    id: 'ULL',
    items: phase3(['Uab', 'Ubc', 'Uca'], [/^(uab|u_ab|ab线电压)$/i, /^(ubc|u_bc|bc线电压)$/i, /^(uca|u_ca|ca线电压)$/i]),
    unit: 'V',
    digits: 1,
  },
  {
    id: 'ULN',
    items: phase3(['Ua', 'Ub', 'Uc'], [/^(ua|u_a|a相电压)$/i, /^(ub|u_b|b相电压)$/i, /^(uc|u_c|c相电压)$/i]),
    unit: 'V',
    digits: 1,
  },
  { id: 'SOC', items: [{ title: 'SOC', pattern: /^(soc|bms_?soc|荷电状态)$/i }], unit: '%', digits: 1 },
  { id: 'U', items: [{ title: 'U', pattern: /^(u|udc|u_?dc|v|voltage|总电压|直流电压|电压)$/i }], unit: 'V', digits: 1 },
  { id: 'I', items: [{ title: 'I', pattern: /^(i|idc|i_?dc|current|总电流|直流电流|电流)$/i }], unit: 'A', digits: 1 },
  { id: 'F', items: [{ title: 'F', pattern: /^(f|freq|frequency|频率)$/i }], unit: 'Hz', digits: 2 },
  { id: 'PF', items: [{ title: 'PF', pattern: /^(pf|cos|cosphi|power_?factor|功率因数)$/i }], digits: 2 },
]

/** 各图元优先挑哪些量(规则 id,按顺序);没列的图元用 DEFAULT_VALUE_ORDER */
export const DEFAULT_VALUE_ORDER = ['P', 'Q', 'I3', 'ULL', 'ULN', 'SOC', 'F', 'PF']
export const VALUE_ORDER_BY_SYMBOL: Record<string, string[]> = {
  battery: ['SOC', 'U', 'I', 'P'],
  pcs: ['P', 'Q', 'SOC', 'U', 'I', 'F'],
  inverter: ['P', 'Q', 'U', 'I', 'F'],
  charger: ['P', 'U', 'I'],
  'transformer-2w': ['P', 'Q', 'I3', 'PF'],
}

/** 一台设备默认最多带几个数值标签(成组的三相量放不下就整组跳过) */
export const MAX_DEFAULT_LABELS = 6

export interface DefaultLabel {
  key: string
  title: string
  unit?: string
  digits?: number
  color?: SldLabelColor
}
export interface DefaultPoints {
  state?: { key: string; map: SldStateMap }
  labels: DefaultLabel[]
}

/**
 * 从设备实际有的 key 里挑默认测点。
 * - 状态:只有带 stateBody 的图元(开关类、状态灯)才挑;
 * - 数值:按图元的优先顺序一条条试,成组的量(三相)放得下才整组加,放不下跳过看下一条;挑不到就不加。
 */
export function defaultPoints(
  symbolId: string,
  availableKeys: string[],
  symbols: SldSymbolLookup = getSldSymbol
): DefaultPoints {
  const out: DefaultPoints = { labels: [] }
  const find = (pattern: RegExp): string | undefined => availableKeys.find(k => pattern.test(k))

  if (symbols(symbolId)?.stateBody)
    for (const rule of STATE_KEY_RULES) {
      const key = find(rule.pattern)
      if (key !== undefined) {
        out.state = { key, map: { ...(rule.map ?? DEFAULT_STATE_MAP) } }
        break
      }
    }

  const limit = MAX_DEFAULT_LABELS
  const used = new Set<string>()
  for (const id of VALUE_ORDER_BY_SYMBOL[symbolId] ?? DEFAULT_VALUE_ORDER) {
    const rule = VALUE_RULES.find(r => r.id === id)
    if (!rule) continue
    const hits = rule.items.flatMap(item => {
      const key = find(item.pattern)
      return key !== undefined && !used.has(key) ? [{ item, key }] : []
    })
    if (!hits.length || (!rule.partial && hits.length < rule.items.length)) continue
    if (out.labels.length + hits.length > limit) continue
    for (const { item, key } of hits) {
      used.add(key)
      out.labels.push({
        key,
        title: item.title,
        ...(rule.unit !== undefined ? { unit: rule.unit } : {}),
        ...(rule.digits !== undefined ? { digits: rule.digits } : {}),
        ...(item.color !== undefined ? { color: item.color } : {}),
      })
    }
    if (out.labels.length >= limit) break
  }
  return out
}
