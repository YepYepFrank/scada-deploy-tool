// 进第 3 步前的同步(2026-09-11):只读 TB 上与本站点相关的计算字段和规则链,分三类——
//   mine      本工具管的:带本站点归属标记;或旧版还没打标记、但与声明同实体同字段名 → 比对漂移
//   otherSite 本工具管、但属于别的站点(标记里的站点不同)→ 只读
//   foreign   别人的 → 只读;表达式能套进向导模板的给「接管」(core/adopt.ts)
// 规则链只列名字、节点数、定时器数、是不是本站点的(Root 链由高潮维护,只读)。
// 这里不写 TB;唯一的写操作是「交还」(handBackCf)。扫全部资产要十几秒,onProgress 给界面报进度。
import type { CalculatedField, TbsiteConfig } from '../types'
import { adoptCf, type AdoptResult, type PlatformArg, type PlatformCf } from '../core/adopt'
import { chainNames, OWNER_TAG, ownerOf } from '../core/constants'
import { compile, siteChainNames } from '../core/plan'
import { stableJson } from '../core/stable'
import type { TbApi, TbCf } from './api'

export type PlatformOwner = 'mine' | 'otherSite' | 'foreign'

export interface PlatformCfRow {
  entityType: 'DEVICE' | 'ASSET'
  entity: string
  entityId: string
  cf: PlatformCf
  owner: PlatformOwner
  /** otherSite:属于哪个站点 */
  site?: string
  /** mine:与声明比对。same 一致 / changed 平台上被改过 / orphan 带本站点标记但声明里已经没有(遗留) */
  drift?: 'same' | 'changed' | 'orphan'
  /** mine:声明里对应的运算是接管来的 */
  adopted?: boolean
  /** foreign:能不能接管 */
  adopt?: AdoptResult
}

export interface PlatformChainRow {
  id: string
  name: string
  root: boolean
  nodes: number
  timers: number
  /** 本站点的链(带本站点标记,或是本站点声明的链名) */
  mine: boolean
  /** Root 链上有没有本站点的转发节点(只读看一眼;Root 由高潮维护) */
  ourFlow?: boolean
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

type Ent = { id: { id: string }; name: string }

async function pageAll<T>(api: TbApi, path: string): Promise<T[]> {
  const out: T[] = []
  for (let p = 0; ; p++) {
    const pg = await api(`${path}${path.includes('?') ? '&' : '?'}pageSize=100&page=${p}`)
    out.push(...((pg?.data ?? []) as T[]))
    if (!pg?.hasNext) break
  }
  return out
}

/** 与声明比对:表达式(去空白)、参数(测点 / 取值类型 / 引用实体)、输出(类型 / 名字 / 范围) */
export function sameCf(expected: CalculatedField, actual: PlatformCf): boolean {
  const e = expected.configuration
  const a = actual.configuration ?? {}
  const sq = (s?: string) => (s ?? '').replace(/\s+/g, '')
  if (sq(e.expression) !== sq(a.expression)) return false
  const sig = (args: Record<string, PlatformArg> | undefined) =>
    stableJson(
      Object.fromEntries(
        Object.entries(args ?? {}).map(([k, v]) => [
          k,
          { key: v.refEntityKey?.key, type: v.refEntityKey?.type, ref: v.refEntityId?.id ?? null },
        ])
      )
    )
  if (sig(e.arguments) !== sig(a.arguments)) return false
  const o = e.output as { type?: string; name?: string; scope?: string | null }
  const ao = a.output ?? {}
  return o.type === ao.type && o.name === ao.name && (o.scope ?? null) === (ao.scope ?? null)
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
  const plan = compile(original, { devices: devIds }, { throwOnError: false })
  // 期望:这份声明会写出的 CF,按「实体|字段名」索引
  const expected = new Map<string, { body: CalculatedField; adopted: boolean }>()
  for (const c of plan.cfs)
    expected.set(`${c.asset ? 'ASSET|' + c.asset : 'DEVICE|' + c.device}|${c.body.name}`, {
      body: c.body,
      adopted: !!c.adopted,
    })
  for (const a of plan.aggregates)
    for (const b of a.bodies) expected.set(`ASSET|${a.asset}|${b.name}`, { body: b, adopted: false })

  const claimed = new Set((original.devices || []).map(d => d.name))
  const claimedIds = new Set(Object.values(devIds))
  tell('读取设备与资产清单')
  const devices = await pageAll<Ent>(api, '/api/tenant/devices')
  const assets = await pageAll<Ent>(api, '/api/tenant/assets')
  const nameOf = new Map([...devices, ...assets].map(e => [e.id.id, e.name]))

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
      const base = { entityType, entity: e.name, entityId: e.id.id, cf }
      if (mark && mark.site !== site) {
        rows.push({ ...base, owner: 'otherSite', site: mark.site })
        continue
      }
      if (mark || exp) {
        seen.add(key)
        rows.push({
          ...base,
          owner: 'mine',
          drift: exp ? (sameCf(exp.body, cf) ? 'same' : 'changed') : 'orphan',
          ...(exp?.adopted ? { adopted: true } : {}),
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
        adopt: adoptCf(cf, { hostType: entityType, hostName: e.name, nameOfId: id => nameOf.get(id), claimed }),
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

  const ours = new Set(Object.values(siteChainNames(original)))
  const flow = chainNames.rootFlow(site)
  const chainList = await pageAll<Ent & { root?: boolean; additionalInfo?: unknown }>(api, '/api/ruleChains')
  const chains: PlatformChainRow[] = []
  tell('读取规则链', 0, chainList.length)
  for (const c of chainList) {
    const m = await api(`/api/ruleChain/${c.id.id}/metadata`).catch(() => null)
    const nodes = (m?.nodes ?? []) as { type: string; name: string }[]
    const mark = ownerOf(c)
    chains.push({
      id: c.id.id,
      name: c.name,
      root: !!c.root,
      nodes: nodes.length,
      timers: nodes.filter(n => /GeneratorNode$/.test(n.type)).length,
      mine: mark ? mark.site === site : ours.has(c.name),
      ...(c.root ? { ourFlow: nodes.some(n => n.name === flow) } : {}),
    })
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
 * 交还:去掉计算字段上的归属标记,字段本身原样留着(之后工具不再管它,清理也不会删它)。
 * 只动带本工具标记的字段;没有标记的(接管了还没发布过)回 false,什么也不写。
 */
export async function handBackCf(api: TbApi, cf: TbCf | PlatformCf): Promise<boolean> {
  if (!ownerOf(cf)) return false
  const rest = Object.fromEntries(
    Object.entries((cf.additionalInfo ?? {}) as Record<string, unknown>).filter(
      ([k, v]) => !(k === 'managedBy' && v === OWNER_TAG) && k !== 'site'
    )
  )
  await api('/api/calculatedField', { ...cf, additionalInfo: Object.keys(rest).length ? rest : null })
  return true
}
