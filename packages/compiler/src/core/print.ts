// 写入指纹与差异(2026-09-11):工具写进 TB 的对象带「写入时的指纹」,第 3 步同步时三方比对——
//   平台上现在 vs 写入时的指纹 → 不一样 = 有人在 TB 里改过(冲突);
//   向导当前配置 vs 写入时的指纹 → 不一样 = 向导里改了、还没发布(待发布)。
// 另给「查看差异」生成逐项对照(本工具里 / 平台上现在)。纯函数,不连网。
import type { PlatformArg } from './adopt'
import { stableJson } from './stable'

/**
 * 计划里的值是不是「包含于」TB 读回的值。TB 保存规则节点时会补默认字段(如 TbMsgTimeseriesNode 的
 * processingSettings)、去掉值为 null 的字段(如 generator 的 queueName)——2026-09-11 镜像实测,
 * 所以不能整串比。计划里写了的每个字段都要一致;TB 多出来的字段不算变化;null 与缺失等价。
 * 代价:以后编译器「删掉」某个配置字段时这里认不出变化——那种改动要连带改节点名,或在 TB 里手动重存一次。
 */
export const covers = (p: unknown, c: unknown): boolean => {
  if (p === null || p === undefined) return c === null || c === undefined
  if (Array.isArray(p)) return Array.isArray(c) && c.length === p.length && p.every((x, i) => covers(x, c[i]))
  if (typeof p === 'object') {
    if (!c || typeof c !== 'object' || Array.isArray(c)) return false
    const cur = c as Record<string, unknown>
    return Object.entries(p as Record<string, unknown>).every(([k, v]) => covers(v, cur[k]))
  }
  return p === c
}

export type ChainMetaLike = {
  firstNodeIndex?: number | null
  nodes?: { type: string; name: string; configuration?: unknown }[]
  connections?: { fromIndex: number; toIndex: number; type: string }[]
}

/** 规则链元数据的「内容」是否一致:节点(类型 / 名字 / 配置按 covers)+ 连线 + 起点;不看 id、坐标、版本 */
export const metaCovers = (planned: ChainMetaLike, cur: ChainMetaLike): boolean => {
  const pn = planned.nodes ?? []
  const cn = cur.nodes ?? []
  if ((planned.firstNodeIndex ?? null) !== (cur.firstNodeIndex ?? null) || pn.length !== cn.length) return false
  const nodesSame = pn.every(
    (n, i) =>
      n.type === cn[i]!.type && n.name === cn[i]!.name && covers(n.configuration ?? {}, cn[i]!.configuration ?? {})
  )
  const conns = (m: ChainMetaLike) =>
    (m.connections ?? [])
      .map(c => `${c.fromIndex}>${c.toIndex}:${c.type}`)
      .sort()
      .join('|')
  return nodesSame && conns(planned) === conns(cur)
}

/** FNV-1a 32 位:只用来判断「变没变」(告警状态属性名里的告警类型指纹也用它) */
export const hash = (s: string): string => {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h.toString(16).padStart(8, '0')
}

type CfConf = {
  expression?: string
  arguments?: Record<string, PlatformArg>
  output?: { type?: string; name?: string; scope?: string | null }
}

/**
 * 计算字段的「内容」:表达式(去空白)、参数(测点 / 取值类型 / 范围 / 引用实体)、输出(类型 / 名字 / 范围)。
 * TB 自己补的字段(useLatestTs、decimalsByDefault、strategy、defaultValue 等)不算。
 */
export function cfSignature(cf: { configuration?: unknown }): string {
  const c = (cf.configuration ?? {}) as CfConf
  const o = c.output ?? {}
  return stableJson({
    expr: (c.expression ?? '').replace(/\s+/g, ''),
    args: Object.fromEntries(
      Object.entries(c.arguments ?? {}).map(([k, v]) => [
        k,
        {
          key: v?.refEntityKey?.key ?? null,
          type: v?.refEntityKey?.type ?? null,
          scope: v?.refEntityKey?.scope ?? null,
          ref: v?.refEntityId?.id ?? null,
        },
      ])
    ),
    out: { type: o.type ?? null, name: o.name ?? null, scope: o.scope ?? null },
  })
}
export const cfPrint = (cf: { configuration?: unknown }): string => hash(cfSignature(cf))

/** 规则链的指纹:TB 保存后读回来算(把 TB 自己补的默认字段也算进去,之后只要没人动就一直相等) */
export const chainPrint = (m: ChainMetaLike): string =>
  hash(
    stableJson({
      first: m.firstNodeIndex ?? null,
      nodes: (m.nodes ?? []).map(n => ({ type: n.type, name: n.name, configuration: n.configuration ?? {} })),
      connections: (m.connections ?? []).map(c => `${c.fromIndex}>${c.toIndex}:${c.type}`).sort(),
    })
  )

/**
 * 冲突项的标识(2026-09-11):第 3 步同步里的一行、发布时的一个写入对象都用它对上——
 * 「以 TB 为准」记进 keepPlatform、「待定」传进发布的 skip,都是这个串。
 */
export const cfItemKey = (entityType: string, entity: string, name: string): string =>
  `cf:${entityType}|${entity}|${name}`
export const chainItemKey = (name: string): string => `chain:${name}`

/** 「查看差异」的一行:某一项在本工具里(向导当前配置)和平台上现在各是什么;undefined = 这一边没有 */
export interface ConfigDiff {
  item: string
  tool?: unknown
  platform?: unknown
}

const shortType = (t?: string) => (t ?? '').split('.').pop()

/** 计算字段逐项差异:表达式、每个参数(设备 / 测点 / 取值类型)、输出 */
export function diffCf(
  tool: { configuration?: unknown },
  platform: { configuration?: unknown },
  nameOfId: (id: string) => string | undefined = () => undefined
): ConfigDiff[] {
  const a = (tool.configuration ?? {}) as CfConf
  const b = (platform.configuration ?? {}) as CfConf
  const out: ConfigDiff[] = []
  if ((a.expression ?? '').replace(/\s+/g, '') !== (b.expression ?? '').replace(/\s+/g, ''))
    out.push({ item: '表达式', tool: a.expression, platform: b.expression })
  const argText = (x?: PlatformArg) => {
    if (!x) return undefined
    const who = x.refEntityId ? (nameOfId(x.refEntityId.id) ?? x.refEntityId.id) : '本实体'
    const kind =
      x.refEntityKey?.type === 'TS_LATEST'
        ? '最新遥测'
        : `${x.refEntityKey?.type}${x.refEntityKey?.scope ? '/' + x.refEntityKey.scope : ''}`
    return `${who}.${x.refEntityKey?.key}(${kind})`
  }
  for (const k of [...new Set([...Object.keys(a.arguments ?? {}), ...Object.keys(b.arguments ?? {})])].sort()) {
    const ta = argText(a.arguments?.[k])
    const tb = argText(b.arguments?.[k])
    if (ta !== tb) out.push({ item: `参数 ${k}`, tool: ta, platform: tb })
  }
  const outText = (o?: CfConf['output']) =>
    o ? `${o.type ?? ''}${o.scope ? '/' + o.scope : ''} → ${o.name ?? ''}` : undefined
  if (outText(a.output) !== outText(b.output))
    out.push({ item: '输出', tool: outText(a.output), platform: outText(b.output) })
  return out
}

/** 规则链逐项差异:节点增减、类型变化、配置字段变化(按 covers,TB 补的默认字段不算)、连线增减、起点 */
export function diffChainMeta(tool: ChainMetaLike, platform: ChainMetaLike): ConfigDiff[] {
  const out: ConfigDiff[] = []
  const tn = tool.nodes ?? []
  const pn = platform.nodes ?? []
  const pBy = new Map(pn.map(n => [n.name, n]))
  const tBy = new Map(tn.map(n => [n.name, n]))
  for (const n of tn) {
    const p = pBy.get(n.name)
    if (!p) {
      out.push({ item: `节点「${n.name}」`, tool: shortType(n.type), platform: undefined })
      continue
    }
    if (p.type !== n.type)
      out.push({ item: `节点「${n.name}」· 类型`, tool: shortType(n.type), platform: shortType(p.type) })
    const tc = (n.configuration ?? {}) as Record<string, unknown>
    const pc = (p.configuration ?? {}) as Record<string, unknown>
    for (const k of Object.keys(tc))
      if (!covers(tc[k], pc[k])) out.push({ item: `节点「${n.name}」· ${k}`, tool: tc[k], platform: pc[k] })
  }
  for (const p of pn)
    if (!tBy.has(p.name)) out.push({ item: `节点「${p.name}」`, tool: undefined, platform: shortType(p.type) })
  const connSet = (m: ChainMetaLike) => {
    const ns = m.nodes ?? []
    return new Set((m.connections ?? []).map(c => `${ns[c.fromIndex]?.name} →(${c.type}) ${ns[c.toIndex]?.name}`))
  }
  const tcs = connSet(tool)
  const pcs = connSet(platform)
  for (const c of tcs) if (!pcs.has(c)) out.push({ item: '连线', tool: c, platform: undefined })
  for (const c of pcs) if (!tcs.has(c)) out.push({ item: '连线', tool: undefined, platform: c })
  const firstName = (m: ChainMetaLike) =>
    m.firstNodeIndex === null || m.firstNodeIndex === undefined ? undefined : m.nodes?.[m.firstNodeIndex]?.name
  if (firstName(tool) !== firstName(platform))
    out.push({ item: '起始节点', tool: firstName(tool), platform: firstName(platform) })
  return out
}
