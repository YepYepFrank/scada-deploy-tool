// 站点清理:删除本站点生成的 CF / 规则链 / Root 转发节点 / 汇聚资产 / 站点资产。
// 只清理「当前配置声明过的东西」,不碰任何存量对象。
import type { TbsiteConfig } from '../types'
import { AGG_ASSET_TYPE, chainNames, isCfTemplate, SITE_ASSET_TYPE } from '../core/constants'
import { expandConfig, siteChainNames } from '../core/plan'
import { listCfs, type Reporter, type TbApi } from './api'

const q = (s: string) => encodeURIComponent(s)
const msg = (e: unknown) => (e instanceof Error ? e.message : String(e))

export async function cleanup(
  original: TbsiteConfig,
  devIds: Record<string, string>,
  api: TbApi,
  report?: Reporter
): Promise<string> {
  const log: string[] = []
  const { cfg, computations } = expandConfig(original)
  const names = siteChainNames(cfg)
  // 1. 计算字段
  const outputsByDev: Record<string, Set<string>> = {}
  for (const c of computations)
    if (isCfTemplate(c.template)) (outputsByDev[c.device as string] ||= new Set()).add(c.output as string)
  let cfDel = 0
  for (const [dev, outs] of Object.entries(outputsByDev)) {
    const hostId = devIds[dev]
    if (!hostId) continue
    try {
      for (const f of await listCfs(api, 'DEVICE', hostId))
        if (outs.has(f.name)) {
          await api(`/api/calculatedField/${f.id.id}`, null, 'DELETE')
          cfDel++
        }
    } catch (e) {
      log.push(`CF ${dev}: ${msg(e)}`)
    }
  }
  report?.('cleanup', 'run', `已删计算字段 ${cfDel}`)
  // 2. Root 链上的本站点转发节点
  const flowName = chainNames.rootFlow(cfg.site.name)
  try {
    const page = await api('/api/ruleChains?pageSize=100&page=0')
    const chains: { id: { id: string }; name: string; root?: boolean }[] = page?.data || []
    const root = chains.find(c => c.root)
    if (root) {
      const meta = await api(`/api/ruleChain/${root.id.id}/metadata`)
      const idx = (meta.nodes as { name: string }[]).findIndex(n => n.name === flowName)
      if (idx >= 0) {
        meta.nodes.splice(idx, 1)
        meta.connections = ((meta.connections || []) as { fromIndex: number; toIndex: number }[])
          .filter(c => c.fromIndex !== idx && c.toIndex !== idx)
          .map(c => ({
            ...c,
            fromIndex: c.fromIndex > idx ? c.fromIndex - 1 : c.fromIndex,
            toIndex: c.toIndex > idx ? c.toIndex - 1 : c.toIndex,
          }))
        if (meta.firstNodeIndex > idx) meta.firstNodeIndex--
        await api('/api/ruleChain/metadata', meta)
        log.push('Root 转发节点已摘除')
      }
    }
    // 3. 站点规则链
    for (const name of [names.alarm, names.rollup, names.revenue]) {
      const found = chains.find(c => c.name === name && !c.root)
      if (found) {
        await api(`/api/ruleChain/${found.id.id}`, null, 'DELETE')
        log.push(`已删规则链 ${name}`)
      }
    }
  } catch (e) {
    log.push(`规则链清理: ${msg(e)}`)
  }
  // 4. 汇聚 / 收益资产(工具创建的 tbsite-agg 类型,连同其上的 CF 一并删除)
  for (const c of computations.filter(
    x => x.template === 'aggregate.crossEntity' || x.template === 'revenue.periodic'
  )) {
    const asset = c.asset as string
    try {
      const assets: { id: { id: string }; name: string; type: string }[] =
        (await api(`/api/tenant/assets?pageSize=100&page=0&textSearch=${q(asset)}`))?.data || []
      const a = assets.find(x => x.name === asset && x.type === AGG_ASSET_TYPE)
      if (a) {
        await api(`/api/asset/${a.id.id}`, null, 'DELETE')
        log.push(`已删汇聚资产 ${asset}`)
      }
    } catch (e) {
      log.push(`汇聚资产 ${asset}: ${msg(e)}`)
    }
  }
  // 5. 站点资产
  try {
    const assets: { id: { id: string }; name: string; type: string }[] =
      (await api(`/api/tenant/assets?pageSize=100&page=0&textSearch=${q(cfg.site.name)}`))?.data || []
    const asset = assets.find(a => a.name === cfg.site.name && a.type === SITE_ASSET_TYPE)
    if (asset) {
      await api(`/api/asset/${asset.id.id}`, null, 'DELETE')
      log.push('站点资产已删除')
    }
  } catch (e) {
    log.push(`资产清理: ${msg(e)}`)
  }
  return `计算字段 ×${cfDel}` + (log.length ? ' · ' + log.join(' · ') : '')
}
