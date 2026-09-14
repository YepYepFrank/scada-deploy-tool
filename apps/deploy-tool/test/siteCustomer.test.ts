// 第 1 步「分配给客户」(2026-09-13):站点分给客户,本工具的页面 / 结果资产跟着走,别的资产和设备不动。
import { describe, expect, it } from 'vitest'
import { NULL_UUID } from '@grid/tbsite-compiler'
import { assignSiteCustomer, custOf, devicesOutside, listCustomers } from '../src/provisioner/siteCustomer'

type A = { id: { id: string }; name: string; type: string; customerId?: { id: string } }
const asset = (id: string, name: string, type: string, cust?: string): A => ({
  id: { id },
  name,
  type,
  customerId: { id: cust || NULL_UUID },
})

function fakeTb(assets: A[], contains: string[]) {
  const calls: string[] = []
  const byId = (id: string) => assets.find(a => a.id.id === id)!
  const api = async (url: string, _data?: unknown, method?: string): Promise<unknown> => {
    let m: RegExpMatchArray | null
    if ((m = url.match(/^\/api\/asset\/([^/?]+)$/))) return byId(m[1]!)
    if (url.startsWith('/api/relations?'))
      return contains.map(id => ({ to: { entityType: id.startsWith('dev') ? 'DEVICE' : 'ASSET', id } }))
    if ((m = url.match(/^\/api\/customer\/asset\/(.+)$/)) && method === 'DELETE') {
      calls.push(`取消 ${byId(m[1]!).name}`)
      byId(m[1]!).customerId = { id: NULL_UUID }
      return null
    }
    if ((m = url.match(/^\/api\/customer\/([^/]+)\/asset\/(.+)$/))) {
      calls.push(`分 ${byId(m[2]!).name} → ${m[1]}`)
      byId(m[2]!).customerId = { id: m[1]! }
      return null
    }
    throw new Error('没料到的请求 ' + url)
  }
  return { api, calls, byId }
}

const world = () =>
  fakeTb(
    [
      asset('s', 'demo-site', 'tbsite'),
      asset('p1', 'demo-site · 总览', 'ScadaPage'),
      asset('g1', 'demo-site_CALC', 'tbsite-agg', 'C1'),
      asset('o1', '同事的楼宇', 'building'),
    ],
    ['p1', 'g1', 'o1', 'dev1']
  )

describe('分配给客户', () => {
  it('列客户:翻页、去掉 Public 客户、按名称排序', async () => {
    const pages: Record<number, unknown> = {
      0: {
        data: [
          { id: { id: 'c2' }, title: '仙人山服务区' },
          { id: { id: 'pub' }, title: 'Public', additionalInfo: { isPublic: true } },
        ],
        hasNext: true,
      },
      1: { data: [{ id: { id: 'c1' }, title: '二期客户' }], hasNext: false },
    }
    const list = await listCustomers(async url => pages[Number(url.match(/page=(\d+)/)![1])])
    expect(list.map(c => c.title)).toEqual(['二期客户', '仙人山服务区'])
  })

  it('站点分给客户:站点和本工具的页面跟着分;已在该客户下的结果资产不重复分;别的资产、设备不动', async () => {
    const tb = world()
    const r = await assignSiteCustomer(tb.api, 's', 'C1')
    expect(r).toEqual({ site: true, moved: ['demo-site · 总览'] })
    expect(tb.calls).toEqual(['分 demo-site → C1', '分 demo-site · 总览 → C1'])
    expect(custOf(tb.byId('o1'))).toBeNull()
  })

  it('换客户先取消再分;取消分配只动已分配的;已经一致时什么都不做', async () => {
    const tb = world()
    await assignSiteCustomer(tb.api, 's', 'C1')
    tb.calls.length = 0
    await assignSiteCustomer(tb.api, 's', 'C2')
    expect(tb.calls).toEqual([
      '取消 demo-site',
      '分 demo-site → C2',
      '取消 demo-site · 总览',
      '分 demo-site · 总览 → C2',
      '取消 demo-site_CALC',
      '分 demo-site_CALC → C2',
    ])
    tb.calls.length = 0
    expect(await assignSiteCustomer(tb.api, 's', 'C2')).toEqual({ site: false, moved: [] })
    expect(tb.calls).toEqual([])
    const r = await assignSiteCustomer(tb.api, 's', null)
    expect(r.moved).toEqual(['demo-site · 总览', 'demo-site_CALC'])
    expect(tb.calls).toEqual(['取消 demo-site', '取消 demo-site · 总览', '取消 demo-site_CALC'])
  })

  it('custOf 把「未分配」占位 UUID 当 null;devicesOutside 列出不在该客户下的设备', () => {
    expect(custOf({ customerId: { id: NULL_UUID } })).toBeNull()
    expect(custOf({})).toBeNull()
    expect(custOf({ customerId: { id: 'C1' } })).toBe('C1')
    const devs = [
      { name: 'A', customerId: 'C1' },
      { name: 'B', customerId: null },
      { name: 'C', customerId: 'C2' },
    ]
    expect(devicesOutside(devs, 'C1').map(d => d.name)).toEqual(['B', 'C'])
    expect(devicesOutside(devs, null)).toEqual([])
  })
})
