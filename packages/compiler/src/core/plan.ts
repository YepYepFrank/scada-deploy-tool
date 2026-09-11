// 编译入口:tbsite 配置 → 写入计划(纯函数,无网络)。
// 写入器与 CLI `plan` 都从这里出发;id 未知时用占位串,写入器拿到真实 id 后再按需重建规则链元数据。
import type { Computation, IdMap, TbsiteConfig, WritePlan } from '../types'
import { alarmMetadata } from './alarm'
import { buildAggCfs, resolveAggMembers } from './aggregate'
import { buildCf, cfHost } from './cf'
import { chainNames, isCfTemplate } from './constants'
import { revenueMetadata } from './revenue'
import { rollupGroups, rollupMetadata } from './rollup'
import { applyOutputPrefix, cascadeWhitelist, outputInventory, outputPrefixOf } from './prefix'
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

/**
 * 模板展开 + 并入手工运算项(模板项在前,便于同名输出被手工项覆盖时以手工项为准)+ 输出前缀(ADR-003)。
 * 返回的 computations 已带前缀;写入器、清理器、CLI 都从这里出发,保证四处看到同一组名字。
 */
export function expandConfig(cfg: TbsiteConfig): {
  cfg: TbsiteConfig
  computations: Computation[]
  notes: string[]
  prefix: string
} {
  const expanded = expandTemplates(cfg)
  const prefix = outputPrefixOf(cfg)
  const computations = applyOutputPrefix([...expanded.computations, ...(cfg.computations || [])], prefix)
  return { cfg: { ...cfg, computations }, computations, notes: expanded.notes, prefix }
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
  const { cfg, computations, notes, prefix } = expandConfig(original)
  const devIds = { ...placeholderIds(original).devices, ...ids.devices }
  const names = siteChainNames(cfg)
  const outputs = outputInventory(cfg, computations, prefix)
  const cascadeKeys = cascadeWhitelist(cfg, computations, prefix)

  const cfs = computations
    .filter(c => isCfTemplate(c.template))
    .map(c => {
      const host = cfHost(c)
      const base = { output: c.output as string, template: c.template, ...(c.adopted ? { adopted: true } : {}) }
      // 设备宿主的条目形状与冻结的 Python 版一致(parity);资产宿主是 TS 版新增,带 asset 不带 device
      return host.entityType === 'ASSET'
        ? {
            asset: host.name,
            ...base,
            body: buildCf(c, pick(ids.assets, 'asset', host.name), devIds, 'ASSET'),
          }
        : { device: host.name, ...base, body: buildCf(c, devIds[host.name] as string, devIds) }
    })

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
          metadata: rollupMetadata(pick(ids.chains, 'chain', names.rollup), groups, devIds, cascades, prefix),
        }
      : null

  const alarms = computations.filter(c => c.template === 'alarm.threshold')
  const alarm = alarms.length
    ? {
        chainName: names.alarm,
        rootFlowName: chainNames.rootFlow(cfg.site.name),
        items: alarms,
        metadata: alarmMetadata(
          pick(ids.chains, 'chain', names.alarm),
          alarms,
          prefix ? { prefix, whitelist: cascadeKeys } : undefined,
          { propagate: !!cfg.alarm?.propagate }
        ),
      }
    : null

  return {
    site: { name: cfg.site.name, assetType: 'tbsite' },
    validation: { errors, notes },
    outputPrefix: prefix,
    outputs,
    cascadeKeys,
    computations,
    cfs,
    aggregates,
    revenue,
    rollup,
    alarm,
    siteAsset: {
      name: cfg.site.name,
      type: 'tbsite',
      attributes: prefix ? { siteConfig: original, calcCascadeKeys: cascadeKeys } : { siteConfig: original },
    },
  }
}

/** 一行摘要,给 CLI / 向导「预览发布内容」用 */
export function summarizePlan(p: WritePlan): string[] {
  const lines = [
    `站点 ${p.site.name} · ${p.computations.length} 运算` +
      (p.validation.notes.length ? ` · ${p.validation.notes.join('; ')}` : ''),
    `计算字段 ${p.cfs.length} 个` +
      (p.cfs.length
        ? ':' + p.cfs.map(c => (c.asset ? `资产 ${c.asset}.${c.output}` : `${c.device}.${c.output}`)).join(', ')
        : ''),
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
      ? `告警链「${p.alarm.chainName}」· ${p.alarm.items.length} 条规则 · ${p.alarm.metadata.nodes.length} 节点(Root 上的转发节点「${p.alarm.rootFlowName}」由高潮维护,工具不写)`
      : '告警链:无',
    `站点资产「${p.siteAsset.name}」(${p.siteAsset.type})写入 siteConfig 属性` +
      (p.outputPrefix ? ` + calcCascadeKeys(${p.cascadeKeys.length} 个级联键)` : ''),
  ]
  if (p.outputPrefix)
    lines.splice(
      1,
      0,
      `输出前缀 ${p.outputPrefix}(ADR-003)· 共 ${p.outputs.length} 个输出 key` +
        (p.cascadeKeys.length ? ` · 级联白名单:${p.cascadeKeys.join(', ')}` : '')
    )
  return lines
}
