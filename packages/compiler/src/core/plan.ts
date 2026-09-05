// 编译入口:tbsite 配置 → 写入计划(纯函数,无网络)。
// 写入器与 CLI `plan` 都从这里出发;id 未知时用占位串,写入器拿到真实 id 后再按需重建规则链元数据。
import type { Computation, IdMap, TbsiteConfig, WritePlan } from '../types'
import { alarmMetadata } from './alarm'
import { buildAggCfs, resolveAggMembers } from './aggregate'
import { buildCf } from './cf'
import { chainNames, isCfTemplate } from './constants'
import { revenueMetadata } from './revenue'
import { rollupGroups, rollupMetadata } from './rollup'
import { expandTemplates } from './templates'
import { validateConfig } from './validate'

export class ConfigError extends Error {
  constructor(public readonly errors: string[]) {
    super('校验失败:' + errors.join(';'))
    this.name = 'ConfigError'
  }
}

/** 计划阶段的占位 id:`dev:<名>` / `asset:<名>` / `chain:<名>`(与 tbsite_compile.py --plan-json 一致) */
export const placeholderIds = (cfg: TbsiteConfig): Required<IdMap> => ({
  devices: Object.fromEntries((cfg.devices || []).map(d => [d.name, `dev:${d.name}`])),
  assets: {},
  chains: {},
})

const pick = (map: Record<string, string> | undefined, kind: string, name: string) => map?.[name] ?? `${kind}:${name}`

/** 模板展开 + 并入手工运算项(模板项在前,便于同名输出被手工项覆盖时以手工项为准) */
export function expandConfig(cfg: TbsiteConfig): { cfg: TbsiteConfig; computations: Computation[]; notes: string[] } {
  const expanded = expandTemplates(cfg)
  const computations = [...expanded.computations, ...(cfg.computations || [])]
  return { cfg: { ...cfg, computations }, computations, notes: expanded.notes }
}

/** 站点规则链名(可被配置覆盖) */
export const siteChainNames = (cfg: TbsiteConfig) => ({
  rollup: cfg.rollup?.chainName || chainNames.rollup(cfg.site.name),
  alarm: cfg.alarm?.chainName || chainNames.alarm(cfg.site.name),
  revenue: chainNames.revenue(cfg.site.name),
})

export interface CompileOptions {
  /** 校验失败时抛 ConfigError(默认 true);false 则把错误放进 plan.validation.errors 并尽量继续 */
  throwOnError?: boolean
}

export function compile(
  original: TbsiteConfig,
  ids: IdMap = placeholderIds(original),
  opts: CompileOptions = {}
): WritePlan {
  const errors = validateConfig(original)
  if (errors.length && opts.throwOnError !== false) throw new ConfigError(errors)
  const { cfg, computations, notes } = expandConfig(original)
  const devIds = { ...placeholderIds(original).devices, ...ids.devices }
  const names = siteChainNames(cfg)

  const cfs = computations
    .filter(c => isCfTemplate(c.template))
    .map(c => ({
      device: c.device as string,
      output: c.output as string,
      template: c.template,
      body: buildCf(c, devIds[c.device as string] as string, devIds),
    }))

  const aggregates = computations
    .filter(c => c.template === 'aggregate.crossEntity')
    .map(c => {
      const members = resolveAggMembers(cfg, c)
      const bodies = buildAggCfs(c, members, devIds)
      return {
        output: c.output as string,
        asset: c.asset as string,
        members: members.map(m => m.name),
        layered: bodies.length > 1,
        bodies,
      }
    })

  const revs = computations.filter(c => c.template === 'revenue.periodic')
  const revenue = revs.length
    ? (() => {
        const assets = [...new Set(revs.map(c => c.asset as string))]
        const assetIds = Object.fromEntries(assets.map(a => [a, pick(ids.assets, 'asset', a)]))
        return {
          chainName: names.revenue,
          assets,
          items: revs,
          metadata: revenueMetadata(pick(ids.chains, 'chain', names.revenue), revs, devIds, assetIds),
        }
      })()
    : null

  const groups = rollupGroups(computations)
  const cascades = computations.filter(c => c.template === 'window.cascade')
  const rollup =
    Object.keys(groups).length || cascades.length
      ? {
          chainName: names.rollup,
          groups,
          cascades,
          metadata: rollupMetadata(pick(ids.chains, 'chain', names.rollup), groups, devIds, cascades),
        }
      : null

  const alarms = computations.filter(c => c.template === 'alarm.threshold')
  const alarm = alarms.length
    ? {
        chainName: names.alarm,
        rootFlowName: chainNames.rootFlow(cfg.site.name),
        items: alarms,
        metadata: alarmMetadata(pick(ids.chains, 'chain', names.alarm), alarms),
      }
    : null

  return {
    site: { name: cfg.site.name, assetType: 'tbsite' },
    validation: { errors, notes },
    computations,
    cfs,
    aggregates,
    revenue,
    rollup,
    alarm,
    siteAsset: { name: cfg.site.name, type: 'tbsite', attributes: { siteConfig: original } },
  }
}

/** 一行摘要,给 CLI / 向导「预览发布内容」用 */
export function summarizePlan(p: WritePlan): string[] {
  const lines = [
    `站点 ${p.site.name} · ${p.computations.length} 运算` +
      (p.validation.notes.length ? ` · ${p.validation.notes.join('; ')}` : ''),
    `计算字段 ${p.cfs.length} 个` + (p.cfs.length ? ':' + p.cfs.map(c => `${c.device}.${c.output}`).join(', ') : ''),
    `跨设备汇聚 ${p.aggregates.length} 项` +
      (p.aggregates.length
        ? ':' +
          p.aggregates.map(a => `${a.asset}.${a.output}(${a.members.length} 台${a.layered ? ',分层' : ''})`).join(', ')
        : ''),
    p.revenue
      ? `收益链「${p.revenue.chainName}」· ${p.revenue.items.length} 项 · ${p.revenue.metadata.nodes.length} 节点`
      : '收益链:无',
    p.rollup
      ? `聚合链「${p.rollup.chainName}」· ${Object.keys(p.rollup.groups).length} 条流水线 · ${p.rollup.cascades.length} 项多级归档 · ${p.rollup.metadata.nodes.length} 节点`
      : '聚合链:无',
    p.alarm
      ? `告警链「${p.alarm.chainName}」· ${p.alarm.items.length} 条规则 · ${p.alarm.metadata.nodes.length} 节点 + Root 转发「${p.alarm.rootFlowName}」`
      : '告警链:无',
    `站点资产「${p.siteAsset.name}」(${p.siteAsset.type})写入 siteConfig 属性并公开`,
  ]
  return lines
}
