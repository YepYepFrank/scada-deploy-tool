// 进第 3 步前的同步(2026-09-11):只读 TB 上与本站点相关的计算字段和规则链,分三类——
//   mine      本工具管的:带本站点归属标记;或旧版还没打标记、但与声明同实体同字段名
//   otherSite 本工具管、但属于别的站点(标记里的站点不同)→ 只读
//   foreign   别人的 → 只读;表达式能套进向导模板的给「接管」(core/adopt.ts)
// 本工具管的做三方比对(core/print.ts):平台上现在 / 写入时的指纹 / 向导当前配置 →
//   conflict 平台上被人改过 · pending 向导里改了还没发布 · mismatch 旧对象没有指纹、和向导对不上(分不清谁改的)
//   orphan 带本站点标记但声明里已没有 · same 一致;不一致的都带逐项差异(给「查看差异」)。
// 这里不写 TB;唯一的写操作是「交还」(handBackCf)。扫全部资产要十几秒,onProgress 给界面报进度。
import type { CalculatedField, RuleChainMetadata, TbsiteConfig } from '../types'
import { adoptCf, type AdoptResult, type PlatformCf } from '../core/adopt'
import { OWNER_TAG, ownerOf, SITE_ASSET_TYPE } from '../core/constants'
import { compile } from '../core/plan'
import {
  cfItemKey,
  cfPrint,
  cfSignature,
  chainItemKey,
  chainPrint,
  diffChainMeta,
  diffCf,
  metaCovers,
  type ConfigDiff,
} from '../core/print'
import type { TbApi, TbCf } from './api'
import { isOwnRootFlow } from './publish'

export type PlatformOwner = 'mine' | 'otherSite' | 'foreign'
/** 本工具管的对象与向导配置的比对结果 */
export type DriftState = 'same' | 'conflict' | 'pending' | 'mismatch' | 'orphan'

export interface PlatformCfRow {
  /** cfItemKey:给「以 TB 为准 / 待定」对上发布时的写入对象 */
  key: string
  entityType: 'DEVICE' | 'ASSET'
  entity: string
  entityId: string
  cf: PlatformCf
  owner: PlatformOwner
  /** otherSite:属于哪个站点 */
  site?: string
  /** mine:比对结果 */
  drift?: DriftState
  /** conflict 时向导里也改过这一条(两边都动了) */
  localToo?: boolean
  /** mine 且不一致:逐项差异(本工具里 / 平台上现在) */
  diff?: ConfigDiff[]
  /** mine:声明里对应的运算是接管来的 */
  adopted?: boolean
  /** foreign:能不能接管 */
  adopt?: AdoptResult
}

export interface PlatformChainRow {
  /** chainItemKey */
  key: string
  id: string
  name: string
  root: boolean
  nodes: number
  timers: number
  /** 本站点的链(带本站点标记,或是本站点声明的链名) */
  mine: boolean
  /** Root 链上有没有本站点的转发节点 */
  ourFlow?: boolean
  /** Root 链上本站点的转发节点指向哪条链(链 id;第 3 步「改指向 / 重新接线 / 删除」用) */
  ourFlowTarget?: string | null
  /** 本站点的链:比对结果与逐项差异 */
  drift?: DriftState
  diff?: ConfigDiff[]
}

export interface PlatformState {
  cfs: PlatformCfRow[]
  /** 声明里有、TB 上还没有的计算字段(第 5 步发布时建) */
  missing: { entityType: 'DEVICE' | 'ASSET'; entity: string; name: string }[]
  chains: PlatformChainRow[]
  /** 每个扫到的实体上 TB 已有的计算字段数(含别人的),键 `DEVICE|名` / `ASSET|名`;TB 单实体上限 5 */
  occupied: Record<string, number>
  scanned: { devices: number; assets: number }
}

/** 同步进度:phase 是给人看的阶段名;total 为 0 表示这一段还不知道总数 */
export interface SyncProgress {
  phase: string
  done: number
  total: number
}

type Ent = { id: { id: string }; name: string; type?: string }

async function pageAll<T>(api: TbApi, path: string): Promise<T[]> {
  const out: T[] = []
  for (let p = 0; ; p++) {
    const pg = await api(`${path}${path.includes('?') ? '&' : '?'}pageSize=100&page=${p}`)
    out.push(...((pg?.data ?? []) as T[]))
    if (!pg?.hasNext) break
  }
  return out
}

/** 与声明比对:只看内容(表达式、参数、输出),TB 自己补的字段不算 */
export const sameCf = (expected: CalculatedField, actual: PlatformCf): boolean =>
  cfSignature(expected) === cfSignature(actual)

/**
 * 三方比对。now 平台上现在的指纹;recorded 工具写入时记下的指纹(null = 旧对象没记);
 * planned 向导当前配置的指纹(null = 声明里已经没有)。
 */
function judge(
  now: string,
  recorded: string | null,
  planned: string | null
): { drift: DriftState; localToo?: boolean } {
  if (planned === null) return { drift: 'orphan' }
  if (now === planned) return { drift: 'same' }
  if (!recorded) return { drift: 'mismatch' }
  if (now !== recorded) return { drift: 'conflict', ...(planned !== recorded ? { localToo: true } : {}) }
  return { drift: 'pending' }
}

/**
 * 读平台现状。扫描范围:本站点已认领的设备 + 租户全部资产(资产上的别人的字段只列引用了本站点设备的,
 * 别的项目的资产不列)。devIds 是已认领设备的 名 → id。onProgress 按阶段回报进度(可不传)。
 */
export async function readPlatformState(
  api: TbApi,
  original: TbsiteConfig,
  devIds: Record<string, string>,
  onProgress?: (p: SyncProgress) => void
): Promise<PlatformState> {
  const tell = (phase: string, done = 0, total = 0) => onProgress?.({ phase, done, total })
  const site = original.site.name
  const claimed = new Set((original.devices || []).map(d => d.name))
  const claimedIds = new Set(Object.values(devIds))
  tell('读取设备与资产清单')
  const devices = await pageAll<Ent>(api, '/api/tenant/devices')
  const assets = await pageAll<Ent>(api, '/api/tenant/assets')
  const nameOf = new Map([...devices, ...assets].map(e => [e.id.id, e.name]))
  const nameOfId = (id: string) => nameOf.get(id)

  // 向导当前配置会写出的东西(资产 id 用真实的,规则链节点里引用资产时才比得上)
  const plan = compile(
    original,
    { devices: devIds, assets: Object.fromEntries(assets.map(a => [a.name, a.id.id])) },
    { throwOnError: false }
  )
  const expected = new Map<string, { body: CalculatedField; adopted: boolean }>()
  for (const c of plan.cfs)
    expected.set(`${c.asset ? 'ASSET|' + c.asset : 'DEVICE|' + c.device}|${c.body.name}`, {
      body: c.body,
      adopted: !!c.adopted,
    })
  for (const a of plan.aggregates)
    for (const b of a.bodies) expected.set(`ASSET|${a.asset}|${b.name}`, { body: b, adopted: false })
  const plannedChains: Record<string, RuleChainMetadata> = {}
  for (const x of [plan.alarm, plan.rollup, plan.revenue]) if (x) plannedChains[x.chainName] = x.metadata

  const rows: PlatformCfRow[] = []
  const occupied: Record<string, number> = {}
  const seen = new Set<string>()
  const scan = async (entityType: 'DEVICE' | 'ASSET', e: Ent) => {
    const cfs = ((await api(`/api/${entityType}/${e.id.id}/calculatedFields?pageSize=100&page=0`))?.data ??
      []) as PlatformCf[]
    occupied[`${entityType}|${e.name}`] = cfs.length
    for (const cf of cfs) {
      const key = `${entityType}|${e.name}|${cf.name}`
      const mark = ownerOf(cf)
      const exp = expected.get(key)
      const base = { key: cfItemKey(entityType, e.name, cf.name), entityType, entity: e.name, entityId: e.id.id, cf }
      if (mark && mark.site !== site) {
        rows.push({ ...base, owner: 'otherSite', site: mark.site })
        continue
      }
      if (mark || exp) {
        seen.add(key)
        const rec = cf.additionalInfo?.print
        const j = judge(cfPrint(cf), typeof rec === 'string' ? rec : null, exp ? cfPrint(exp.body) : null)
        rows.push({
          ...base,
          owner: 'mine',
          ...j,
          ...(exp?.adopted ? { adopted: true } : {}),
          ...(exp && j.drift !== 'same' ? { diff: diffCf(exp.body, cf, nameOfId) } : {}),
        })
        continue
      }
      // 资产上的别人的字段:只列引用了本站点设备的,别的项目的资产不列
      if (
        entityType === 'ASSET' &&
        !Object.values(cf.configuration?.arguments ?? {}).some(x => x.refEntityId && claimedIds.has(x.refEntityId.id))
      )
        continue
      rows.push({
        ...base,
        owner: 'foreign',
        adopt: adoptCf(cf, { hostType: entityType, hostName: e.name, nameOfId, claimed }),
      })
    }
  }
  const targets: ['DEVICE' | 'ASSET', Ent][] = [
    ...devices.filter(d => claimedIds.has(d.id.id)).map(d => ['DEVICE', d] as ['DEVICE', Ent]),
    ...assets.map(a => ['ASSET', a] as ['ASSET', Ent]),
  ]
  tell('扫描计算字段', 0, targets.length)
  for (let i = 0; i < targets.length; i += 8) {
    await Promise.all(targets.slice(i, i + 8).map(([t, e]) => scan(t, e)))
    tell('扫描计算字段', Math.min(i + 8, targets.length), targets.length)
  }

  const missing = [...expected.keys()]
    .filter(k => !seen.has(k))
    .map(k => {
      const [entityType, entity, ...rest] = k.split('|')
      return { entityType: entityType as 'DEVICE' | 'ASSET', entity: entity!, name: rest.join('|') }
    })

  // 规则链写入时的指纹记在站点资产的 deployPrints 属性上(发布时写,见 writer/publish.ts)
  let prints: Record<string, string> = {}
  const siteAsset = assets.find(a => a.name === site && a.type === SITE_ASSET_TYPE)
  if (siteAsset) {
    try {
      const attrs: { key: string; value: unknown }[] =
        (await api(
          `/api/plugins/telemetry/ASSET/${siteAsset.id.id}/values/attributes/SERVER_SCOPE?keys=deployPrints`
        )) || []
      const raw = attrs.find(a => a.key === 'deployPrints')?.value
      prints = ((typeof raw === 'string' ? JSON.parse(raw) : raw) as Record<string, string>) || {}
    } catch {
      /* 读不到就当旧站点(没有指纹) */
    }
  }

  const ours = new Set(Object.keys(plannedChains))
  const chainList = await pageAll<Ent & { root?: boolean; additionalInfo?: unknown }>(api, '/api/ruleChains')
  const chains: PlatformChainRow[] = []
  tell('读取规则链', 0, chainList.length)
  for (const c of chainList) {
    const m = await api(`/api/ruleChain/${c.id.id}/metadata`).catch(() => null)
    const nodes = (m?.nodes ?? []) as { type: string; name: string }[]
    const mark = ownerOf(c)
    const mine = !c.root && (mark ? mark.site === site : ours.has(c.name))
    const own = c.root
      ? ((m?.nodes ?? []) as Parameters<typeof isOwnRootFlow>[0][]).find(n => isOwnRootFlow(n, site))
      : undefined
    const row: PlatformChainRow = {
      key: chainItemKey(c.name),
      id: c.id.id,
      name: c.name,
      root: !!c.root,
      nodes: nodes.length,
      timers: nodes.filter(n => /GeneratorNode$/.test(n.type)).length,
      mine,
      ...(c.root
        ? { ourFlow: !!own, ourFlowTarget: (own?.configuration?.ruleChainId as string | undefined) ?? null }
        : {}),
    }
    if (mine && m) {
      const planned = plannedChains[c.name]
      if (!planned) row.drift = 'orphan'
      else if (metaCovers(planned, m)) row.drift = 'same'
      else {
        const rec = prints[c.name]
        row.drift = !rec ? 'mismatch' : chainPrint(m) !== rec ? 'conflict' : 'pending'
        row.diff = diffChainMeta(planned, m)
      }
    }
    chains.push(row)
    tell('读取规则链', chains.length, chainList.length)
  }

  return {
    cfs: rows,
    missing,
    chains,
    occupied,
    scanned: { devices: targets.filter(t => t[0] === 'DEVICE').length, assets: assets.length },
  }
}

/**
 * 交还:去掉计算字段上的归属标记与写入指纹,字段本身原样留着(之后工具不再管它,清理也不会删它)。
 * 只动带本工具标记的字段;没有标记的(接管了还没发布过)回 false,什么也不写。
 */
export async function handBackCf(api: TbApi, cf: TbCf | PlatformCf): Promise<boolean> {
  if (!ownerOf(cf)) return false
  const rest = Object.fromEntries(
    Object.entries((cf.additionalInfo ?? {}) as Record<string, unknown>).filter(
      ([k, v]) => !(k === 'managedBy' && v === OWNER_TAG) && k !== 'site' && k !== 'print'
    )
  )
  await api('/api/calculatedField', { ...cf, additionalInfo: Object.keys(rest).length ? rest : null })
  return true
}
