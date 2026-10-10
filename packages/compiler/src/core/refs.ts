// 运算之间的引用(2026-10-10):即时计算可以拿设备属性、拿别的运算的结果当输入。
// 这里查两件事:引用的结果资产 / 结果 key 真的有人产出;即时计算之间不能绕成环(A 用 B、B 又用 A)。
// 只看结构,不查 TB;在模板展开 + 输出前缀之后看,和发布时看到的名字一致。
import type { Computation, TbsiteConfig } from '../types'
import { resolveAggMembers } from './aggregate'
import { cfHost, cfInputRefs, refEntityType } from './cf'
import { ATTR_SCOPES, isCfTemplate } from './constants'
import { applyOutputPrefix, outputInventory, outputPrefixOf } from './prefix'
import { expandTemplates } from './templates'

const node = (type: string, entity: string, key: string) => `${type}|${entity}|${key}`
const show = (n: string) => {
  const [type, entity, key] = n.split('|')
  return `${type === 'ASSET' ? '资产 ' : ''}${entity} · ${key}`
}
const nameOf = (c: Computation) => `运算「${c.name || c.output || c.template}」`

/** 引用与环的错误清单(空即通过) */
export function refErrors(cfg: TbsiteConfig): string[] {
  const prefix = outputPrefixOf(cfg)
  const computations = applyOutputPrefix([...expandTemplates(cfg).computations, ...(cfg.computations || [])], prefix)
  const inventory = outputInventory(cfg, computations, prefix)
  const assetKeys = new Map<string, Set<string>>()
  for (const o of inventory)
    if (o.entityType === 'ASSET') assetKeys.set(o.entity, (assetKeys.get(o.entity) ?? new Set()).add(o.key))

  const errs: string[] = []
  for (const c of computations) {
    if (!isCfTemplate(c.template)) continue
    for (const r of cfInputRefs(c)) {
      if (r.attr !== undefined && !ATTR_SCOPES.includes(r.attr))
        errs.push(`${nameOf(c)}: 属性 ${r.key} 的范围「${r.attr}」不对,应为 ${ATTR_SCOPES.join(' / ')}`)
      // 接管来的运算可以引用同事的资产(不在本站点声明里),不查
      if (refEntityType(r) !== 'ASSET' || c.adopted) continue
      const keys = assetKeys.get(r.device)
      if (!keys) errs.push(`${nameOf(c)}: 引用的资产 ${r.device} 不是本站点运算的结果资产`)
      else if (!r.attr && !keys.has(r.key)) errs.push(`${nameOf(c)}: 资产 ${r.device} 上没有运算结果 ${r.key}`)
    }
  }

  // 环:即时计算(CF)与全站汇聚(资产上的 CF)都是「输入一变就算」,绕成环会互相触发;
  // 周期统计 / 归档是定时取数,不会自己触发自己,不算
  const edges = new Map<string, Set<string>>()
  const link = (from: string, to: string) => edges.set(from, (edges.get(from) ?? new Set()).add(to))
  for (const c of computations) {
    if (isCfTemplate(c.template)) {
      const host = cfHost(c)
      const out = node(host.entityType, host.name, c.output as string)
      for (const r of cfInputRefs(c)) if (!r.attr) link(node(refEntityType(r), r.device, r.key), out)
    } else if (c.template === 'aggregate.crossEntity') {
      const out = node('ASSET', c.asset as string, c.output as string)
      for (const m of resolveAggMembers(cfg, c)) link(node('DEVICE', m.name, c.key as string), out)
    }
  }
  const state = new Map<string, 1 | 2>() // 1 = 在当前路径上,2 = 查完
  const path: string[] = []
  const cycles: string[] = []
  const visit = (n: string): void => {
    state.set(n, 1)
    path.push(n)
    for (const next of edges.get(n) ?? []) {
      const s = state.get(next)
      if (s === 1) cycles.push([...path.slice(path.indexOf(next)), next].map(show).join(' → '))
      else if (!s) visit(next)
    }
    path.pop()
    state.set(n, 2)
  }
  for (const n of edges.keys()) if (!state.has(n)) visit(n)
  for (const c of cycles) errs.push(`运算之间绕成了环(会互相触发):${c}`)
  return errs
}
