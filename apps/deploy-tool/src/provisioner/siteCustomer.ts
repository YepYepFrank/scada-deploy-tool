// 第 1 步「分配给客户」(2026-09-13):站点资产分给哪个 TB 客户。客户账号(大屏值班用的)只看得到分给它所属客户的
// 站点和页面;本工具建的页面(ScadaPage)、结果资产(tbsite-agg)跟着站点走——与页面发布器、编译器 followSiteAsset
// 同一套语义。设备不动:设备可能是同事在用的,只列出客户看不到的,让人去 TB 里分。
import { NULL_UUID } from '@grid/tbsite-compiler'

export type TbCall = (url: string, data?: unknown, method?: string) => Promise<unknown>
type Ent = { id: { id: string }; name: string; type: string; customerId?: { id?: string } | null }
export interface CustomerOpt {
  id: string
  title: string
}

/** TB 的 customerId:缺失或「未分配」占位 UUID 一律 null */
export const custOf = (e?: { customerId?: { id?: string } | null } | null): string | null => {
  const id = e?.customerId?.id
  return id && id !== NULL_UUID ? id : null
}

/** 租户下的客户(不含 TB 自带的 Public 客户),按名称排序 */
export async function listCustomers(api: TbCall): Promise<CustomerOpt[]> {
  const out: CustomerOpt[] = []
  for (let p = 0, hasNext = true; hasNext && p < 20; p++) {
    const page = (await api(`/api/customers?pageSize=100&page=${p}`)) as {
      data?: { id: { id: string }; title: string; additionalInfo?: { isPublic?: boolean } | null }[]
      hasNext?: boolean
    } | null
    for (const c of page?.data || []) if (!c.additionalInfo?.isPublic) out.push({ id: c.id.id, title: c.title })
    hasNext = !!page?.hasNext
  }
  return out.sort((a, b) => a.title.localeCompare(b.title, 'zh-Hans-CN'))
}

/** 跟着站点走的资产类型:本工具建的页面、跨设备结果 / 汇聚 / 收益资产(同名的别人的资产类型不同,不动) */
export const FOLLOW_TYPES = ['ScadaPage', 'tbsite-agg']

/** 改一个资产的归属;已经一致返回 false。从一个客户换到另一个客户先取消再分,不依赖 TB 直接改派 */
async function setOwner(api: TbCall, a: Ent, target: string | null): Promise<boolean> {
  const cur = custOf(a)
  if (cur === target) return false
  if (cur) await api(`/api/customer/asset/${a.id.id}`, null, 'DELETE')
  if (target) await api(`/api/customer/${target}/asset/${a.id.id}`, {})
  return true
}

export interface AssignResult {
  /** 站点资产本身改了没有 */
  site: boolean
  /** 跟着改的页面 / 结果资产名 */
  moved: string[]
}

/** 把站点资产分给客户(null = 取消分配),站点 Contains 的本工具资产跟着改;已经一致的不动 */
export async function assignSiteCustomer(api: TbCall, siteId: string, customerId: string | null): Promise<AssignResult> {
  const site = (await api(`/api/asset/${siteId}`)) as Ent
  const res: AssignResult = { site: await setOwner(api, site, customerId), moved: [] }
  const rels = ((await api(`/api/relations?fromId=${siteId}&fromType=ASSET&relationType=Contains`)) || []) as {
    to?: { entityType: string; id: string }
  }[]
  for (const r of rels) {
    if (r.to?.entityType !== 'ASSET') continue
    const a = (await api(`/api/asset/${r.to.id}`)) as Ent | null
    if (!a || !FOLLOW_TYPES.includes(a.type)) continue
    if (await setOwner(api, a, customerId)) res.moved.push(a.name)
  }
  return res
}

/** 认领的设备里不在该客户下的(客户账号看不到它们的数据);不分配时不算 */
export function devicesOutside<T extends { customerId?: string | null }>(devices: T[], customerId: string | null): T[] {
  return customerId ? devices.filter(d => (d.customerId || null) !== customerId) : []
}
