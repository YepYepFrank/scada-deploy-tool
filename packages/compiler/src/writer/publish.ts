// 写入器:按步骤把写入计划落到 TB。report(stepId, 'run'|'ok'|'err', detail) 汇报进度。
// 返回失败清单 [{step, device?, output?, error}];为空即全部成功。所有写入幂等,重跑安全。
//
// 2026-09-11 起:
//   · 写进 TB 的计算字段 / 资产 / 规则链带归属标记(core/constants ownerInfo),清理只认本站点的标记或上一版声明;
//   · 更新计算字段带 version(乐观锁),Root 链读改写本来就带 version——别人先改过就报冲突、不覆盖;
//   · 规则链内容没变就不重写(TB 每写一次元数据就重启链上全部节点,定时器从头计时)。
import type { Computation, RuleChainMetadata, TbsiteConfig } from '../types'
import { alarmMetadata } from '../core/alarm'
import { buildAggCfs, resolveAggMembers } from '../core/aggregate'
import { buildCf, cfHost } from '../core/cf'
import {
  AGG_ASSET_TYPE,
  chainNames,
  customerIdOf,
  isCfTemplate,
  ownerInfo,
  ownerOf,
  SITE_ASSET_TYPE,
} from '../core/constants'
import { cascadeWhitelist, outputInventory, outputPrefixOf, type OutputKey } from '../core/prefix'
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
  type TbCf,
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

/** TB 带 version 保存时,别人先改过会回 409:翻成人话,并说明这次没有覆盖对方 */
export function versionConflict(e: unknown, what: string): Error {
  const m = e instanceof Error ? e.message : String(e)
  return /HTTP 409\b/.test(m)
    ? new Error(`${what}刚被别人改过(版本冲突),这次没有写入、也没有覆盖对方的修改;请重新同步后再发布`)
    : e instanceof Error
      ? e
      : new Error(m)
}

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
  // 读回来的元数据带 version:同事恰好也在改 Root 时 TB 会回 409,不会把他的修改覆盖掉
  try {
    await api('/api/ruleChain/metadata', meta)
  } catch (e) {
    throw versionConflict(e, 'Root 规则链')
  }
  return 'Root 链已接线'
}

/** Root 链上摘掉本站点的转发节点(wireRootChain 的反操作);返回是否摘到了 */
export async function unwireRootChain(api: TbApi, siteName: string): Promise<boolean> {
  const flowName = chainNames.rootFlow(siteName)
  const page = await api('/api/ruleChains?pageSize=100&page=0')
  const root = ((page?.data || []) as { id: { id: string }; root?: boolean }[]).find(c => c.root)
  if (!root) return false
  const meta = await api(`/api/ruleChain/${root.id.id}/metadata`)
  const idx = ((meta?.nodes || []) as { name: string }[]).findIndex(n => n.name === flowName)
  if (idx < 0) return false
  meta.nodes.splice(idx, 1)
  // 删掉一个节点后,连线里大于该下标的索引要整体前移一位
  meta.connections = ((meta.connections || []) as { fromIndex: number; toIndex: number }[])
    .filter(c => c.fromIndex !== idx && c.toIndex !== idx)
    .map(c => ({
      ...c,
      fromIndex: c.fromIndex > idx ? c.fromIndex - 1 : c.fromIndex,
      toIndex: c.toIndex > idx ? c.toIndex - 1 : c.toIndex,
    }))
  if (typeof meta.firstNodeIndex === 'number' && meta.firstNodeIndex > idx) meta.firstNodeIndex--
  try {
    await api('/api/ruleChain/metadata', meta)
  } catch (e) {
    throw versionConflict(e, 'Root 规则链')
  }
  return true
}

type MetaLike = {
  firstNodeIndex?: number | null
  nodes?: { type: string; name: string; configuration?: unknown }[]
  connections?: { fromIndex: number; toIndex: number; type: string }[]
}
/**
 * 计划里的值是不是「包含于」TB 读回的值。TB 保存节点时会补默认字段(如 TbMsgTimeseriesNode 的
 * processingSettings)、去掉值为 null 的字段(如 generator 的 queueName)——2026-09-11 镜像实测,
 * 所以不能整串比。计划里写了的每个字段都要一致;TB 多出来的字段不算变化;null 与缺失等价。
 * 代价:以后编译器「删掉」某个配置字段时这里认不出变化——那种改动要连带改节点名,或在 TB 里手动重存一次。
 */
const covers = (p: unknown, c: unknown): boolean => {
  if (p === null || p === undefined) return c === null || c === undefined
  if (Array.isArray(p)) return Array.isArray(c) && c.length === p.length && p.every((x, i) => covers(x, c[i]))
  if (typeof p === 'object') {
    if (!c || typeof c !== 'object' || Array.isArray(c)) return false
    const cur = c as Record<string, unknown>
    return Object.entries(p as Record<string, unknown>).every(([k, v]) => covers(v, cur[k]))
  }
  return p === c
}
/** 规则链元数据的「内容」是否一致:节点(类型 / 名字 / 配置)+ 连线 + 起点;不看 id、坐标、版本 */
const sameMeta = (planned: MetaLike, cur: MetaLike): boolean => {
  const pn = planned.nodes ?? []
  const cn = cur.nodes ?? []
  if ((planned.firstNodeIndex ?? null) !== (cur.firstNodeIndex ?? null) || pn.length !== cn.length) return false
  const nodesSame = pn.every(
    (n, i) =>
      n.type === cn[i]!.type && n.name === cn[i]!.name && covers(n.configuration ?? {}, cn[i]!.configuration ?? {})
  )
  const conns = (m: MetaLike) =>
    (m.connections ?? [])
      .map(c => `${c.fromIndex}>${c.toIndex}:${c.type}`)
      .sort()
      .join('|')
  return nodesSame && conns(planned) === conns(cur)
}

/**
 * 写规则链元数据——内容没变就不写(2026-09-11)。TB 每保存一次元数据就重启链上所有节点、定时器从头计时:
 * 小时级归档要连续跑满 1 小时才出点,反复发布会让它一直出不了数(core/scripts.ts 2026-09-09 的教训)。
 * 返回是否真的写了。
 */
async function writeChainMeta(api: TbApi, id: string, created: boolean, planned: RuleChainMetadata): Promise<boolean> {
  if (!created) {
    const cur = (await api(`/api/ruleChain/${id}/metadata`).catch(() => null)) as MetaLike | null
    if (cur && sameMeta(planned, cur)) return false
  }
  await api('/api/ruleChain/metadata', planned)
  return true
}

export type ChainKind = 'alarm' | 'rollup' | 'revenue'

export interface StaleChainPrune {
  /** 按种类记下删掉的链名 */
  deleted: Partial<Record<ChainKind, string[]>>
  /** 是否摘掉了 Root 上的转发节点 */
  unwired: boolean
  /** 发现了疑似残留但没敢删的情况 */
  notes: string[]
}

/**
 * 清掉「上一版发布过、这一版声明里不再有」的站点规则链(配置即真相,ADR-003 的同一条原则)。
 *
 * 2026-09-08 的教训:08-31 发布过的收益链在声明里去掉 revenue 之后没人清,链内两个 generator
 * 每 5 分钟自跑一次往旧资产写数,一直跑到一周后才被发现。`publish` 只写声明里有的链、
 * `cleanup` 又是整站全清,中间没有东西负责这件事。
 *
 * 只删两类名字,都是我们自己建的:
 *   1. 本站点的默认链名(`Site Alarms · <站点>` 等)—— 也能收拾早就孤立的旧链;
 *   2. 上一版已发布配置声明过的链名 —— 覆盖用户自定义 `chainName` 以及改名的情况。
 * 除此之外一律不碰,免得误删同事的链。
 */
async function pruneStaleChains(
  cfg: TbsiteConfig,
  needed: Record<ChainKind, boolean>,
  scoped: (k: ChainKind) => boolean,
  api: TbApi
): Promise<StaleChainPrune> {
  const out: StaleChainPrune = { deleted: {}, unwired: false, notes: [] }
  const site = cfg.site.name
  const current = siteChainNames(cfg)
  const defaults: Record<ChainKind, string> = {
    alarm: chainNames.alarm(site),
    rollup: chainNames.rollup(site),
    revenue: chainNames.revenue(site),
  }
  // 上一版已发布的配置(自定义链名只能从这里得知)
  let prev: Record<ChainKind, string> | null = null
  try {
    const asset = await findAsset(api, site)
    if (asset) {
      const attrs: { key: string; value: unknown }[] =
        (await api(`/api/plugins/telemetry/ASSET/${asset.id.id}/values/attributes/SERVER_SCOPE?keys=siteConfig`)) || []
      const raw = attrs.find(a => a.key === 'siteConfig')?.value
      if (raw) {
        const prevCfg = (typeof raw === 'string' ? JSON.parse(raw) : raw) as TbsiteConfig
        prev = siteChainNames(expandConfig(prevCfg).cfg)
      }
    }
  } catch {
    /* 读不到上一版就只按默认链名清理 */
  }

  const chains: { id: { id: string }; name: string; root?: boolean }[] =
    (await api('/api/ruleChains?pageSize=100&page=0'))?.data || []
  // 本次要保留的链名(仍在声明里的),任何情况下都不能删
  const keep = new Set<string>()
  for (const k of ['alarm', 'rollup', 'revenue'] as ChainKind[]) if (needed[k]) keep.add(current[k])

  for (const kind of ['alarm', 'rollup', 'revenue'] as ChainKind[]) {
    if (!scoped(kind)) continue
    const candidates = new Set<string>([defaults[kind], ...(prev ? [prev[kind]] : [])])
    for (const name of candidates) {
      if (keep.has(name)) continue // 改名场景:这个名字这一版还在用
      const found = chains.find(c => c.name === name && !c.root)
      if (!found) continue
      // 删告警链之前先把 Root 上指向它的转发节点摘掉
      if (kind === 'alarm' && !out.unwired) out.unwired = await unwireRootChain(api, site)
      await api(`/api/ruleChain/${found.id.id}`, null, 'DELETE')
      ;(out.deleted[kind] ||= []).push(name)
    }
  }
  // 声明里没有告警了,但 Root 上还挂着本站点的转发节点(链可能早被人手工删了)
  if (scoped('alarm') && !needed.alarm && !out.unwired) out.unwired = await unwireRootChain(api, site)
  return out
}

/** 输出清单里 CF 的定位键:实体 + 计算字段名(接管来的字段名常和输出测点名不同) */
const cfKey = (o: OutputKey) => `${o.entityType}|${o.entity}|${o.cfName ?? o.key}`

/**
 * 清掉这一版不再声明的输出 CF(配置即真相;也给单实体 CF 上限腾位)。只删两种:
 *   ① 上一版声明过、这一版没有的——但上一版是「接管」来的、标记又已去掉(交还了)的不删;
 *   ② 带本站点归属标记、这一版没有的(以前的遗留)。
 * 只看上一版 / 这一版声明涉及的实体,不扫全库;别人的字段(没有本站点标记、也不在上一版声明里)一概不碰。
 */
async function pruneStaleCfs(
  cfg: TbsiteConfig,
  computations: Computation[],
  devIds: Record<string, string>,
  api: TbApi
): Promise<number> {
  const site = cfg.site.name
  const isCf = (o: OutputKey) => o.kind === 'cf' || o.kind === 'agg'
  const next = outputInventory(cfg, computations, outputPrefixOf(cfg)).filter(isCf)
  const nextKeys = new Set(next.map(cfKey))
  let prev: OutputKey[] = []
  const siteAsset = await findAsset(api, site)
  if (siteAsset) {
    const attrs: { key: string; value: unknown }[] =
      (await api(`/api/plugins/telemetry/ASSET/${siteAsset.id.id}/values/attributes/SERVER_SCOPE?keys=siteConfig`)) ||
      []
    const raw = attrs.find(a => a.key === 'siteConfig')?.value
    if (raw) {
      const prevCfg = (typeof raw === 'string' ? JSON.parse(raw) : raw) as TbsiteConfig
      const p = expandConfig(prevCfg)
      prev = outputInventory(p.cfg, p.computations, p.prefix).filter(isCf)
    }
  }
  const prevByKey = new Map(prev.map(o => [cfKey(o), o]))
  const entities = new Map<string, { entityType: 'DEVICE' | 'ASSET'; entity: string }>()
  for (const o of [...prev, ...next]) entities.set(`${o.entityType}|${o.entity}`, o)
  let n = 0
  for (const [k, e] of entities) {
    const eid =
      e.entityType === 'DEVICE'
        ? (devIds[e.entity] ?? (await findDevice(api, e.entity))?.id.id)
        : (await findAsset(api, e.entity))?.id.id
    if (!eid) continue
    for (const f of await listCfs(api, e.entityType, eid)) {
      const key = `${k}|${f.name}`
      if (nextKeys.has(key)) continue
      const mark = ownerOf(f)
      const p = prevByKey.get(key)
      const mine = mark ? mark.site === site : !!p && !p.adopted
      if (!mine) continue
      await api(`/api/calculatedField/${f.id.id}`, null, 'DELETE')
      n++
    }
  }
  return n
}

/** 汇聚 / 收益 / 跨设备运算结果资产分给站点资产所属 Customer,并建 站点 Contains 资产 关系(幂等) */
async function followSiteAsset(
  cfg: TbsiteConfig,
  computations: Computation[],
  siteAssetId: string,
  api: TbApi
): Promise<number> {
  const site = await api(`/api/asset/${siteAssetId}`)
  // TB 用一个占位 UUID 表示「未分配」,它是非空字符串:直接当真客户用会去 POST
  // /api/customer/<占位>/asset/…,真实 TB 回 404 并把整个 asset 步骤判失败(审查 R5)
  const customerId = customerIdOf(site)
  const names = [
    ...new Set(
      computations
        .filter(
          c =>
            c.template === 'aggregate.crossEntity' ||
            c.template === 'revenue.periodic' ||
            (isCfTemplate(c.template) && !c.adopted && cfHost(c).entityType === 'ASSET')
        )
        .map(c => c.asset as string)
    ),
  ]
  let n = 0
  for (const name of names) {
    const a = await findAsset(api, name)
    // 只动本工具建的资产(tbsite-agg);同名的别人的资产不挪、不改归属
    if (!a || a.id.id === siteAssetId || a.type !== AGG_ASSET_TYPE) continue
    await api('/api/relation', {
      from: { entityType: 'ASSET', id: siteAssetId },
      to: { entityType: 'ASSET', id: a.id.id },
      type: 'Contains',
      typeGroup: 'COMMON',
    })
    // 汇聚 / 收益资产的归属跟着站点走,三种转换都要落地(与页面发布器同一套语义)
    const assetCustomer = customerIdOf(a)
    if (customerId && assetCustomer !== customerId) await api(`/api/customer/${customerId}/asset/${a.id.id}`, {})
    else if (!customerId && assetCustomer) await api(`/api/customer/asset/${a.id.id}`, null, 'DELETE')
    n++
  }
  return n
}

export interface ResultAssetsReport {
  /** 这次新建的资产 */
  created: string[]
  /** 原来就有(本工具建的)的资产 */
  existing: string[]
  /** 同名但不是本工具建的资产:不借用,要换名 */
  conflicts: { name: string; type: string }[]
  /** 挂到站点下 / 归属跟站点走的资产数 */
  followed: number
}

/**
 * 第 3 步「保存并进入展示配置」(2026-09-11,讨论后定的轻量方案):只把结果资产建出来——
 * 跨设备运算的结果资产、跨设备汇聚与分时收益的资产,连同站点资产、Contains 关系,Customer 跟站点走。
 * 计算字段与规则链仍在第 5 步写:不建告警、不动规则链、不重启任何定时器。
 * 这样第 4 步编辑器的实体树里就有这些资产,能先选中绑定。同名但不是本工具建的资产不借用,记为冲突。
 */
export async function ensureResultAssets(
  original: TbsiteConfig,
  devIds: Record<string, string>,
  api: TbApi
): Promise<ResultAssetsReport> {
  const { cfg, computations } = expandConfig(original)
  const site = cfg.site.name
  const out: ResultAssetsReport = { created: [], existing: [], conflicts: [], followed: 0 }
  const names = [
    ...new Set(
      computations
        .filter(
          c =>
            c.template === 'aggregate.crossEntity' ||
            c.template === 'revenue.periodic' ||
            (isCfTemplate(c.template) && !c.adopted && cfHost(c).entityType === 'ASSET')
        )
        .map(c => c.asset as string)
    ),
  ]
  const ids: Record<string, string> = {}
  for (const name of names) {
    const found = await findAsset(api, name)
    if (found && found.type !== AGG_ASSET_TYPE) {
      out.conflicts.push({ name, type: found.type })
      continue
    }
    if (found) {
      out.existing.push(name)
      ids[name] = found.id.id
    } else {
      ids[name] = (await api('/api/asset', { name, type: AGG_ASSET_TYPE, additionalInfo: ownerInfo(site) })).id.id
      out.created.push(name)
    }
  }
  // 汇聚资产 Contains 成员设备(编辑器资产树里能展开看到成员;第 5 步发布时同样会建,幂等)
  for (const c of computations.filter(x => x.template === 'aggregate.crossEntity')) {
    const aid = ids[c.asset as string]
    if (!aid) continue
    for (const m of resolveAggMembers(cfg, c))
      if (devIds[m.name])
        await api('/api/relation', {
          from: { entityType: 'ASSET', id: aid },
          to: { entityType: 'DEVICE', id: devIds[m.name] },
          type: 'Contains',
          typeGroup: 'COMMON',
        })
  }
  const { id: siteId } = await ensureAsset(api, site, SITE_ASSET_TYPE, ownerInfo(site))
  out.followed = await followSiteAsset(cfg, computations, siteId, api)
  return out
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
  const site = cfg.site.name
  const mark = ownerInfo(site)
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
    // 失败清单与重试范围里的 device 字段存的是宿主名(设备名,或跨设备运算的结果资产名)
    if (retry?.cf?.length) {
      const want = new Set(retry.cf.map(x => `${x.device}@@${x.output}`))
      cfComps = cfComps.filter(c => want.has(`${cfHost(c).name}@@${c.output}`))
    }
    let created = 0,
      updated = 0,
      failed = 0
    const cfCache: Record<string, TbCf[]> = {}
    const assetIds: Record<string, string> = {}
    /**
     * 跨设备运算的结果资产:没有就建(tbsite-agg,带归属标记);同名但不是本工具建的资产不借用,免得往别人的资产上挂 CF。
     * 接管来的运算例外:它本来就挂在那个资产上(常是同事建的),只认它、不新建。
     */
    const resultAsset = async (c: Computation, name: string) => {
      if (assetIds[name]) return assetIds[name]
      const found = await findAsset(api, name)
      if (c.adopted) {
        if (!found) throw new Error(`接管的计算字段所在资产「${name}」在 TB 上找不到了`)
        return (assetIds[name] = found.id.id as string)
      }
      if (found && found.type !== AGG_ASSET_TYPE)
        throw new Error(`资产「${name}」已存在,类型是 ${found.type},不是本工具建的结果资产,请换一个结果资产名`)
      const id = found
        ? found.id.id
        : (await api('/api/asset', { name, type: AGG_ASSET_TYPE, additionalInfo: mark })).id.id
      return (assetIds[name] = id as string)
    }
    for (const c of cfComps) {
      const host = cfHost(c)
      const output = c.output as string
      const cfName = c.cfName || output
      try {
        const hostId = host.entityType === 'ASSET' ? await resultAsset(c, host.name) : (devIds[host.name] as string)
        const body = buildCf(c, hostId, devIds, host.entityType)
        cfCache[hostId] ||= await listCfs(api, host.entityType, hostId)
        const existing = cfCache[hostId].find(x => x.name === cfName)
        // 归属标记:保留字段上原有的其它 additionalInfo(接管来的字段可能有同事写的东西)
        body.additionalInfo = { ...(existing?.additionalInfo ?? {}), ...mark }
        if (existing) {
          body.id = existing.id
          if (typeof existing.version === 'number') body.version = existing.version
          updated++
        } else created++
        let saved: TbCf | null
        try {
          saved = await api('/api/calculatedField', body)
        } catch (e) {
          throw versionConflict(e, `计算字段「${cfName}」`)
        }
        if (!existing && saved?.id) cfCache[hostId].push({ id: saved.id, name: cfName })
        report('cf', 'run', `${created + updated + failed}/${cfComps.length} · ${host.name}`)
      } catch (e) {
        failed++
        failures.push({ step: 'cf', device: host.name, output, error: e instanceof Error ? e.message : String(e) })
      }
    }
    const onAssets = Object.keys(assetIds).length
    const detail = cfComps.length
      ? `新建 ${created} · 更新 ${updated}` +
        (onAssets ? ` · 跨设备结果存到 ${onAssets} 个资产` : '') +
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
          const { id: aid } = await ensureAsset(api, c.asset as string, AGG_ASSET_TYPE, mark)
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
            body.additionalInfo = mark
            const ex = existing.find(x => x.name === body.name)
            if (ex) body.id = ex.id
            await api('/api/calculatedField', body)
            cfCount++
          }
          if (layered) {
            if (layeredSettleMs > 0) await sleep(layeredSettleMs)
            const final = bodies[bodies.length - 1]!
            final.entityId = { entityType: 'ASSET', id: aid }
            final.additionalInfo = mark
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

  // 3b'. 先清掉声明里已不再有的站点规则链(配置即真相;否则旧链会带着自己的 generator 一直跑,
  //      2026-09-08 在镜像上就抓到过一条自跑了一周的旧收益链)。失败不阻塞本次写入。
  const cascadesAll = computations.filter(c => c.template === 'window.cascade')
  const needed: Record<ChainKind, boolean> = {
    alarm: computations.some(c => c.template === 'alarm.threshold'),
    rollup: Object.keys(rollupGroups(computations)).length > 0 || cascadesAll.length > 0,
    revenue: computations.some(c => c.template === 'revenue.periodic'),
  }
  let pruned: StaleChainPrune = { deleted: {}, unwired: false, notes: [] }
  try {
    pruned = await pruneStaleChains(cfg, needed, k => stepOn(k), api)
  } catch (e) {
    failures.push({
      step: 'alarm',
      error: '清理声明里已删除的旧规则链失败(不影响本次写入):' + (e instanceof Error ? e.message : String(e)),
    })
  }
  /** 拼到对应步骤的结果里,让「无」这一行也能说明它顺手清掉了什么 */
  const prunedNote = (k: ChainKind) => {
    const names = pruned.deleted[k] ?? []
    const bits = names.length ? [`已删上一版的 ${names.join('、')}`] : []
    if (k === 'alarm' && pruned.unwired) bits.push('已摘除 Root 转发')
    return bits.length ? `(${bits.join(',')})` : ''
  }
  /** 这次真正重写了哪些链(没变的不写,也就不用自检) */
  const written: Record<ChainKind, boolean> = { alarm: false, rollup: false, revenue: false }
  let rootWritten = false
  const unchanged = '(未变,未重写)'

  // 3c. 分时电价收益 → 独立规则链 + 收益资产
  report('revenue', 'run')
  if (!stepOn('revenue')) report('revenue', 'ok', '跳过(上次已成功)')
  else
    try {
      const revs = computations.filter(c => c.template === 'revenue.periodic')
      if (revs.length) {
        const assetIds: Record<string, string> = {}
        for (const c of revs) {
          const { id } = await ensureAsset(api, c.asset as string, AGG_ASSET_TYPE, mark)
          assetIds[c.asset as string] = id
        }
        const { id, created } = await ensureChain(api, names.revenue, mark)
        written.revenue = await writeChainMeta(api, id, created, revenueMetadata(id, revs, devIds, assetIds))
        report(
          'revenue',
          'ok',
          `${revs.length} 项收益统计 → ${names.revenue}` +
            (created ? '(新建定时链需 TB 重启后才开始跑)' : written.revenue ? '' : unchanged) +
            prunedNote('revenue')
        )
      } else report('revenue', 'ok', '无' + prunedNote('revenue'))
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
        const { id, created } = await ensureChain(api, names.rollup, mark)
        written.rollup = await writeChainMeta(api, id, created, rollupMetadata(id, groups, devIds, cascades, prefix))
        report(
          'rollup',
          'ok',
          `${Object.keys(groups).length} 条流水线 · ${cascades.length} 项多级归档 → ${names.rollup}` +
            (created ? '(新建定时链需 TB 重启后才开始跑)' : written.rollup ? '' : unchanged) +
            prunedNote('rollup')
        )
      } else report('rollup', 'ok', '无' + prunedNote('rollup'))
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
        const { id, created } = await ensureChain(api, names.alarm, mark)
        written.alarm = await writeChainMeta(
          api,
          id,
          created,
          alarmMetadata(
            id,
            alarms,
            prefix ? { prefix, whitelist: cascadeWhitelist(cfg, computations, prefix) } : undefined,
            { propagate: !!cfg.alarm?.propagate }
          )
        )
        const wired = await wireRootChain(api, id, cfg.site.name)
        rootWritten = wired !== '转发已就位'
        report(
          'alarm',
          'ok',
          `${alarms.length} 条规则${written.alarm ? '' : unchanged} · ${wired}` + prunedNote('alarm')
        )
      } else report('alarm', 'ok', '无' + prunedNote('alarm'))
    } catch (e) {
      fail('alarm', e)
    }

  // 6. 站点配置写入(保存原始声明,不含展开产物;不再设为 Public,T3.7)
  report('asset', 'run')
  if (!stepOn('asset')) report('asset', 'ok', '跳过(上次已成功)')
  else
    try {
      const { id } = await ensureAsset(api, cfg.site.name, SITE_ASSET_TYPE, mark)
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
  //    消息会被静默丢弃 —— 2026-09-08 建告警节点就这样悄悄失败了一天多)。没重写的链不查——它们没重启过。
  if (checkHealth) {
    report('health', 'run')
    const targets: ChainTarget[] = []
    if (written.alarm) targets.push({ name: names.alarm })
    // Root 链上只查我们加的那条转发节点,别人的节点不归我们管、也不该由我们的发布来判定
    if (rootWritten) targets.push({ root: true, nodes: [chainNames.rootFlow(cfg.site.name)] })
    if (written.rollup) targets.push({ name: names.rollup })
    if (written.revenue) targets.push({ name: names.revenue })
    if (!targets.length) report('health', 'ok', '跳过(这次没有重写任何规则链,节点没有重启)')
    else {
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
  }
  return failures
}
