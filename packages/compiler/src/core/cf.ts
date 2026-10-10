// 即时派生:expr.* / formula.* → SIMPLE 计算字段
// 宿主规则(2026-09-10):输入全在一台设备上 → CF 建在这台设备;声明了 asset(向导对「输入跨设备」的运算
// 一律写上)→ CF 建在这个独立资产(tbsite-agg)上,结果是该资产的遥测,页面直接绑资产取数。
// 没写 asset 的跨设备运算是旧配置,仍按 device 字段挂在设备上,保证旧站点重发布时输出位置不变。
import type { AttrScope, CalculatedField, CfArgument, Computation, ExprTerm, KeyRef } from '../types'

export function tsArg(key: string, deviceId: string | null): CfArgument {
  const a: CfArgument = { refEntityKey: { type: 'TS_LATEST', key } }
  if (deviceId) a.refEntityId = { entityType: 'DEVICE', id: deviceId }
  return a
}

/** 属性输入(2026-10-10):refEntityId 规则同遥测,取宿主自身的属性时不写 */
export function attrArg(
  key: string,
  scope: AttrScope,
  ref: { entityType: 'DEVICE' | 'ASSET'; id: string } | null
): CfArgument {
  const a: CfArgument = { refEntityKey: { type: 'ATTRIBUTE', key, scope } }
  if (ref) a.refEntityId = ref
  return a
}

/** 即时派生运算的全部测点输入(常数项不算);带 attr / entityType 标记原样带出 */
export function cfInputRefs(c: Computation): KeyRef[] {
  if (Array.isArray(c.terms))
    return (c.terms as ExprTerm[])
      .filter((t): t is Extract<ExprTerm, { kind: 'key' }> => t.kind === 'key')
      .map(({ kind: _k, abs: _a, ...ref }) => ref)
  return Object.values(c.inputs ?? {})
}

/** 引用指向的实体类型(缺省设备) */
export const refEntityType = (r: KeyRef): 'DEVICE' | 'ASSET' => (r.entityType === 'ASSET' ? 'ASSET' : 'DEVICE')

/** 输入涉及的设备(去重,保持出现顺序;资产上的运算结果不算设备) */
export const cfInputDevices = (c: Computation): string[] => [
  ...new Set(
    cfInputRefs(c)
      .filter(r => refEntityType(r) === 'DEVICE')
      .map(r => r.device)
  ),
]

/** 输入涉及的实体(设备 + 资产,去重,`DEVICE:名` / `ASSET:名`):定宿主用,只在一个实体上 → 建在它上面 */
export const cfInputEntities = (c: Computation): { entityType: 'DEVICE' | 'ASSET'; name: string }[] => {
  const seen = new Map<string, { entityType: 'DEVICE' | 'ASSET'; name: string }>()
  for (const r of cfInputRefs(c)) {
    const t = refEntityType(r)
    seen.set(`${t}:${r.device}`, { entityType: t, name: r.device })
  }
  return [...seen.values()]
}

export type CfHost = { entityType: 'DEVICE' | 'ASSET'; name: string }

/** CF 建在哪:声明了 asset → 该资产;否则 → device 字段指的设备 */
export const cfHost = (c: Computation): CfHost =>
  typeof c.asset === 'string' && c.asset
    ? { entityType: 'ASSET', name: c.asset }
    : { entityType: 'DEVICE', name: c.device as string }

/**
 * @param assetIds 输入里引用到的资产(entityType: 'ASSET')名 → id;计划阶段没有就用占位串 `asset:<名>`
 */
export function buildCf(
  comp: Computation,
  hostId: string,
  devIds: Record<string, string>,
  hostType: 'DEVICE' | 'ASSET' = 'DEVICE',
  assetIds: Record<string, string> = {}
): CalculatedField {
  const out = comp.output as string
  // 引用宿主自身的测点不写 refEntityId(TB 默认取 CF 所在实体);别的实体都写上
  const arg = (ref: KeyRef): CfArgument => {
    const type = refEntityType(ref)
    const id = type === 'ASSET' ? (assetIds[ref.device] ?? `asset:${ref.device}`) : (devIds[ref.device] as string)
    const self = type === hostType && id === hostId
    if (ref.attr) return attrArg(ref.key, ref.attr, self ? null : { entityType: type, id })
    if (self) return tsArg(ref.key, null)
    return type === 'ASSET'
      ? { refEntityId: { entityType: 'ASSET', id }, refEntityKey: { type: 'TS_LATEST', key: ref.key } }
      : tsArg(ref.key, id)
  }
  let expression: string
  const args: Record<string, CfArgument> = {}
  if (comp.template === 'expr.add' || comp.template === 'expr.subtract') {
    const inputs = comp.inputs as Record<string, KeyRef>
    expression = comp.template === 'expr.add' ? 'a + b' : 'a - b'
    args.a = arg(inputs.a!)
    args.b = arg(inputs.b!)
  } else if (comp.template === 'expr.custom') {
    // 从左到右依次计算:每一步都显式加括号
    let vi = 0
    const token = (t: ExprTerm) => {
      if (t.kind === 'const') return String(t.value)
      const name = `v${vi++}`
      args[name] = arg(t)
      return t.abs ? `abs(${name})` : name
    }
    const terms = comp.terms as ExprTerm[]
    const ops = comp.ops as string[]
    expression = token(terms[0]!)
    for (let i = 1; i < terms.length; i++) expression = `(${expression}) ${ops[i - 1]} ${token(terms[i]!)}`
  } else {
    throw new Error(`未知即时派生模板: ${comp.template}`)
  }
  // 对整个结果取绝对值:abs(整条式子)(2026-09-11,同事的「实时曲线」类字段多是这种写法)
  if (comp.absAll) expression = `abs(${expression})`
  const toAttr = comp.outputMode === 'attr'
  return {
    entityId: { entityType: hostType, id: hostId },
    type: 'SIMPLE',
    // 接管来的字段保持它在 TB 上的原名(常是中文描述),输出测点名另算
    name: comp.cfName || out,
    configurationVersion: 1,
    configuration: {
      type: 'SIMPLE',
      arguments: args,
      expression,
      output: toAttr
        ? { type: 'ATTRIBUTES', name: out, scope: 'SERVER_SCOPE', decimalsByDefault: 2 }
        : { type: 'TIME_SERIES', name: out, scope: null, decimalsByDefault: 2 },
    },
  }
}
