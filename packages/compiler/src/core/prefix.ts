// ADR-003:运算结果 key 的 `calc_` 前缀、级联白名单与既有站点迁移表。
// 前缀只在配置声明了 outputPrefix 时生效(向导新建站点默认 'calc_';旧站点配置没有该字段 → 不改名)。
import type { Computation, TbsiteConfig } from '../types'
import { resolveAggMembers } from './aggregate'
import { AGG_SUFFIX, CASCADE_LEVELS, MAX_CF_ARGS } from './constants'

/** 向导新建站点的默认前缀(ADR-003 决定 1) */
export const DEFAULT_OUTPUT_PREFIX = 'calc_'

/** 配置声明的前缀(没有则空串 = 不加前缀) */
export const outputPrefixOf = (cfg: TbsiteConfig): string =>
  typeof cfg.outputPrefix === 'string' ? cfg.outputPrefix : ''

/** 加前缀;已带前缀的名字不重复加(幂等) */
export const withPrefix = (prefix: string, name: string): string =>
  !prefix || name.startsWith(prefix) ? name : prefix + name

/**
 * 给展开后的运算项加前缀:显式 output 改名;引用到其它运算显式输出的 key(alarm.key、window.keys、
 * aggregate.key、expr.inputs / terms、revenue.charge / discharge)同步改名,保证图内引用自洽。
 * 窗口聚合 / 级联的派生名(PAvg5m …)在 rollupMetadata 里按同一前缀生成。
 */
export function applyOutputPrefix(computations: Computation[], prefix: string): Computation[] {
  if (!prefix) return computations
  const raw = new Set(computations.map(c => c.output).filter((x): x is string => !!x))
  const ren = (k: string | undefined) => (k && raw.has(k) ? withPrefix(prefix, k) : k)
  return computations.map(src => {
    const c = JSON.parse(JSON.stringify(src)) as Computation
    if (c.output) c.output = withPrefix(prefix, c.output)
    if (c.key) c.key = ren(c.key)
    if (c.keys) c.keys = c.keys.map(k => ren(k) as string)
    for (const ref of Object.values(c.inputs ?? {})) ref.key = ren(ref.key) as string
    for (const t of c.terms ?? []) if (t.kind === 'key') t.key = ren(t.key) as string
    if (c.charge) c.charge.key = ren(c.charge.key) as string
    if (c.discharge) c.discharge.key = ren(c.discharge.key) as string
    return c
  })
}

export interface OutputKey {
  entityType: 'DEVICE' | 'ASSET'
  /** 设备名或资产名 */
  entity: string
  key: string
  kind: 'cf' | 'agg' | 'rollup' | 'cascade' | 'revenue'
  template: string
}

/** 这份配置会写出的全部 key(含分层汇聚的分组键、级联各级、收益的派生键),供白名单 / 迁移表 / 编辑器提示用 */
export function outputInventory(cfg: TbsiteConfig, computations: Computation[], prefix: string): OutputKey[] {
  const out: OutputKey[] = []
  const push = (o: OutputKey) => {
    if (!out.some(x => x.entityType === o.entityType && x.entity === o.entity && x.key === o.key)) out.push(o)
  }
  const p = (k: string) => withPrefix(prefix, k)
  for (const c of computations) {
    const t = c.template
    if (t.startsWith('expr.') || t.startsWith('formula.')) {
      push({ entityType: 'DEVICE', entity: c.device as string, key: c.output as string, kind: 'cf', template: t })
    } else if (t === 'aggregate.crossEntity') {
      const n = resolveAggMembers(cfg, c).length
      const asset = c.asset as string
      const output = c.output as string
      if (n > MAX_CF_ARGS)
        for (let i = 0; i < Math.ceil(n / MAX_CF_ARGS); i++)
          push({ entityType: 'ASSET', entity: asset, key: `${output}__p${i}`, kind: 'agg', template: t })
      push({ entityType: 'ASSET', entity: asset, key: output, kind: 'agg', template: t })
    } else if (t === 'window.aggregate') {
      for (const a of c.aggs ?? [])
        for (const k of c.keys ?? [])
          push({
            entityType: 'DEVICE',
            entity: c.device as string,
            key: p(`${k}${AGG_SUFFIX[a]}${c.window}`),
            kind: 'rollup',
            template: t,
          })
    } else if (t === 'window.delta' || t === 'window.integrate') {
      push({ entityType: 'DEVICE', entity: c.device as string, key: c.output as string, kind: 'rollup', template: t })
    } else if (t === 'window.cascade') {
      for (const lv of CASCADE_LEVELS)
        for (const k of c.keys ?? [])
          for (const a of c.aggs ?? [])
            push({
              entityType: 'DEVICE',
              entity: c.device as string,
              key: p(`${k}${AGG_SUFFIX[a]}${lv.id}`),
              kind: 'cascade',
              template: t,
            })
    } else if (t === 'revenue.periodic') {
      const o = c.output as string
      for (const k of [o, `${o}Income`, `${o}Cost`, `${o}Daily`, `${o}IncomeDaily`, `${o}CostDaily`])
        push({ entityType: 'ASSET', entity: c.asset as string, key: k, kind: 'revenue', template: t })
    }
  }
  return out
}

/**
 * 级联白名单(ADR-003 决定 2):设备上的运算输出里,被其它运算再当输入用的 key。
 * 规则链入口对「设备发出、带前缀、不在白名单」的消息直接丢弃,防回环;白名单由配置推导,不由人维护。
 */
export function cascadeWhitelist(cfg: TbsiteConfig, computations: Computation[], prefix: string): string[] {
  if (!prefix) return []
  const deviceOutputs = new Set(
    outputInventory(cfg, computations, prefix)
      .filter(o => o.entityType === 'DEVICE')
      .map(o => o.key)
  )
  const referenced = new Set<string>()
  for (const c of computations) {
    if (c.key) referenced.add(c.key)
    for (const k of c.keys ?? []) referenced.add(k)
    for (const ref of Object.values(c.inputs ?? {})) referenced.add(ref.key)
    for (const t of c.terms ?? []) if (t.kind === 'key') referenced.add(t.key)
    if (c.charge) referenced.add(c.charge.key)
    if (c.discharge) referenced.add(c.discharge.key)
    // 级联:上一级输出是下一级输入(5m → 1h → 1d)
    if (c.template === 'window.cascade')
      for (const lv of CASCADE_LEVELS.slice(0, -1))
        for (const k of c.keys ?? [])
          for (const a of c.aggs ?? []) referenced.add(withPrefix(prefix, `${k}${AGG_SUFFIX[a]}${lv.id}`))
  }
  return [...deviceOutputs].filter(k => referenced.has(k)).sort()
}

export interface RenameEntry {
  entityType: 'DEVICE' | 'ASSET'
  entity: string
  old: string
  new: string
  since: string
}

/**
 * 迁移表(ADR-003 决定 3):上一版配置写出的、没有前缀的 key,在新版里以带前缀的同名 key 出现 → 记一条。
 * 一期只生成不执行(旧 key 的历史数据留在原处)。
 */
export function renameTable(
  prev: { cfg: TbsiteConfig; computations: Computation[] },
  next: { cfg: TbsiteConfig; computations: Computation[] },
  since = new Date().toISOString()
): RenameEntry[] {
  const nextPrefix = outputPrefixOf(next.cfg)
  if (!nextPrefix) return []
  const prevKeys = outputInventory(prev.cfg, prev.computations, outputPrefixOf(prev.cfg))
  const nextKeys = new Set(
    outputInventory(next.cfg, next.computations, nextPrefix).map(o => `${o.entityType}|${o.entity}|${o.key}`)
  )
  const rows: RenameEntry[] = []
  for (const o of prevKeys) {
    if (o.key.startsWith(nextPrefix)) continue
    const renamed = nextPrefix + o.key
    if (nextKeys.has(`${o.entityType}|${o.entity}|${renamed}`))
      rows.push({ entityType: o.entityType, entity: o.entity, old: o.key, new: renamed, since })
  }
  return rows
}
