/**
 * 元数据树(T3.4):站点 → 网关 → 设备(+ 资产),供绑定选择器选实体与 key。
 * 纯数据部分(buildMetaTree / flattenTree)不依赖网络;MetaClient 负责从 TB 拉设备 / 资产 / key / 最新值,按需、带缓存。
 * 实体引用统一为 EntityRef { type, id, name }:编辑态就带 id(从 TB 选的),发布时若目标环境不同再按 name 重解析(ADR-002)。
 */
import { normalizeValue, type EntityRef } from '@grid/tb-client'

export type MetaKind = 'site' | 'gateway' | 'device' | 'asset' | 'group'

export interface MetaNode {
  /** 稳定 id:实体用 TB id,分组用 group:<名> */
  id: string
  name: string
  kind: MetaKind
  /** 分组节点没有实体 */
  entity?: EntityRef
  profile?: string
  label?: string
  children: MetaNode[]
}

export interface TbDevice {
  id: { id: string }
  name: string
  type?: string
  label?: string
  additionalInfo?: { gateway?: boolean; lastConnectedGateway?: string; description?: string }
}
export interface TbAsset {
  id: { id: string }
  name: string
  type?: string
  label?: string
}

/** 资产间的 Contains 关系(from 包含 to),T2.5 元数据读取补齐项 */
export interface ContainsRel {
  from: string
  to: string
}

/**
 * 设备按「最后连接的网关」归到网关下;没网关的进「直连设备」;资产单独一组并按 Contains 关系递归嵌套
 * (站点资产 → ScadaPage 资产 / 子站等);有环时后到的那条关系忽略。网关本身也是设备,可选。
 */
export function buildMetaTree(
  siteName: string,
  devices: TbDevice[],
  assets: TbAsset[] = [],
  contains: ContainsRel[] = []
): MetaNode {
  const gateways = devices.filter(d => d.type === 'gateway' || d.additionalInfo?.gateway)
  const gwIds = new Set(gateways.map(g => g.id.id))
  const dev = (d: TbDevice, kind: MetaKind = 'device'): MetaNode => ({
    id: d.id.id,
    name: d.name,
    kind,
    entity: { type: 'DEVICE', id: d.id.id, name: d.name },
    profile: d.type,
    label: d.label,
    children: [],
  })
  const byName = (a: MetaNode, b: MetaNode) => a.name.localeCompare(b.name, 'zh-Hans-CN', { numeric: true })
  const gwNodes = gateways.map(g => dev(g, 'gateway')).sort(byName)
  const orphans: MetaNode[] = []
  for (const d of devices) {
    if (gwIds.has(d.id.id)) continue
    const gw = d.additionalInfo?.lastConnectedGateway
    const parent = gw ? gwNodes.find(n => n.id === gw) : undefined
    ;(parent ? parent.children : orphans).push(dev(d))
  }
  for (const g of gwNodes) g.children.sort(byName)
  orphans.sort(byName)
  const children: MetaNode[] = [...gwNodes]
  if (orphans.length)
    children.push({ id: 'group:direct', name: '直连 / 未归网关设备', kind: 'group', children: orphans })
  if (assets.length) {
    const nodes = new Map<string, MetaNode>(
      assets.map(a => [
        a.id.id,
        {
          id: a.id.id,
          name: a.name,
          kind: 'asset' as const,
          entity: { type: 'ASSET' as const, id: a.id.id, name: a.name },
          profile: a.type,
          label: a.label,
          children: [],
        },
      ])
    )
    // 只认两端都在列表里的资产关系;一个资产只挂到第一个父节点下;成环(祖先被后代包含)时忽略后到的关系
    const parentOf = new Map<string, string>()
    const isAncestor = (maybeAncestor: string, of: string): boolean => {
      for (let p = parentOf.get(of); p; p = parentOf.get(p)) if (p === maybeAncestor) return true
      return false
    }
    for (const r of contains) {
      if (r.from === r.to || !nodes.has(r.from) || !nodes.has(r.to)) continue
      if (parentOf.has(r.to) || isAncestor(r.to, r.from)) continue
      parentOf.set(r.to, r.from)
      nodes.get(r.from)!.children.push(nodes.get(r.to)!)
    }
    for (const n of nodes.values()) n.children.sort(byName)
    children.push({
      id: 'group:assets',
      name: '资产',
      kind: 'group',
      children: [...nodes.values()].filter(n => !parentOf.has(n.id)).sort(byName),
    })
  }
  return { id: 'site', name: siteName, kind: 'site', children }
}

export interface FlatRow {
  node: MetaNode
  depth: number
  expanded: boolean
  hasChildren: boolean
}

/** 按展开状态与关键字拍平成行(虚拟滚动只画可见行);过滤时命中节点的祖先全部展开 */
export function flattenTree(root: MetaNode, expanded: Set<string>, query = ''): FlatRow[] {
  const q = query.trim().toLowerCase()
  const match = (n: MetaNode) => !q || n.name.toLowerCase().includes(q) || (n.label ?? '').toLowerCase().includes(q)
  const keep = new Map<string, boolean>()
  const mark = (n: MetaNode): boolean => {
    const self = match(n)
    const any = n.children.map(mark).some(Boolean) || self
    keep.set(n.id, any)
    return any
  }
  mark(root)
  const rows: FlatRow[] = []
  const walk = (n: MetaNode, depth: number) => {
    if (!keep.get(n.id)) return
    const hasChildren = n.children.length > 0
    const isOpen = q ? true : expanded.has(n.id)
    rows.push({ node: n, depth, expanded: isOpen, hasChildren })
    if (hasChildren && isOpen) for (const c of n.children) walk(c, depth + 1)
  }
  walk(root, 0)
  return rows
}

export function countEntities(n: MetaNode): number {
  return (n.entity ? 1 : 0) + n.children.reduce((s, c) => s + countEntities(c), 0)
}

export type ValueKind = 'number' | 'string' | 'boolean' | 'null'

export interface KeyInfo {
  key: string
  /** 最近值的类型(用于 valueType 校验);未知为 undefined */
  kind?: ValueKind
  latest?: unknown
}

/** TB REST 访问(编辑器专用,按需 + 缓存);api 与向导 / LegacyDataSource 同签名 */
export class MetaClient {
  private tsKeysCache = new Map<string, Promise<KeyInfo[]>>()
  private attrKeysCache = new Map<string, Promise<string[]>>()
  private alarmTypesCache = new Map<string, Promise<string[]>>()

  constructor(private readonly api: (url: string, data?: unknown) => Promise<unknown>) {}

  async me(): Promise<{ authority: string; customerId?: { id: string } }> {
    return (await this.api('/api/auth/user')) as { authority: string; customerId?: { id: string } }
  }
  /** 全部设备(分页);CUSTOMER_USER 只看得到自己客户的 */
  async devices(me: { authority: string; customerId?: { id: string } }): Promise<TbDevice[]> {
    const base = me.authority === 'CUSTOMER_USER' ? `/api/customer/${me.customerId!.id}/devices` : '/api/tenant/devices'
    return this.paged<TbDevice>(base)
  }
  async assets(me: { authority: string; customerId?: { id: string } }): Promise<TbAsset[]> {
    const base = me.authority === 'CUSTOMER_USER' ? `/api/customer/${me.customerId!.id}/assets` : '/api/tenant/assets'
    return this.paged<TbAsset>(base)
  }
  /**
   * 资产间 Contains 关系(from → to,只保留 to 为 ASSET 的),供 buildMetaTree 递归嵌套。
   * TB 没有「一次拉全部关系」的接口,按资产逐个查 `/api/relations?fromId=…`,并发 8。
   */
  async assetContains(assets: { id: { id: string } }[]): Promise<ContainsRel[]> {
    const out: ContainsRel[] = []
    const queue = [...assets]
    const worker = async () => {
      for (let a = queue.shift(); a; a = queue.shift()) {
        const from = a.id.id
        try {
          const rels = (await this.api(`/api/relations?fromId=${from}&fromType=ASSET&relationType=Contains`)) as
            { to: { entityType: string; id: string } }[] | null
          for (const r of rels ?? []) if (r.to?.entityType === 'ASSET') out.push({ from, to: r.to.id })
        } catch {
          /* 单个资产关系读不到只影响它的嵌套 */
        }
      }
    }
    await Promise.all(Array.from({ length: Math.min(8, assets.length) }, worker))
    return out
  }
  private async paged<T>(base: string): Promise<T[]> {
    const out: T[] = []
    for (let p = 0, hasNext = true; hasNext && p < 50; p++) {
      const page = (await this.api(`${base}?pageSize=100&page=${p}`)) as { data: T[]; hasNext: boolean }
      out.push(...page.data)
      hasNext = page.hasNext
    }
    return out
  }
  /** 遥测 key + 最近值类型(一次拉 key 列表,再分批拉最新值) */
  tsKeys(entity: EntityRef): Promise<KeyInfo[]> {
    const k = `${entity.type}/${entity.id}`
    if (!this.tsKeysCache.has(k))
      this.tsKeysCache.set(
        k,
        (async () => {
          const keys =
            ((await this.api(`/api/plugins/telemetry/${entity.type}/${entity.id}/keys/timeseries`)) as string[]) ?? []
          const latest: Record<string, { value: unknown }[]> = {}
          for (let i = 0; i < keys.length; i += 60) {
            const part = keys
              .slice(i, i + 60)
              .map(encodeURIComponent)
              .join(',')
            try {
              Object.assign(
                latest,
                (await this.api(`/api/plugins/telemetry/${entity.type}/${entity.id}/values/timeseries?keys=${part}`)) ??
                  {}
              )
            } catch {
              /* 单批失败只影响类型判断 */
            }
          }
          return keys
            .sort((a, b) => a.localeCompare(b))
            .map(key => {
              const raw = latest[key]?.[0]?.value
              const v = raw === undefined ? undefined : normalizeValue(raw)
              return {
                key,
                latest: v,
                kind: v === undefined ? undefined : v === null ? 'null' : (typeof v as ValueKind),
              }
            })
        })()
      )
    return this.tsKeysCache.get(k)!
  }
  attrKeys(entity: EntityRef, scope: string): Promise<string[]> {
    const k = `${entity.type}/${entity.id}/${scope}`
    if (!this.attrKeysCache.has(k))
      this.attrKeysCache.set(
        k,
        this.api(`/api/plugins/telemetry/${entity.type}/${entity.id}/keys/attributes/${scope}`).then(r =>
          ((r as string[]) ?? []).sort()
        )
      )
    return this.attrKeysCache.get(k)!
  }
  /** 该实体出现过的告警类型(含已清除),供 alarm 绑定的 types 选择 */
  alarmTypes(entity: EntityRef): Promise<string[]> {
    const k = `${entity.type}/${entity.id}`
    if (!this.alarmTypesCache.has(k))
      this.alarmTypesCache.set(
        k,
        this.api(`/api/alarm/${entity.type}/${entity.id}?pageSize=100&page=0&searchStatus=ANY`).then(r => {
          const list = ((r as { data?: { type: string }[] })?.data ?? []).map(a => a.type)
          return [...new Set(list)].sort()
        })
      )
    return this.alarmTypesCache.get(k)!
  }
  clear() {
    this.tsKeysCache.clear()
    this.attrKeysCache.clear()
    this.alarmTypesCache.clear()
  }
}
