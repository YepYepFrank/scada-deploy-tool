// 写入器:用内存版 TB(mock TbApi)验证幂等与清理。不连真实 TB(live 用例在 test/live,T2.5)。
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { cleanup, compile, publish, resolveDeviceIds, type StepId, type TbApi, type TbsiteConfig } from '../src/index'

type Ent = { id: { id: string; entityType: string }; name: string; type?: string; root?: boolean; [k: string]: unknown }

/** 极简 TB:设备 / 资产 / 规则链 / CF / 关系 / 属性 / 公开标记,按 publisher 用到的接口实现 */
function fakeTb(deviceNames: string[]) {
  let seq = 0
  const uid = () => `00000000-0000-0000-0000-${String(++seq).padStart(12, '0')}`
  const devices: Ent[] = deviceNames.map(name => ({ id: { id: uid(), entityType: 'DEVICE' }, name }))
  const assets: Ent[] = []
  const chains: Ent[] = [{ id: { id: uid(), entityType: 'RULE_CHAIN' }, name: 'Root Rule Chain', root: true }]
  type Meta = {
    ruleChainId: { id: string }
    nodes: { type: string; name: string; configuration: Record<string, unknown> }[]
    connections: unknown[]
    firstNodeIndex: number | null
  }
  const rootId = chains[0]!.id.id
  const metadata: Record<string, Meta> = {
    [rootId]: {
      ruleChainId: { id: rootId },
      nodes: [
        {
          type: 'org.thingsboard.rule.engine.filter.TbMsgTypeSwitchNode',
          name: 'Message Type Switch',
          configuration: {},
        },
      ],
      connections: [],
      firstNodeIndex: 0,
    },
  }
  const cfs: (Ent & { entityId: { id: string } })[] = []
  const relations: unknown[] = []
  const attrs: Record<string, Record<string, unknown>> = {}
  const publicIds = new Set<string>()
  const calls: string[] = []
  const page = (list: Ent[], search?: string | null) => ({
    data: search ? list.filter(e => e.name.includes(search)) : list,
  })

  const api: TbApi = async (url, data, method) => {
    calls.push(`${method || (data ? 'POST' : 'GET')} ${url}`)
    const u = new URL(url, 'http://tb')
    const p = u.pathname
    const search = u.searchParams.get('textSearch')
    let m: RegExpMatchArray | null
    if (p === '/api/tenant/devices') return page(devices, search)
    if (p === '/api/tenant/assets') return page(assets, search)
    if (p === '/api/asset' && data) {
      const a = { id: { id: uid(), entityType: 'ASSET' }, ...(data as object) } as Ent
      assets.push(a)
      return a
    }
    if ((m = p.match(/^\/api\/customer\/([^/]+)\/asset\/(.+)$/)) && data) {
      const a = assets.find(x => x.id.id === m![2])
      if (!a) throw new Error(`${url} → HTTP 404`)
      a.customerId = { id: m[1], entityType: 'CUSTOMER' }
      return a
    }
    if ((m = p.match(/^\/api\/asset\/(.+)$/)) && !method && !data) {
      const a = assets.find(x => x.id.id === m![1])
      if (!a) throw new Error(`${url} → HTTP 404`)
      return a
    }
    if ((m = p.match(/^\/api\/asset\/(.+)$/)) && method === 'DELETE') {
      const i = assets.findIndex(a => a.id.id === m![1])
      if (i < 0) throw new Error(`${url} → HTTP 404`)
      assets.splice(i, 1)
      for (let j = cfs.length - 1; j >= 0; j--) if (cfs[j]!.entityId.id === m[1]) cfs.splice(j, 1)
      return null
    }
    if (p === '/api/ruleChains') return page(chains, search)
    if (p === '/api/ruleChain' && data) {
      const c = { id: { id: uid(), entityType: 'RULE_CHAIN' }, ...(data as object) } as Ent
      chains.push(c)
      metadata[c.id.id] = { ruleChainId: { id: c.id.id }, nodes: [], connections: [], firstNodeIndex: null }
      return c
    }
    if ((m = p.match(/^\/api\/ruleChain\/(.+)\/metadata$/))) return metadata[m[1]!]
    if ((m = p.match(/^\/api\/ruleChain\/(.+)$/)) && method === 'DELETE') {
      chains.splice(
        chains.findIndex(c => c.id.id === m![1]),
        1
      )
      delete metadata[m[1]!]
      return null
    }
    if (p === '/api/ruleChain/metadata') {
      const md = data as Meta
      metadata[md.ruleChainId.id] = md
      return md
    }
    if ((m = p.match(/^\/api\/(DEVICE|ASSET)\/(.+)\/calculatedFields$/)))
      return { data: cfs.filter(c => c.entityId.id === m![2]) }
    if (p === '/api/calculatedField' && data) {
      const body = data as { id?: { id: string }; name: string; entityId: { id: string } }
      if (body.id) {
        const ex = cfs.find(c => c.id.id === body.id!.id)
        if (!ex) throw new Error('CF not found')
        Object.assign(ex, body)
        return ex
      }
      const cf = { ...body, id: { id: uid(), entityType: 'CALCULATED_FIELD' } } as Ent & { entityId: { id: string } }
      cfs.push(cf)
      return cf
    }
    if ((m = p.match(/^\/api\/calculatedField\/(.+)$/)) && method === 'DELETE') {
      cfs.splice(
        cfs.findIndex(c => c.id.id === m![1]),
        1
      )
      return null
    }
    if (p === '/api/relation') {
      relations.push(data)
      return null
    }
    if ((m = p.match(/^\/api\/customer\/public\/(asset|device)\/(.+)$/))) {
      publicIds.add(m[2]!)
      return null
    }
    if ((m = p.match(/^\/api\/plugins\/telemetry\/ASSET\/(.+)\/values\/attributes\/SERVER_SCOPE$/)))
      return Object.entries(attrs[m[1]!] || {}).map(([key, value]) => ({ key, value }))
    if ((m = p.match(/^\/api\/plugins\/telemetry\/ASSET\/(.+)\/attributes\/SERVER_SCOPE$/))) {
      attrs[m[1]!] = { ...(attrs[m[1]!] || {}), ...(data as object) }
      return null
    }
    throw new Error(`fakeTb 不认识 ${method || 'GET/POST'} ${url}`)
  }
  return { api, devices, assets, chains, metadata, cfs, relations, attrs, publicIds, calls }
}

const fixture = (n: string) => JSON.parse(readFileSync(resolve(__dirname, 'fixtures', n), 'utf8')) as TbsiteConfig
const collect = () => {
  const log: string[] = []
  const report = (step: StepId, status: string, detail?: string) =>
    log.push(`${step}:${status}${detail ? ' ' + detail : ''}`)
  return { log, report }
}

describe('publish(写入器)', () => {
  it('xrs-mirror-test:全部步骤成功;二次发布幂等(CF / 规则链数量不变,CF 原地更新)', async () => {
    const cfg = fixture('xrs-mirror-test.tbsite.json')
    const tb = fakeTb(cfg.devices.map(d => d.name))
    const { devIds, missing } = await resolveDeviceIds(
      tb.api,
      cfg.devices.map(d => d.name)
    )
    expect(missing).toEqual([])
    const r1 = collect()
    const f1 = await publish(cfg, devIds, tb.api, r1.report, { publishedBy: 'tester', layeredSettleMs: 0 })
    expect(f1).toEqual([])
    expect(r1.log.filter(l => l.includes(':err'))).toEqual([])
    const snap = () => ({
      cfs: tb.cfs.length,
      chains: tb.chains.map(c => c.name).sort(),
      assets: tb.assets.map(a => `${a.name}:${a.type}`).sort(),
    })
    const s1 = snap()
    expect(s1.chains).toEqual([
      'Root Rule Chain',
      `Site Alarms · ${cfg.site.name}`,
      `Site Revenue · ${cfg.site.name}`,
      `Site Rollups · ${cfg.site.name}`,
    ])
    const plan = compile(cfg)
    expect(s1.cfs).toBe(plan.cfs.length + plan.aggregates.reduce((n, a) => n + a.bodies.length, 0)) // 设备 CF + 汇聚资产 CF
    // Root 链接了本站点转发节点
    const root = tb.metadata[tb.chains[0]!.id.id]!
    expect(root.nodes.map(n => n.name)).toEqual(['Message Type Switch', `site alarms flow · ${cfg.site.name}`])
    expect(root.connections).toHaveLength(1)
    // 站点资产:配置存为属性、历史为空;不再设为 Public(T3.7)
    const site = tb.assets.find(a => a.name === cfg.site.name && a.type === 'tbsite')!
    expect(tb.attrs[site.id.id]!.siteConfig).toEqual(cfg)
    expect(tb.attrs[site.id.id]!.siteConfigHistory).toEqual([])
    expect(tb.publicIds.size).toBe(0)

    const r2 = collect()
    const f2 = await publish(cfg, devIds, tb.api, r2.report, { publishedBy: 'tester', layeredSettleMs: 0 })
    expect(f2).toEqual([])
    expect(snap()).toEqual(s1)
    expect(r2.log.find(l => l.startsWith('cf:ok'))).toBe(`cf:ok 新建 0 · 更新 ${plan.cfs.length}`)
    expect(r2.log.find(l => l.startsWith('alarm:ok'))).toContain('转发已就位')
    expect((tb.attrs[site.id.id]!.siteConfigHistory as unknown[]).length).toBe(1)
  })

  it('demo-site:窗口聚合 / 边沿告警 / 模板展开;retry 只重跑指定步骤', async () => {
    const cfg = fixture('demo-site.tbsite.json')
    const tb = fakeTb(cfg.devices.map(d => d.name))
    const { devIds } = await resolveDeviceIds(
      tb.api,
      cfg.devices.map(d => d.name)
    )
    const r = collect()
    expect(await publish(cfg, devIds, tb.api, r.report)).toEqual([])
    expect(r.log.find(l => l.startsWith('rollup:ok'))).toMatch(/条流水线/)
    const before = tb.calls.length
    const r2 = collect()
    await publish(cfg, devIds, tb.api, r2.report, { retry: { steps: ['cf'], cf: [] } })
    expect(r2.log.filter(l => l.includes('跳过(上次已成功)')).map(l => l.split(':')[0])).toEqual([
      'agg',
      'revenue',
      'rollup',
      'alarm',
      'asset',
    ])
    expect(tb.calls.length - before).toBeLessThan(10)
  })

  it('设备不存在时在 devices 步骤终止;校验失败抛错', async () => {
    const cfg = fixture('demo-site.tbsite.json')
    const tb = fakeTb([])
    const r = collect()
    await expect(publish(cfg, {}, tb.api, r.report)).rejects.toThrow('在 TB 中不存在')
    expect(r.log.at(-1)).toMatch(/^devices:err/)
    await expect(publish({ ...cfg, devices: [] }, {}, tb.api, r.report)).rejects.toThrow('校验失败')
  })
})

describe('publish · ADR-003 前缀 / 清理旧输出 / 汇聚资产随站点', () => {
  const dev = (name: string, keys: string[]) => ({ name, profile: 'IED', keys: keys.map(key => ({ key })) })
  const cfgOf = (output: string, extra: Partial<TbsiteConfig> = {}): TbsiteConfig => ({
    schema: 'tbsite/v2',
    site: { name: 'S' },
    devices: [dev('D1', ['P', 'Q']), dev('D2', ['P'])],
    computations: [
      {
        template: 'expr.add',
        device: 'D1',
        output,
        inputs: { a: { device: 'D1', key: 'P' }, b: { device: 'D1', key: 'Q' } },
      },
      {
        template: 'aggregate.crossEntity',
        name: 'ΣP',
        selector: { profiles: ['IED'] },
        key: 'P',
        agg: 'sum',
        asset: 'S-agg',
        output: 'totalP',
      },
      { template: 'window.cascade', device: 'D1', keys: ['P'], aggs: ['avg'] },
      {
        template: 'alarm.threshold',
        device: 'D1',
        key: output,
        name: 'x',
        condition: { op: 'gt', value: 1 },
        severity: 'MINOR',
        message: 'm',
      },
    ],
    ...extra,
  })

  it('带前缀:CF / 汇聚 / 级联 / 告警引用全部改名;calcCascadeKeys 写站点资产;入口过滤含白名单', async () => {
    const cfg = cfgOf('pq', { outputPrefix: 'calc_' })
    const tb = fakeTb(['D1', 'D2'])
    const { devIds } = await resolveDeviceIds(tb.api, ['D1', 'D2'])
    const r = collect()
    expect(await publish(cfg, devIds, tb.api, r.report, { publishedBy: 't', layeredSettleMs: 0 })).toEqual([])
    expect(tb.cfs.map(c => c.name).sort()).toEqual(['calc_pq', 'calc_totalP'])
    const site = tb.assets.find(a => a.name === 'S')!
    expect(tb.attrs[site.id.id]!.calcCascadeKeys).toEqual(['calc_PAvg1h', 'calc_PAvg5m', 'calc_pq'])
    const alarmChain = tb.chains.find(c => c.name === 'Site Alarms · S')!
    const entry = tb.metadata[alarmChain.id.id]!.nodes.find(n => n.name === 'entry')!
    expect(entry.configuration.jsScript).toContain('"calc_pq":1')
    expect(entry.configuration.jsScript).toContain("typeof metadata.deviceName === 'undefined'")
    const relNode = tb.metadata[alarmChain.id.id]!.nodes.find(n => String(n.name).startsWith('关于 D1.'))!
    expect(relNode.name).toBe('关于 D1.calc_pq?')
    const rollup = tb.chains.find(c => c.name === 'Site Rollups · S')!
    const lv2 = tb.metadata[rollup.id.id]!.nodes.find(n => n.name === '级联汇算 D1 @1h')!
    expect(lv2.configuration.jsScript).toContain('{"src":"calc_PAvg5m","out":"calc_PAvg1h","fn":"avg"}')
    expect(r.log.find(l => l.startsWith('validate:ok'))).toContain('输出前缀 calc_')
  })

  it('再发布时清理上一版声明、这一版没有的输出 CF;汇聚资产分给站点 Customer 并建 Contains', async () => {
    const tb = fakeTb(['D1', 'D2'])
    const { devIds } = await resolveDeviceIds(tb.api, ['D1', 'D2'])
    const r1 = collect()
    expect(await publish(cfgOf('pq'), devIds, tb.api, r1.report, { layeredSettleMs: 0 })).toEqual([])
    expect(tb.cfs.map(c => c.name).sort()).toEqual(['pq', 'totalP'])
    // 模拟运维把站点资产分给了某 Customer
    const site = tb.assets.find(a => a.name === 'S')!
    site.customerId = { id: 'cust-1', entityType: 'CUSTOMER' }
    const r2 = collect()
    expect(
      await publish(cfgOf('pq', { outputPrefix: 'calc_' }), devIds, tb.api, r2.report, { layeredSettleMs: 0 })
    ).toEqual([])
    // 旧 pq / totalP 被清,新 calc_ 版就位
    expect(tb.cfs.map(c => c.name).sort()).toEqual(['calc_pq', 'calc_totalP'])
    expect(r2.log.find(l => l.startsWith('cf:ok'))).toContain('清理旧输出 2')
    const agg = tb.assets.find(a => a.name === 'S-agg')!
    expect(agg.customerId).toEqual({ id: 'cust-1', entityType: 'CUSTOMER' })
    expect(
      tb.relations.some((x: unknown) => {
        const r = x as { from: { id: string }; to: { id: string }; type: string }
        return r.from.id === site.id.id && r.to.id === agg.id.id && r.type === 'Contains'
      })
    ).toBe(true)
    expect(r2.log.find(l => l.startsWith('asset:ok'))).toContain('汇聚资产随站点 1')
  })
})

describe('cleanup', () => {
  it('删掉本站点的 CF / 规则链 / Root 转发 / 汇聚资产 / 站点资产,不碰存量', async () => {
    const cfg = fixture('xrs-mirror-test.tbsite.json')
    const tb = fakeTb(cfg.devices.map(d => d.name))
    const { devIds } = await resolveDeviceIds(
      tb.api,
      cfg.devices.map(d => d.name)
    )
    // 存量对象:别的站点的链与资产,以及一个人工 CF
    tb.chains.push({ id: { id: 'other-chain', entityType: 'RULE_CHAIN' }, name: 'Site Alarms · other' })
    tb.assets.push({ id: { id: 'other-asset', entityType: 'ASSET' }, name: 'other', type: 'tbsite' })
    await publish(cfg, devIds, tb.api, () => {}, { layeredSettleMs: 0 })
    const host = devIds[cfg.devices[0]!.name]!
    await tb.api('/api/calculatedField', { name: 'manual_cf', entityId: { id: host }, type: 'SIMPLE' })
    const msg = await cleanup(cfg, devIds, tb.api)
    expect(msg).toContain('Root 转发节点已摘除')
    expect(msg).toContain('站点资产已删除')
    expect(tb.chains.map(c => c.name).sort()).toEqual(['Root Rule Chain', 'Site Alarms · other'])
    expect(tb.assets.map(a => a.name)).toEqual(['other'])
    expect(tb.cfs.map(c => c.name)).toEqual(['manual_cf'])
    expect(tb.metadata[tb.chains[0]!.id.id]!.nodes).toHaveLength(1)
  })
})
