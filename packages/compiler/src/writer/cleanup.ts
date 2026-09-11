// 站点清理:删除本站点生成的 CF / 规则链 / 汇聚资产 / 站点资产。
// 只清理「当前配置声明过的东西」,不碰任何存量对象;接管来的计算字段不删,交还(去掉归属标记)。
// Root 链由高潮维护,这里一个字节都不写:Root 上还转发着的本站点链只清空不删,等高潮摘掉节点后再删。
import type { TbsiteConfig } from '../types'
import { AGG_ASSET_TYPE, isCfTemplate, SITE_ASSET_TYPE } from '../core/constants'
import { cfHost } from '../core/cf'
import { expandConfig, siteChainNames } from '../core/plan'
import { findAsset, listCfs, type Reporter, type TbApi } from './api'
import { emptyChain, rootForwardsTo } from './publish'
import { handBackCf } from './sync'

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
  // 1. 计算字段(宿主是设备,或跨设备运算的结果资产);字段名 → 是否接管来的
  const byHost: Record<string, { entityType: 'DEVICE' | 'ASSET'; name: string; cfs: Map<string, boolean> }> = {}
  for (const c of computations)
    if (isCfTemplate(c.template)) {
      const h = cfHost(c)
      ;(byHost[`${h.entityType}|${h.name}`] ||= { ...h, cfs: new Map() }).cfs.set(
        c.cfName || (c.output as string),
        !!c.adopted
      )
    }
  let cfDel = 0,
    handed = 0
  for (const { entityType, name, cfs } of Object.values(byHost)) {
    try {
      const hostId = entityType === 'DEVICE' ? devIds[name] : (await findAsset(api, name))?.id.id
      if (!hostId) continue
      for (const f of await listCfs(api, entityType, hostId)) {
        if (!cfs.has(f.name)) continue
        if (cfs.get(f.name)) {
          if (await handBackCf(api, f)) handed++
        } else {
          await api(`/api/calculatedField/${f.id.id}`, null, 'DELETE')
          cfDel++
        }
      }
    } catch (e) {
      log.push(`CF ${name}: ${msg(e)}`)
    }
  }
  report?.('cleanup', 'run', `已删计算字段 ${cfDel}` + (handed ? ` · 交还 ${handed}` : ''))
  // 2. 站点规则链(Root 还转发着的只清空不删)
  try {
    const chains: { id: { id: string }; name: string; root?: boolean }[] =
      (await api('/api/ruleChains?pageSize=100&page=0'))?.data || []
    for (const name of [names.alarm, names.rollup, names.revenue]) {
      const found = chains.find(c => c.name === name && !c.root)
      if (!found) continue
      if (await rootForwardsTo(api, found.id.id)) {
        await emptyChain(api, found.id.id)
        log.push(`${name} 已清空未删(Root 链上还有转发到它的节点,请高潮摘除后再删)`)
      } else {
        await api(`/api/ruleChain/${found.id.id}`, null, 'DELETE')
        log.push(`已删规则链 ${name}`)
      }
    }
  } catch (e) {
    log.push(`规则链清理: ${msg(e)}`)
  }
  // 3. 汇聚 / 收益 / 跨设备运算结果资产(工具创建的 tbsite-agg 类型,连同其上的 CF 一并删除);
  //    接管来的运算所在资产不在此列(那是别人的资产)
  const toolAssets = new Set(
    computations
      .filter(
        x =>
          x.template === 'aggregate.crossEntity' ||
          x.template === 'revenue.periodic' ||
          (isCfTemplate(x.template) && !x.adopted && cfHost(x).entityType === 'ASSET')
      )
      .map(x => x.asset as string)
  )
  for (const asset of toolAssets) {
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
  // 4. 站点资产
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
  return (
    `计算字段 ×${cfDel}` + (handed ? ` · 交还接管的 ${handed} 个` : '') + (log.length ? ' · ' + log.join(' · ') : '')
  )
}
