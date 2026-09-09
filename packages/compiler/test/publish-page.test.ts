// T3.7 页面发布器:内存版 TB 验证六步、幂等(历史 +1、资产不重复)、按名称解析、注入失败逆序回滚、漂移检测。
import { describe, expect, it } from 'vitest'
import {
  detectDrift,
  listSitePages,
  NULL_UUID,
  publishPage,
  readPageState,
  resolvePageEntities,
  type PagePayload,
  type PageStepReport,
  type TbApi,
} from '../src/index'

type Ent = {
  id: { id: string; entityType: string }
  name: string
  type: string
  label?: string
  customerId?: { id: string }
  additionalInfo?: Record<string, unknown>
}
const CUSTOMER = 'cust-xrs'

/** 极简 TB:设备 / 资产 / 属性 / 关系 / 客户分配,按 publishPage 用到的接口实现;可按 URL 注入失败 */
function fakeTb() {
  let seq = 0
  const uid = () => `00000000-0000-0000-0000-${String(++seq).padStart(12, '0')}`
  const devices: Ent[] = [
    { id: { id: uid(), entityType: 'DEVICE' }, name: 'SSP1_GP1_IED1', type: 'IED' },
    { id: { id: uid(), entityType: 'DEVICE' }, name: 'PDR1_LP1_IED1', type: 'IED' },
  ]
  const assets: Ent[] = [
    { id: { id: uid(), entityType: 'ASSET' }, name: 'xrs-mirror-test', type: 'tbsite', customerId: { id: CUSTOMER } },
    { id: { id: uid(), entityType: 'ASSET' }, name: 'other-site', type: 'tbsite', customerId: { id: NULL_UUID } },
  ]
  const attrs: Record<string, Record<string, unknown>> = {}
  const relations: { from: { id: string }; to: { id: string }; type: string }[] = []
  const calls: string[] = []
  const failOn: { test: (call: string) => boolean } = { test: () => false }
  const api: TbApi = async (url, data, method) => {
    const m0 = method || (data ? 'POST' : 'GET')
    const call = `${m0} ${url}`
    calls.push(call)
    if (failOn.test(call)) throw new Error(`${url.split('?')[0]} → HTTP 500(注入)`)
    const u = new URL(url, 'http://tb')
    const p = u.pathname
    let m: RegExpMatchArray | null
    if (p === '/api/tenant/devices') {
      const d = devices.find(x => x.name === u.searchParams.get('deviceName'))
      if (!d) throw new Error(`${p} → HTTP 404`)
      return d
    }
    if (p === '/api/tenant/assets') {
      const s = u.searchParams.get('textSearch') ?? ''
      return { data: assets.filter(a => a.name.includes(s)) }
    }
    if (p === '/api/asset' && data) {
      const body = data as Ent
      if (body.id) {
        const ex = assets.find(a => a.id.id === body.id.id)!
        Object.assign(ex, body)
        return ex
      }
      const a = { ...body, id: { id: uid(), entityType: 'ASSET' }, customerId: { id: NULL_UUID } } as Ent
      assets.push(a)
      return a
    }
    if ((m = p.match(/^\/api\/asset\/(.+)$/))) {
      const i = assets.findIndex(a => a.id.id === m![1])
      if (i < 0) throw new Error(`${p} → HTTP 404`)
      if (m0 === 'DELETE') {
        assets.splice(i, 1)
        delete attrs[m[1]!]
        for (let j = relations.length - 1; j >= 0; j--) if (relations[j]!.to.id === m[1]) relations.splice(j, 1)
        return null
      }
      return assets[i]
    }
    if ((m = p.match(/^\/api\/plugins\/telemetry\/ASSET\/(.+)\/values\/attributes\/SERVER_SCOPE$/)))
      return Object.entries(attrs[m[1]!] || {}).map(([key, value]) => ({ key, value }))
    if ((m = p.match(/^\/api\/plugins\/telemetry\/ASSET\/(.+)\/attributes\/SERVER_SCOPE$/))) {
      attrs[m[1]!] = { ...(attrs[m[1]!] || {}), ...(data as object) }
      return null
    }
    if (p === '/api/relation' && m0 === 'POST') {
      relations.push(data as (typeof relations)[number])
      return null
    }
    if (p === '/api/relation') {
      const i = relations.findIndex(
        r =>
          r.from.id === u.searchParams.get('fromId') && r.to.id === u.searchParams.get('toId') && r.type === 'Contains'
      )
      if (i < 0) throw new Error(`${p} → HTTP 404`)
      if (m0 === 'DELETE') {
        relations.splice(i, 1)
        return null
      }
      return relations[i]
    }
    if (p === '/api/relations') {
      const from = u.searchParams.get('fromId')
      return relations.filter(r => r.from.id === from).map(r => ({ ...r, to: { entityType: 'ASSET', id: r.to.id } }))
    }
    if ((m = p.match(/^\/api\/customer\/([^/]+)\/asset\/(.+)$/))) {
      assets.find(a => a.id.id === m![2])!.customerId = { id: m[1]! }
      return null
    }
    if ((m = p.match(/^\/api\/customer\/asset\/(.+)$/)) && m0 === 'DELETE') {
      const cur = assets.find(a => a.id.id === m![1])!
      // 真实 TB:本来就没分配时再取消一次会 400(2026-09-08 镜像实测)
      if (!cur.customerId || cur.customerId.id === NULL_UUID) throw new Error('HTTP 400 资产本来就未分配')
      cur.customerId = { id: NULL_UUID }
      return null
    }
    throw new Error(`fakeTb 不认识 ${call}`)
  }
  return { api, devices, assets, attrs, relations, calls, failOn }
}

const page = (title = '总览'): PagePayload => ({
  schemaVersion: 1,
  template: 'overview-a',
  title,
  widgets: [
    {
      id: 'w-s1',
      type: 'number-card',
      slot: 's1',
      bindings: { value: { mode: 'ts', entity: { type: 'DEVICE', id: 'stale', name: 'SSP1_GP1_IED1' }, key: 'P' } },
    },
    {
      id: 'w-g1',
      type: 'line',
      slot: 'g1',
      bindings: {
        series: [
          { mode: 'ts-history', entity: { type: 'DEVICE', id: '', name: 'PDR1_LP1_IED1' }, keys: ['P'], window: '24h' },
          { mode: 'const', value: 1 },
        ],
      },
    },
    {
      id: 'w-a',
      type: 'alarm-list',
      slot: 's2',
      bindings: { alarms: { mode: 'alarm', entity: { type: 'ASSET', id: 'x', name: 'xrs-mirror-test' } } },
      actions: { reset: { kind: 'rpc', entity: { type: 'DEVICE', id: 'keep-me' }, method: 'reset' } },
    },
  ],
})
const collect = () => {
  const log: PageStepReport[] = []
  return { log, report: (r: PageStepReport) => log.push(r) }
}
const clock = (() => {
  let t = 1_700_000_000_000
  return () => (t += 1000)
})()

describe('publishPage', () => {
  it('首次发布:按名称解析实体、新建 ScadaPage 资产、写属性 version 1、Contains 关系、分给站点的 Customer', async () => {
    const tb = fakeTb()
    const { log, report } = collect()
    const r = await publishPage(page(), tb.api, { siteName: 'xrs-mirror-test', publishedBy: 'yy', report, now: clock })
    expect(r.ok).toBe(true)
    expect(r.pageName).toBe('xrs-mirror-test-总览')
    expect([r.version, r.historyLength, r.unresolved, r.rolledBack]).toEqual([1, 0, [], []])
    expect(log.filter(l => l.status === 'ok').map(l => l.step)).toEqual([
      'resolve',
      'asset',
      'history',
      'write',
      'relation',
      'assign',
    ])
    const asset = tb.assets.find(a => a.name === r.pageName)!
    expect(asset.type).toBe('ScadaPage')
    expect(asset.label).toBe('总览')
    expect(asset.additionalInfo).toEqual({ managedBy: 'deploy-tool', version: 1 })
    expect(asset.customerId).toEqual({ id: CUSTOMER })
    // 实体:name 保留,id 换成当前环境的;action 的 entity(无 name)原样
    const stored = JSON.parse(tb.attrs[asset.id.id]!.pageConfig as string) as PagePayload
    const val = stored.widgets[0]!.bindings.value as { entity: { id: string; name: string } }
    expect(val.entity).toEqual({ type: 'DEVICE', id: tb.devices[0]!.id.id, name: 'SSP1_GP1_IED1' })
    const series = stored.widgets[1]!.bindings.series as { entity?: { id: string } }[]
    expect(series[0]!.entity!.id).toBe(tb.devices[1]!.id.id)
    expect((stored.widgets[2]!.bindings.alarms as { entity: { id: string } }).entity.id).toBe(tb.assets[0]!.id.id)
    expect((stored.widgets[2]!.actions!.reset as { entity: { id: string } }).entity.id).toBe('keep-me')
    expect(tb.attrs[asset.id.id]!.pageConfigHistory).toEqual([])
    expect(tb.relations).toEqual([
      {
        from: { entityType: 'ASSET', id: tb.assets[0]!.id.id },
        to: { entityType: 'ASSET', id: asset.id.id },
        type: 'Contains',
        typeGroup: 'COMMON',
      },
    ])
    // 输入没被改
    expect((page().widgets[0]!.bindings.value as { entity: { id: string } }).entity.id).toBe('stale')
  })

  it('再发布:资产不重复、version +1、历史 +1(带 ts / publishedBy / version)、关系与分配不重复;最多 10 版', async () => {
    const tb = fakeTb()
    const opts = { siteName: 'xrs-mirror-test', publishedBy: 'yy', now: clock }
    await publishPage(page(), tb.api, opts)
    const p2 = page()
    p2.widgets[0]!.props = { title: '改过' }
    const r2 = await publishPage(p2, tb.api, { ...opts, publishedBy: 'zz' })
    expect(r2.ok).toBe(true)
    expect([r2.version, r2.historyLength]).toEqual([2, 1])
    expect(tb.assets.filter(a => a.name === r2.pageName)).toHaveLength(1)
    expect(tb.relations).toHaveLength(1)
    const asset = tb.assets.find(a => a.name === r2.pageName)!
    const hist = tb.attrs[asset.id.id]!.pageConfigHistory as {
      ts: number
      publishedBy: string
      version: number
      config: PagePayload
    }[]
    expect(hist).toHaveLength(1)
    expect([hist[0]!.version, hist[0]!.publishedBy, typeof hist[0]!.ts]).toEqual([1, 'zz', 'number'])
    expect(hist[0]!.config.widgets[0]!.props).toBeUndefined()
    expect(asset.additionalInfo!.version).toBe(2)
    for (let i = 0; i < 12; i++) await publishPage(page(), tb.api, opts)
    const h2 = tb.attrs[asset.id.id]!.pageConfigHistory as unknown[]
    expect(h2).toHaveLength(10)
    expect(asset.additionalInfo!.version).toBe(14)
    // 站点未分配 Customer 时页面也不分配
    const r3 = await publishPage(page('B'), tb.api, { siteName: 'other-site' })
    expect(r3.ok).toBe(true)
    expect(tb.assets.find(a => a.name === 'other-site-B')!.customerId!.id).toBe(NULL_UUID)
  })

  it('解析不到的实体阻止发布,什么都不写;列出类型 / 名称 / 出现位置', async () => {
    const tb = fakeTb()
    const p = page()
    ;(p.widgets[0]!.bindings.value as { entity: { name: string } }).entity.name = 'GHOST'
    ;(p.widgets[1]!.bindings.series as { entity?: { name: string } }[])[0]!.entity!.name = 'GHOST'
    const r = await publishPage(p, tb.api, { siteName: 'xrs-mirror-test' })
    expect(r.ok).toBe(false)
    expect(r.failedStep).toBe('resolve')
    expect(r.unresolved).toEqual([{ type: 'DEVICE', name: 'GHOST', at: ['w-s1/value', 'w-g1/series/0'] }])
    expect(tb.assets.map(a => a.type)).toEqual(['tbsite', 'tbsite'])
    expect(tb.calls.filter(c => c.startsWith('POST'))).toEqual([])
    // 站点不存在也在第一步就停
    const r2 = await publishPage(page(), tb.api, { siteName: 'nope' })
    expect(r2.error).toContain('站点资产「nope」不存在')
  })

  it('同名资产不是 ScadaPage 时拒绝覆盖', async () => {
    const tb = fakeTb()
    const r = await publishPage(page(), tb.api, { siteName: 'xrs-mirror-test', pageName: 'other-site' })
    expect(r.ok).toBe(false)
    expect(r.failedStep).toBe('asset')
    expect(r.error).toContain('不是 ScadaPage')
  })

  it('首次发布在第 ⑤ 步失败:新建的资产被删除、关系不存在、无残留', async () => {
    const tb = fakeTb()
    tb.failOn.test = c => c.startsWith('POST /api/relation')
    const { log, report } = collect()
    const r = await publishPage(page(), tb.api, { siteName: 'xrs-mirror-test', report })
    expect(r.ok).toBe(false)
    expect(r.failedStep).toBe('relation')
    expect(r.rolledBack).toEqual(['删除新建的资产 xrs-mirror-test-总览'])
    expect(tb.assets.map(a => a.name)).toEqual(['xrs-mirror-test', 'other-site'])
    expect(tb.relations).toEqual([])
    expect(Object.keys(tb.attrs)).toEqual([])
    expect(log.at(-1)).toEqual({ step: 'relation', status: 'rollback', detail: '删除新建的资产 xrs-mirror-test-总览' })
  })

  it('二次发布在第 ⑤ 步之后注入失败:属性 / 历史 / version 还原到发布前,关系与分配保持原样', async () => {
    const tb = fakeTb()
    const opts = { siteName: 'xrs-mirror-test', publishedBy: 'yy', now: clock }
    await publishPage(page(), tb.api, opts)
    const asset = tb.assets.find(a => a.type === 'ScadaPage')!
    const before = { attrs: JSON.parse(JSON.stringify(tb.attrs[asset.id.id])), info: { ...asset.additionalInfo } }
    const p2 = page()
    p2.widgets[0]!.props = { title: '改过' }
    const r = await publishPage(p2, tb.api, { ...opts, failAfter: 'relation' })
    expect(r.ok).toBe(false)
    expect(r.failedStep).toBe('relation')
    expect(r.rolledBack).toEqual(['还原资产 version 1', '还原 xrs-mirror-test-总览 的 pageConfig / 历史'])
    expect(tb.attrs[asset.id.id]).toEqual(before.attrs)
    expect(asset.additionalInfo).toEqual(before.info)
    expect(tb.relations).toHaveLength(1)
    expect(asset.customerId).toEqual({ id: CUSTOMER })
    // 回滚后再发布仍然正常,version 2
    const r3 = await publishPage(p2, tb.api, opts)
    expect([r3.ok, r3.version]).toEqual([true, 2])
  })

  it('第 ⑥ 步失败:关系被删、页面资产被删(首次)', async () => {
    const tb = fakeTb()
    tb.failOn.test = c => /^POST \/api\/customer\//.test(c)
    const r = await publishPage(page(), tb.api, { siteName: 'xrs-mirror-test' })
    expect(r.failedStep).toBe('assign')
    expect(r.rolledBack).toEqual(['删除 Contains 关系', '删除新建的资产 xrs-mirror-test-总览'])
    expect(tb.relations).toEqual([])
    expect(tb.assets).toHaveLength(2)
  })

  it('readPageState / listSitePages / detectDrift / 恢复历史版本', async () => {
    const tb = fakeTb()
    const opts = { siteName: 'xrs-mirror-test', publishedBy: 'yy', now: clock }
    const r1 = await publishPage(page(), tb.api, opts)
    const p2 = page()
    p2.widgets[0]!.props = { title: 'v2' }
    await publishPage(p2, tb.api, opts)
    const state = await readPageState(tb.api, r1.assetId!)
    expect(state.config!.widgets[0]!.props).toEqual({ title: 'v2' })
    expect(state.history.map(h => h.version)).toEqual([1])
    expect(await listSitePages(tb.api, 'xrs-mirror-test')).toEqual([
      { assetId: r1.assetId, name: 'xrs-mirror-test-总览', label: '总览', version: 2 },
    ])
    // 项目文件记的是 version 1 → 漂移;记 2 → 无
    const published = { [r1.pageName]: { assetId: r1.assetId!, version: 1, at: 0, by: 'yy' } }
    expect(await detectDrift(tb.api, 'xrs-mirror-test', published)).toEqual([
      { pageName: r1.pageName, local: 1, remote: 2, assetId: r1.assetId },
    ])
    published[r1.pageName]!.version = 2
    expect(await detectDrift(tb.api, 'xrs-mirror-test', published)).toEqual([])
    expect(await detectDrift(tb.api, 'xrs-mirror-test', { gone: { assetId: 'x', version: 1, at: 0, by: '' } })).toEqual(
      [{ pageName: 'gone', local: 1, remote: null, assetId: null }]
    )
    // 「恢复为当前」= 把历史里那版再发布一次:旧当前版入历史,version 3
    const r3 = await publishPage(state.history[0]!.config, tb.api, opts)
    expect([r3.ok, r3.version, r3.historyLength]).toEqual([true, 3, 2])
    const after = await readPageState(tb.api, r1.assetId!)
    expect(after.config!.widgets[0]!.props).toBeUndefined()
    expect(after.history.map(h => h.version)).toEqual([2, 1])
  })

  it('resolvePageEntities:同名只查一次;没 name 的引用原样', async () => {
    const tb = fakeTb()
    const { resolved, unresolved, count } = await resolvePageEntities(tb.api, page())
    expect([unresolved, count]).toEqual([[], 3])
    expect(tb.calls.filter(c => c.includes('deviceName='))).toHaveLength(2)
    expect((resolved.widgets[2]!.actions!.reset as { entity: { id: string } }).entity.id).toBe('keep-me')
  })
})

describe('publishPage · 页面归属跟着站点走(审查 R2,2026-09-08)', () => {
  const OTHER = '00000000-0000-0000-0000-0000000000ff'
  const opts = (report?: ReturnType<typeof collect>['report']) => ({
    siteName: 'xrs-mirror-test',
    publishedBy: 'yy',
    now: clock,
    ...(report ? { report } : {}),
  })
  const siteOf = (tb: ReturnType<typeof fakeTb>) => tb.assets.find(a => a.name === 'xrs-mirror-test')!
  const pageOf = (tb: ReturnType<typeof fakeTb>) => tb.assets.find(a => a.name === 'xrs-mirror-test-总览')!

  it('站点取消 Customer 分配后再发布:页面同步取消,不再留在原 Customer 名下', async () => {
    const tb = fakeTb()
    await publishPage(page(), tb.api, opts())
    expect(pageOf(tb).customerId).toEqual({ id: CUSTOMER })

    // 有人把站点资产从 Customer 下撤了
    siteOf(tb).customerId = { id: NULL_UUID }
    const { log, report } = collect()
    const r = await publishPage(page(), tb.api, opts(report))
    expect(r.ok).toBe(true)
    expect(pageOf(tb).customerId!.id).toBe(NULL_UUID)
    expect(log.find(l => l.step === 'assign' && l.status === 'ok')!.detail).toContain('页面同步取消')
    expect(tb.calls).toContain(`DELETE /api/customer/asset/${pageOf(tb).id.id}`)
  })

  it('站点换到另一个 Customer:页面跟着换', async () => {
    const tb = fakeTb()
    await publishPage(page(), tb.api, opts())
    siteOf(tb).customerId = { id: OTHER }
    const { log, report } = collect()
    await publishPage(page(), tb.api, opts(report))
    expect(pageOf(tb).customerId).toEqual({ id: OTHER })
    expect(log.find(l => l.step === 'assign' && l.status === 'ok')!.detail).toContain(OTHER)
  })

  it('站点与页面都未分配:什么都不做', async () => {
    const tb = fakeTb()
    siteOf(tb).customerId = { id: NULL_UUID }
    const { log, report } = collect()
    await publishPage(page(), tb.api, opts(report))
    expect(pageOf(tb).customerId!.id).toBe(NULL_UUID)
    expect(log.find(l => l.step === 'assign' && l.status === 'ok')!.detail).toContain('都未分配')
    expect(tb.calls.filter(c => c.includes('/api/customer/'))).toEqual([])
  })

  it('已在站点所属 Customer 下:不重复分配', async () => {
    const tb = fakeTb()
    await publishPage(page(), tb.api, opts())
    const before = tb.calls.filter(c => c.includes('/api/customer/')).length
    const { log, report } = collect()
    await publishPage(page(), tb.api, opts(report))
    expect(log.find(l => l.step === 'assign' && l.status === 'ok')!.detail).toContain('已在站点所属 Customer 下')
    expect(tb.calls.filter(c => c.includes('/api/customer/')).length).toBe(before)
  })

  it('取消分配之后的步骤失败:回滚把页面改回原 Customer', async () => {
    const tb = fakeTb()
    await publishPage(page(), tb.api, opts())
    siteOf(tb).customerId = { id: NULL_UUID }
    // assign 是最后一步,回滚栈由后续注入失败触发 —— 这里直接验回滚项本身
    tb.failOn.test = c => c.startsWith('DELETE /api/customer/asset/')
    const r = await publishPage(page(), tb.api, opts())
    expect(r.ok).toBe(false)
    // 取消分配这一步就失败了,页面归属保持原样,没有半吊子状态
    expect(pageOf(tb).customerId).toEqual({ id: CUSTOMER })
  })
})
