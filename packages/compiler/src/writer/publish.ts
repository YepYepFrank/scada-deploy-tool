// 写入器:按步骤把写入计划落到 TB。report(stepId, 'run'|'ok'|'err', detail) 汇报进度。
// 返回失败清单 [{step, device?, output?, error}];为空即全部成功。所有写入幂等,重跑安全。
import type { Computation, TbsiteConfig } from '../types'
import { alarmMetadata } from '../core/alarm'
import { buildAggCfs, resolveAggMembers } from '../core/aggregate'
import { buildCf } from '../core/cf'
import { AGG_ASSET_TYPE, chainNames, isCfTemplate, SITE_ASSET_TYPE } from '../core/constants'
import { cascadeWhitelist, outputInventory, outputPrefixOf } from '../core/prefix'
import { ConfigError, expandConfig, siteChainNames } from '../core/plan'
import { revenueMetadata } from '../core/revenue'
import { rollupGroups, rollupMetadata } from '../core/rollup'
import { validateConfig } from '../core/validate'
import { checkChainHealth, type ChainTarget } from './health'
import {
  findAsset,
  findDevice,
  ensureAsset,
  ensureChain,
  listCfs,
  type PublishFailure,
  type Reporter,
  type RetryScope,
  type TbApi,
} from './api'

export interface PublishOptions {
  /** 写入发布历史的操作者 */
  publishedBy?: string
  /** 只重发上次失败项 */
  retry?: RetryScope | null
  /** 分层汇聚时等分组遥测落库的毫秒数(测试可设 0) */
  layeredSettleMs?: number
  /** 发布后核对规则节点是否真的起来了(默认开;见 writer/health.ts) */
  checkHealth?: boolean
  /** 自检等事件落库的毫秒数(测试可设 0) */
  healthWaitMs?: number
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

/** Root 链上接一条本站点的转发节点(Post telemetry → 站点告警链) */
export async function wireRootChain(api: TbApi, alarmChainId: string, siteName: string): Promise<string> {
  const flowName = chainNames.rootFlow(siteName)
  const page = await api('/api/ruleChains?pageSize=100&page=0')
  const root = (page?.data || []).find((c: { root?: boolean }) => c.root)
  if (!root) throw new Error('未找到 Root 规则链')
  const meta = await api(`/api/ruleChain/${root.id.id}/metadata`)
  const flow = meta.nodes.find((n: { name: string }) => n.name === flowName)
  if (flow) {
    if (flow.configuration.ruleChainId === alarmChainId) return '转发已就位'
    flow.configuration.ruleChainId = alarmChainId
  } else {
    const switchI = meta.nodes.findIndex((n: { type: string }) => n.type.endsWith('TbMsgTypeSwitchNode'))
    if (switchI < 0) throw new Error('Root 链缺少 Message Type Switch 节点')
    meta.nodes.push({
      type: 'org.thingsboard.rule.engine.flow.TbRuleChainInputNode',
      name: flowName,
      configuration: { ruleChainId: alarmChainId, forwardMsgToDefaultRuleChain: false },
      additionalInfo: { layoutX: 900, layoutY: 600 },
    })
    meta.connections = meta.connections || []
    meta.connections.push({ fromIndex: switchI, toIndex: meta.nodes.length - 1, type: 'Post telemetry' })
  }
  await api('/api/ruleChain/metadata', meta)
  return 'Root 链已接线'
}

/** 上一版 siteConfig 声明过、这一版不再声明的输出 CF:按名删除(只删本站点自己写过的名字,不碰存量) */
async function pruneStaleCfs(
  cfg: TbsiteConfig,
  computations: Computation[],
  devIds: Record<string, string>,
  api: TbApi
): Promise<number> {
  const site = await findAsset(api, cfg.site.name)
  if (!site) return 0
  const attrs: { key: string; value: unknown }[] =
    (await api(`/api/plugins/telemetry/ASSET/${site.id.id}/values/attributes/SERVER_SCOPE?keys=siteConfig`)) || []
  const raw = attrs.find(a => a.key === 'siteConfig')?.value
  if (!raw) return 0
  const prevCfg = (typeof raw === 'string' ? JSON.parse(raw) : raw) as TbsiteConfig
  const prev = expandConfig(prevCfg)
  const prevOut = outputInventory(prev.cfg, prev.computations, prev.prefix).filter(
    o => o.kind === 'cf' || o.kind === 'agg'
  )
  const nextKeys = new Set(
    outputInventory(cfg, computations, outputPrefixOf(cfg)).map(o => `${o.entityType}|${o.entity}|${o.key}`)
  )
  const stale = prevOut.filter(o => !nextKeys.has(`${o.entityType}|${o.entity}|${o.key}`))
  if (!stale.length) return 0
  let n = 0
  const idCache: Record<string, string | null> = {}
  const idOf = async (o: (typeof stale)[number]) => {
    const k = `${o.entityType}|${o.entity}`
    if (!(k in idCache)) {
      if (o.entityType === 'DEVICE') idCache[k] = devIds[o.entity] ?? (await findDevice(api, o.entity))?.id.id ?? null
      else idCache[k] = (await findAsset(api, o.entity))?.id.id ?? null
    }
    return idCache[k]
  }
  const cfCache: Record<string, { id: { id: string }; name: string }[]> = {}
  for (const o of stale) {
    const eid = await idOf(o)
    if (!eid) continue
    cfCache[eid] ||= await listCfs(api, o.entityType, eid)
    const f = cfCache[eid].find(x => x.name === o.key)
    if (f) {
      await api(`/api/calculatedField/${f.id.id}`, null, 'DELETE')
      n++
    }
  }
  return n
}

/** 汇聚 / 收益资产分给站点资产所属 Customer,并建 站点 Contains 资产 关系(幂等) */
async function followSiteAsset(
  cfg: TbsiteConfig,
  computations: Computation[],
  siteAssetId: string,
  api: TbApi
): Promise<number> {
  const site = await api(`/api/asset/${siteAssetId}`)
  const customerId: string | undefined = site?.customerId?.id
  const names = [
    ...new Set(
      computations
        .filter(c => c.template === 'aggregate.crossEntity' || c.template === 'revenue.periodic')
        .map(c => c.asset as string)
    ),
  ]
  let n = 0
  for (const name of names) {
    const a = await findAsset(api, name)
    if (!a || a.id.id === siteAssetId) continue
    await api('/api/relation', {
      from: { entityType: 'ASSET', id: siteAssetId },
      to: { entityType: 'ASSET', id: a.id.id },
      type: 'Contains',
      typeGroup: 'COMMON',
    })
    if (customerId && a.customerId?.id !== customerId) await api(`/api/customer/${customerId}/asset/${a.id.id}`, {})
    n++
  }
  return n
}

export async function publish(
  original: TbsiteConfig,
  devIds: Record<string, string>,
  api: TbApi,
  report: Reporter,
  opts: PublishOptions = {}
): Promise<PublishFailure[]> {
  const { publishedBy = '', retry = null, layeredSettleMs = 3000, checkHealth = true, healthWaitMs } = opts
  const startedAt = Date.now()
  const failures: PublishFailure[] = []
  const stepOn = (id: RetryScope['steps'][number]) => !retry || retry.steps.includes(id)
  const fail = (step: PublishFailure['step'], e: unknown, extra: Partial<PublishFailure> = {}) => {
    const error = e instanceof Error ? e.message : String(e)
    report(step, 'err', error)
    failures.push({ step, error, ...extra })
  }

  // 1. 校验 + 模板展开
  report('validate', 'run')
  const errs = validateConfig(original)
  if (errs.length) {
    report('validate', 'err', errs.join(';'))
    throw new ConfigError(errs)
  }
  const { cfg, computations, notes, prefix } = expandConfig(original)
  const expandedCount = computations.length - (original.computations || []).length
  report(
    'validate',
    'ok',
    `${cfg.devices.length} 设备 · ${computations.length} 运算` +
      (expandedCount ? `(模板展开 ${expandedCount} 条)` : '') +
      (prefix ? ` · 输出前缀 ${prefix}` : '') +
      (notes.length ? ` · ${notes.join('; ')}` : '')
  )
  const names = siteChainNames(cfg)

  // 2. 设备核对(v2:只认领,绝不创建)
  report('devices', 'run')
  const missing = cfg.devices.filter(d => !devIds[d.name]).map(d => d.name)
  if (missing.length) {
    const e = new Error(`设备 ${missing[0]} 在 TB 中不存在`)
    report('devices', 'err', e.message)
    throw e
  }
  report('devices', 'ok', `${cfg.devices.length} 台全部就绪`)

  // 3. 计算字段 — 逐条容错:单台设备失败不拖垮整批
  report('cf', 'run')
  if (!stepOn('cf')) report('cf', 'ok', '跳过(上次已成功)')
  else {
    // 3a. 先清掉上一版配置声明过、这一版不再有的输出 CF(配置即真相;也给单实体 CF 上限腾位)
    const pruned = await pruneStaleCfs(cfg, computations, devIds, api).catch(e => {
      failures.push({
        step: 'cf',
        error: '清理旧输出失败(不影响本次写入):' + (e instanceof Error ? e.message : String(e)),
      })
      return 0
    })
    let cfComps = computations.filter(c => isCfTemplate(c.template))
    if (retry?.cf?.length) {
      const want = new Set(retry.cf.map(x => `${x.device}@@${x.output}`))
      cfComps = cfComps.filter(c => want.has(`${c.device}@@${c.output}`))
    }
    let created = 0,
      updated = 0,
      failed = 0
    const cfCache: Record<string, { id: { id: string }; name: string }[]> = {}
    for (const c of cfComps) {
      const device = c.device as string
      const output = c.output as string
      try {
        const hostId = devIds[device] as string
        const body = buildCf(c, hostId, devIds)
        cfCache[hostId] ||= await listCfs(api, 'DEVICE', hostId)
        const existing = cfCache[hostId].find(x => x.name === output)
        if (existing) {
          body.id = existing.id
          updated++
        } else created++
        const saved = await api('/api/calculatedField', body)
        if (!existing && saved?.id) cfCache[hostId].push({ id: saved.id, name: output })
        report('cf', 'run', `${created + updated + failed}/${cfComps.length} · ${device}`)
      } catch (e) {
        failed++
        failures.push({ step: 'cf', device, output, error: e instanceof Error ? e.message : String(e) })
      }
    }
    const detail = cfComps.length
      ? `新建 ${created} · 更新 ${updated}` +
        (pruned ? ` · 清理旧输出 ${pruned}` : '') +
        (failed ? ` · 失败 ${failed}(见下方失败清单)` : '') +
        (retry?.cf?.length ? ` · 重试范围 ${cfComps.length} 条` : '')
      : '无'
    report('cf', failed ? 'err' : 'ok', detail)
  }

  // 3b. 跨设备汇聚 → 独立虚拟资产上的 CF(逐项容错)
  report('agg', 'run')
  if (!stepOn('agg')) report('agg', 'ok', '跳过(上次已成功)')
  else {
    let aggs = computations.filter(c => c.template === 'aggregate.crossEntity')
    if (retry?.agg?.length) aggs = aggs.filter(c => retry.agg!.includes(c.output as string))
    if (aggs.length) {
      let cfCount = 0,
        aggFailed = 0
      for (const c of aggs) {
        try {
          const members = resolveAggMembers(cfg, c)
          const { id: aid } = await ensureAsset(api, c.asset as string, AGG_ASSET_TYPE)
          for (const m of members)
            await api('/api/relation', {
              from: { entityType: 'ASSET', id: aid },
              to: { entityType: 'DEVICE', id: devIds[m.name] },
              type: 'Contains',
              typeGroup: 'COMMON',
            })
          const existing = await listCfs(api, 'ASSET', aid)
          const bodies = buildAggCfs(c, members, devIds)
          const layered = bodies.length > 1
          // CF 只在创建时初始化计算——分层时汇总 CF 须等分组遥测落库后删除重建
          for (const body of layered ? bodies.slice(0, -1) : bodies) {
            body.entityId = { entityType: 'ASSET', id: aid }
            const ex = existing.find(x => x.name === body.name)
            if (ex) body.id = ex.id
            await api('/api/calculatedField', body)
            cfCount++
          }
          if (layered) {
            if (layeredSettleMs > 0) await sleep(layeredSettleMs)
            const final = bodies[bodies.length - 1]!
            final.entityId = { entityType: 'ASSET', id: aid }
            const ex = existing.find(x => x.name === final.name)
            if (ex) await api(`/api/calculatedField/${ex.id.id}`, null, 'DELETE')
            await api('/api/calculatedField', final)
            cfCount++
          }
        } catch (e) {
          aggFailed++
          failures.push({ step: 'agg', output: c.output as string, error: e instanceof Error ? e.message : String(e) })
        }
      }
      report(
        'agg',
        aggFailed ? 'err' : 'ok',
        `${aggs.length - aggFailed} 项汇聚 · ${cfCount} 个资产计算字段` +
          (aggFailed ? ` · 失败 ${aggFailed}(见下方失败清单)` : '')
      )
    } else report('agg', 'ok', '无')
  }

  // 3c. 分时电价收益 → 独立规则链 + 收益资产
  report('revenue', 'run')
  if (!stepOn('revenue')) report('revenue', 'ok', '跳过(上次已成功)')
  else
    try {
      const revs = computations.filter(c => c.template === 'revenue.periodic')
      if (revs.length) {
        const assetIds: Record<string, string> = {}
        for (const c of revs) {
          const { id } = await ensureAsset(api, c.asset as string, AGG_ASSET_TYPE)
          assetIds[c.asset as string] = id
        }
        const { id, created } = await ensureChain(api, names.revenue)
        await api('/api/ruleChain/metadata', revenueMetadata(id, revs, devIds, assetIds))
        report(
          'revenue',
          'ok',
          `${revs.length} 项收益统计 → ${names.revenue}` + (created ? '(新建定时链需 TB 重启后才开始跑)' : '')
        )
      } else report('revenue', 'ok', '无')
    } catch (e) {
      fail('revenue', e)
    }

  // 4. 聚合链
  report('rollup', 'run')
  if (!stepOn('rollup')) report('rollup', 'ok', '跳过(上次已成功)')
  else
    try {
      const groups = rollupGroups(computations)
      const cascades = computations.filter(c => c.template === 'window.cascade')
      if (Object.keys(groups).length || cascades.length) {
        const { id, created } = await ensureChain(api, names.rollup)
        await api('/api/ruleChain/metadata', rollupMetadata(id, groups, devIds, cascades, prefix))
        report(
          'rollup',
          'ok',
          `${Object.keys(groups).length} 条流水线 · ${cascades.length} 项多级归档 → ${names.rollup}` +
            (created ? '(新建定时链需 TB 重启后才开始跑)' : '')
        )
      } else report('rollup', 'ok', '无')
    } catch (e) {
      fail('rollup', e)
    }

  // 5. 告警链 + Root 转发
  report('alarm', 'run')
  if (!stepOn('alarm')) report('alarm', 'ok', '跳过(上次已成功)')
  else
    try {
      const alarms = computations.filter(c => c.template === 'alarm.threshold')
      if (alarms.length) {
        const { id } = await ensureChain(api, names.alarm)
        await api(
          '/api/ruleChain/metadata',
          alarmMetadata(
            id,
            alarms,
            prefix ? { prefix, whitelist: cascadeWhitelist(cfg, computations, prefix) } : undefined,
            { propagate: !!cfg.alarm?.propagate }
          )
        )
        const wired = await wireRootChain(api, id, cfg.site.name)
        report('alarm', 'ok', `${alarms.length} 条规则 · ${wired}`)
      } else report('alarm', 'ok', '无')
    } catch (e) {
      fail('alarm', e)
    }

  // 6. 站点配置写入(保存原始声明,不含展开产物;不再设为 Public,T3.7)
  report('asset', 'run')
  if (!stepOn('asset')) report('asset', 'ok', '跳过(上次已成功)')
  else
    try {
      const { id } = await ensureAsset(api, cfg.site.name, SITE_ASSET_TYPE)
      // 发布历史:上一版配置入栈,保留最近 10 版(约 <300KB,属性存储可承受)
      let history: unknown[] = []
      try {
        const attrs: { key: string; value: unknown }[] =
          (await api(
            `/api/plugins/telemetry/ASSET/${id}/values/attributes/SERVER_SCOPE?keys=siteConfig,siteConfigHistory`
          )) || []
        const prev = attrs.find(a => a.key === 'siteConfig')?.value
        const rawHist = attrs.find(a => a.key === 'siteConfigHistory')?.value
        history = ((typeof rawHist === 'string' ? JSON.parse(rawHist) : rawHist) as unknown[]) || []
        if (prev) {
          const prevCfg = typeof prev === 'string' ? JSON.parse(prev) : prev
          history.unshift({ ts: Date.now(), by: publishedBy, cfg: prevCfg })
          history = history.slice(0, 10)
        }
      } catch {
        /* 历史读取失败不阻塞发布 */
      }
      const attrBody: Record<string, unknown> = { siteConfig: original, siteConfigHistory: history }
      if (prefix) attrBody.calcCascadeKeys = cascadeWhitelist(cfg, computations, prefix)
      await api(`/api/plugins/telemetry/ASSET/${id}/attributes/SERVER_SCOPE`, attrBody)
      // 不再「设为 Public」(T3.7 移除):页面资产由 publishPage 分给站点所属 Customer,站点资产按 T3.8 处理。
      // 汇聚 / 收益资产跟随站点资产:同一 Customer 可见 + 站点 Contains 关系(编辑器资产树、Customer 视角都靠这两条)
      const followed = await followSiteAsset(cfg, computations, id, api)
      report(
        'asset',
        'ok',
        `资产 ${cfg.site.name} · 历史 ${history.length} 版` + (followed ? ` · 汇聚资产随站点 ${followed}` : '')
      )
    } catch (e) {
      fail('asset', e)
    }

  // 7. 发布后自检:刚写进去的规则节点是不是真的起来了(配置字段名不对时 TB 只在 LC_EVENT 里留痕,
  //    消息会被静默丢弃 —— 2026-09-08 建告警节点就这样悄悄失败了一天多)
  if (checkHealth) {
    report('health', 'run')
    const alarms = computations.filter(c => c.template === 'alarm.threshold')
    const cascades = computations.filter(c => c.template === 'window.cascade')
    const revs = computations.filter(c => c.template === 'revenue.periodic')
    const targets: ChainTarget[] = []
    if (alarms.length) {
      targets.push({ name: names.alarm })
      // Root 链上只查我们加的那条转发节点,别人的节点不归我们管、也不该由我们的发布来判定
      targets.push({ root: true, nodes: [chainNames.rootFlow(cfg.site.name)] })
    }
    if (Object.keys(rollupGroups(computations)).length || cascades.length) targets.push({ name: names.rollup })
    if (revs.length) targets.push({ name: names.revenue })
    const h = await checkChainHealth(api, targets, {
      since: startedAt,
      ...(healthWaitMs !== undefined ? { waitMs: healthWaitMs } : {}),
    })
    if (h.problems.length) {
      for (const p of h.problems)
        failures.push({
          step: 'health',
          output: `${p.chain} · ${p.node}`,
          error: `节点没能启动(${p.nodeType}):${p.error}`,
        })
      report('health', 'err', `${h.problems.length} 个节点没能启动,进入它们的消息会被静默丢弃`)
    } else if (h.skipped) report('health', 'ok', `跳过(${h.skipped})`)
    else
      report(
        'health',
        'ok',
        `${h.checked} 个节点已启动` + (h.pending.length ? `,${h.pending.length} 个暂无事件(未判定)` : '')
      )
  }
  return failures
}
