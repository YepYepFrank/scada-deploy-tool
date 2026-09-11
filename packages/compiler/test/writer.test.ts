// 写入器:用内存版 TB(mock TbApi)验证幂等与清理。不连真实 TB(live 用例在 test/live,T2.5)。
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  cleanup,
  compile,
  NULL_UUID,
  publish,
  resolveDeviceIds,
  type StepId,
  type TbApi,
  type TbsiteConfig,
} from '../src/index'

type Ent = { id: { id: string; entityType: string }; name: string; type?: string; root?: boolean; [k: string]: unknown }

/**
 * 极简 TB:设备 / 资产 / 规则链 / CF / 关系 / 属性 / 公开标记 / 节点生命周期事件,按 publisher 用到的接口实现。
 * startFailures:节点名 → 异常文本,模拟「配置字段不对导致节点 init 失败」(2026-09-08 P0-1)。
 */
function fakeTb(deviceNames: string[], startFailures: Record<string, string> = {}) {
  let seq = 0
  const uid = () => `00000000-0000-0000-0000-${String(++seq).padStart(12, '0')}`
  const devices: Ent[] = deviceNames.map(name => ({ id: { id: uid(), entityType: 'DEVICE' }, name }))
  const assets: Ent[] = []
  const chains: Ent[] = [{ id: { id: uid(), entityType: 'RULE_CHAIN' }, name: 'Root Rule Chain', root: true }]
  type Meta = {
    ruleChainId: { id: string }
    nodes: { type: string; name: string; configuration: Record<string, unknown>; id?: { id: string } }[]
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
    if ((m = p.match(/^\/api\/customer\/asset\/(.+)$/)) && method === 'DELETE') {
      const a = assets.find(x => x.id.id === m![1])
      if (!a) throw new Error(`${url} → HTTP 404`)
      // 真实 TB:本来就没分配时再取消一次会 400(2026-09-08 镜像实测),所以调用方必须先判断
      if (!a.customerId || (a.customerId as { id: string }).id === NULL_UUID)
        throw new Error(`${url} → HTTP 400 资产本来就未分配`)
      a.customerId = { id: NULL_UUID, entityType: 'CUSTOMER' }
      return a
    }
    if ((m = p.match(/^\/api\/customer\/([^/]+)\/asset\/(.+)$/)) && data) {
      // 真实 TB:占位 UUID 不是客户,分配过去会 404(2026-09-08 镜像实测,审查 R5)
      if (m[1] === NULL_UUID) throw new Error(`${url} → HTTP 404 Customer with id [${m[1]}] is not found`)
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
      // 真实 TB 保存时给每个节点分配 id,并重启这些节点的 actor(于是产生一条 LC_EVENT STARTED)
      for (const n of md.nodes) n.id ||= { id: uid() }
      metadata[md.ruleChainId.id] = md
      return md
    }
    if (p === '/api/auth/user') return { tenantId: { id: 'tenant-0' } }
    if ((m = p.match(/^\/api\/events\/RULE_NODE\/([^/]+)\/LC_EVENT$/))) {
      const node = Object.values(metadata)
        .flatMap(md => md.nodes)
        .find(n => n.id?.id === m![1])
      if (!node) return { data: [] }
      const error = startFailures[node.name]
      return { data: [{ createdTime: Date.now(), body: { event: 'STARTED', success: !error, error } }] }
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
    // 跳过的步骤一次写入都不做(自检是只读的,不计在内;它在 retry 时照跑——正好是最需要确认节点起没起来的时候)
    expect(tb.calls.slice(before).filter(c => !c.startsWith('GET '))).toEqual(['POST /api/calculatedField'])
    expect(r2.log.filter(l => /^health:(ok|err)/.test(l)).at(-1)).toMatch(/^health:ok/)
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

describe('publish · 跨设备运算的结果存到资产(2026-09-10)', () => {
  const dev = (name: string, keys: string[]) => ({ name, profile: 'IED', keys: keys.map(key => ({ key })) })
  const single = {
    template: 'expr.add',
    device: 'D1',
    output: 'pq',
    inputs: { a: { device: 'D1', key: 'P' }, b: { device: 'D1', key: 'Q' } },
  }
  const crossInputs = { a: { device: 'D1', key: 'P' }, b: { device: 'D2', key: 'P' } }
  const cfgOf = (cross: Record<string, unknown>): TbsiteConfig => ({
    schema: 'tbsite/v2',
    site: { name: 'S' },
    outputPrefix: 'calc_',
    devices: [dev('D1', ['P', 'Q']), dev('D2', ['P'])],
    computations: [single, { template: 'expr.subtract', output: 'dP', inputs: crossInputs, ...cross }],
  })
  const onAsset = cfgOf({ asset: 'S-CALC' })
  const legacy = cfgOf({ device: 'D1' }) // 旧配置:跨设备但没写 asset,宿主是第一个输入所在设备
  type CfRow = {
    name: string
    entityId: { entityType: string; id: string }
    configuration: { arguments: Record<string, { refEntityId?: { id: string } }> }
  }
  const where = (tb: ReturnType<typeof fakeTb>, devIds: Record<string, string>) =>
    (tb.cfs as unknown as CfRow[])
      .map(c => {
        const host =
          tb.assets.find(a => a.id.id === c.entityId.id)?.name ??
          Object.keys(devIds).find(k => devIds[k] === c.entityId.id)
        return `${c.name}@${host}`
      })
      .sort()

  it('单设备运算的 CF 在设备上;跨设备的在结果资产上,输入全带设备引用;资产随站点;二次发布幂等', async () => {
    const tb = fakeTb(['D1', 'D2'])
    const { devIds } = await resolveDeviceIds(tb.api, ['D1', 'D2'])
    const r = collect()
    expect(await publish(onAsset, devIds, tb.api, r.report, { layeredSettleMs: 0 })).toEqual([])
    const asset = tb.assets.find(a => a.name === 'S-CALC')!
    expect(asset.type).toBe('tbsite-agg')
    expect(where(tb, devIds)).toEqual(['calc_dP@S-CALC', 'calc_pq@D1'])
    const cf = (tb.cfs as unknown as CfRow[]).find(c => c.name === 'calc_dP')!
    expect(cf.entityId.entityType).toBe('ASSET')
    expect(cf.configuration.arguments.a!.refEntityId!.id).toBe(devIds.D1)
    expect(cf.configuration.arguments.b!.refEntityId!.id).toBe(devIds.D2)
    expect(r.log.find(l => l.startsWith('cf:ok'))).toContain('跨设备结果存到 1 个资产')
    const site = tb.assets.find(a => a.name === 'S')!
    expect(
      tb.relations.some((x: unknown) => {
        const rel = x as { from: { id: string }; to: { id: string }; type: string }
        return rel.from.id === site.id.id && rel.to.id === asset.id.id && rel.type === 'Contains'
      })
    ).toBe(true)
    const r2 = collect()
    expect(await publish(onAsset, devIds, tb.api, r2.report, { layeredSettleMs: 0 })).toEqual([])
    expect(where(tb, devIds)).toEqual(['calc_dP@S-CALC', 'calc_pq@D1'])
    expect(r2.log.find(l => l.startsWith('cf:ok'))).toContain('新建 0 · 更新 2')
    expect(tb.assets.filter(a => a.name === 'S-CALC')).toHaveLength(1)
  })

  it('旧配置照旧挂设备;改成存资产后再发布:设备上的旧 CF 被清掉,资产上建新的', async () => {
    const tb = fakeTb(['D1', 'D2'])
    const { devIds } = await resolveDeviceIds(tb.api, ['D1', 'D2'])
    expect(await publish(legacy, devIds, tb.api, () => {}, { layeredSettleMs: 0 })).toEqual([])
    expect(where(tb, devIds)).toEqual(['calc_dP@D1', 'calc_pq@D1'])
    const r = collect()
    expect(await publish(onAsset, devIds, tb.api, r.report, { layeredSettleMs: 0 })).toEqual([])
    expect(where(tb, devIds)).toEqual(['calc_dP@S-CALC', 'calc_pq@D1'])
    expect(r.log.find(l => l.startsWith('cf:ok'))).toContain('清理旧输出 1')
  })

  it('结果资产名撞上别人的资产:这一条失败、不往别人的资产上挂 CF,其余照常;重试只重跑它', async () => {
    const tb = fakeTb(['D1', 'D2'])
    tb.assets.push({ id: { id: 'colleague', entityType: 'ASSET' }, name: 'S-CALC', type: 'building' })
    const { devIds } = await resolveDeviceIds(tb.api, ['D1', 'D2'])
    const failures = await publish(onAsset, devIds, tb.api, () => {}, { layeredSettleMs: 0 })
    expect(failures).toHaveLength(1)
    expect(failures[0]).toMatchObject({ step: 'cf', device: 'S-CALC', output: 'calc_dP' })
    expect(failures[0]!.error).toContain('不是本工具建的结果资产')
    expect(where(tb, devIds)).toEqual(['calc_pq@D1'])
    // 同事把资产改名后按失败清单重试:只重跑这一条
    tb.assets.find(a => a.id.id === 'colleague')!.name = 'colleague-building'
    const r = collect()
    const again = await publish(onAsset, devIds, tb.api, r.report, {
      layeredSettleMs: 0,
      retry: { steps: ['cf'], cf: [{ device: 'S-CALC', output: 'calc_dP' }] },
    })
    expect(again).toEqual([])
    expect(where(tb, devIds)).toEqual(['calc_dP@S-CALC', 'calc_pq@D1'])
    expect(r.log.find(l => l.startsWith('cf:ok'))).toContain('重试范围 1 条')
  })

  it('cleanup 连结果资产带其上的 CF 一起删,设备上的也删', async () => {
    const tb = fakeTb(['D1', 'D2'])
    const { devIds } = await resolveDeviceIds(tb.api, ['D1', 'D2'])
    await publish(onAsset, devIds, tb.api, () => {}, { layeredSettleMs: 0 })
    const msg = await cleanup(onAsset, devIds, tb.api)
    expect(msg).toContain('计算字段 ×2')
    expect(msg).toContain('已删汇聚资产 S-CALC')
    expect(tb.cfs).toHaveLength(0)
    expect(tb.assets.map(a => a.name)).toEqual([])
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

describe('publish · 发布后自检(2026-09-08 P0-1)', () => {
  const load = async (startFailures: Record<string, string> = {}) => {
    const cfg = fixture('xrs-mirror-test.tbsite.json')
    const tb = fakeTb(
      cfg.devices.map(d => d.name),
      startFailures
    )
    const { devIds } = await resolveDeviceIds(
      tb.api,
      cfg.devices.map(d => d.name)
    )
    return { cfg, tb, devIds }
  }
  const opts = { layeredSettleMs: 0, healthWaitMs: 0 }

  it('全部节点起来了:health 步骤报节点数,发布无失败', async () => {
    const { cfg, tb, devIds } = await load()
    const r = collect()
    expect(await publish(cfg, devIds, tb.api, r.report, opts)).toEqual([])
    const line = r.log.filter(l => /^health:(ok|err)/.test(l)).at(-1)!
    expect(line).toMatch(/^health:ok \d+ 个节点已启动$/)
    // 三条站点链的节点 + Root 上我们那条转发节点都查了
    expect(Number(line.match(/(\d+)/)![1])).toBeGreaterThan(10)
  })

  it('建告警节点因配置字段名不对起不来:发布返回 health 失败,错误里带根因', async () => {
    const err =
      'org.thingsboard.rule.engine.api.TbNodeException: init failed\n' +
      '\tat org.thingsboard.server.actors.TbActorMailbox.tryInit(TbActorMailbox.java:69)\n' +
      'Caused by: com.fasterxml.jackson.databind.exc.UnrecognizedPropertyException: ' +
      'Unrecognized field "propagateRelationTypes" (class TbCreateAlarmNodeConfiguration), ' +
      'not marked as ignorable (12 known properties: "propagate", "relationTypes")'
    const { cfg, tb, devIds } = await load({ '告警: 功率越限告警': err })
    const r = collect()
    const failures = await publish(cfg, devIds, tb.api, r.report, opts)
    expect(failures).toHaveLength(1)
    expect(failures[0]!.step).toBe('health')
    expect(failures[0]!.output).toBe(`Site Alarms · ${cfg.site.name} · 告警: 功率越限告警`)
    expect(failures[0]!.error).toContain('TbCreateAlarmNode')
    expect(failures[0]!.error).toContain('propagateRelationTypes')
    expect(failures[0]!.error).toContain('"relationTypes"')
    expect(failures[0]!.error).not.toContain('TbActorMailbox') // 栈帧不带进来
    expect(r.log.filter(l => /^health:(ok|err)/.test(l)).at(-1)).toMatch(/^health:err 1 个节点没能启动/)
    // 站点配置照写:声明是真相,自检只是报告;修好编译器重发即可
    expect(r.log.find(l => l.startsWith('asset:ok'))).toBeTruthy()
  })

  it('checkHealth: false 时完全不查(离线 / 不支持事件接口的环境)', async () => {
    const { cfg, tb, devIds } = await load({ '告警: 功率越限告警': 'boom' })
    const r = collect()
    expect(await publish(cfg, devIds, tb.api, r.report, { ...opts, checkHealth: false })).toEqual([])
    expect(r.log.some(l => l.startsWith('health:'))).toBe(false)
  })

  it('事件接口报错不挡发布:记为跳过', async () => {
    const { cfg, tb, devIds } = await load()
    const api: TbApi = async (url, data, method) => {
      if (url.includes('/LC_EVENT')) throw new Error('HTTP 403 权限不足')
      return tb.api(url, data, method)
    }
    const r = collect()
    expect(await publish(cfg, devIds, api, r.report, opts)).toEqual([])
    expect(r.log.filter(l => /^health:(ok|err)/.test(l)).at(-1)).toContain('跳过')
  })
})

describe('publish · 清理声明里已删除的旧链(R1,2026-09-08)', () => {
  type Tb = ReturnType<typeof fakeTb>
  type RootNode = { name: string; configuration: Record<string, unknown> }
  const base = (computations: unknown[], extra: Record<string, unknown> = {}) =>
    ({
      schema: 'tbsite/v2',
      site: { name: 'S' },
      devices: [{ name: 'D1', profile: 'IED', keys: [{ key: 'P' }, { key: 'Q' }] }],
      computations,
      ...extra,
    }) as unknown as TbsiteConfig
  const alarm = {
    template: 'alarm.threshold',
    device: 'D1',
    name: '越限',
    key: 'P',
    condition: { op: 'gt', value: 45 },
    severity: 'WARNING',
  }
  const cascade = { template: 'window.cascade', device: 'D1', keys: ['P'], aggs: ['avg'] }
  const revenue = {
    template: 'revenue.periodic',
    charge: { device: 'D1', key: 'P' },
    discharge: { device: 'D1', key: 'Q' },
    priceAsset: 'S-price',
    asset: 'S-rev',
    output: 'rev',
  }
  const opts = { layeredSettleMs: 0, healthWaitMs: 0 }
  const setup = async (cfg: TbsiteConfig) => {
    const tb = fakeTb(['D1'])
    const { devIds } = await resolveDeviceIds(tb.api, ['D1'])
    const r = collect()
    const f0 = await publish(cfg, devIds, tb.api, r.report, opts)
    return { tb, devIds, first: f0, firstLog: r.log }
  }
  const chainNamesOf = (tb: Tb) => tb.chains.map(c => c.name).sort()
  const rootMeta = (tb: Tb) => tb.metadata[tb.chains[0]!.id.id]!
  const rootFlows = (tb: Tb) => rootMeta(tb).nodes.filter(n => n.name === 'site alarms flow · S') as RootNode[]

  it('删掉最后一条告警再发布:告警链被删、Root 转发被摘,且报告里说明了', async () => {
    const { tb, devIds, first } = await setup(base([alarm]))
    expect(first).toEqual([])
    expect(chainNamesOf(tb)).toContain('Site Alarms · S')
    expect(rootFlows(tb)).toHaveLength(1)

    const r2 = collect()
    expect(await publish(base([]), devIds, tb.api, r2.report, opts)).toEqual([])
    expect(chainNamesOf(tb)).not.toContain('Site Alarms · S')
    expect(rootFlows(tb)).toHaveLength(0)
    expect(r2.log.find(l => l.startsWith('alarm:ok'))).toBe(
      'alarm:ok 无(已删上一版的 Site Alarms · S,已摘除 Root 转发)'
    )
  })

  it('Root 上其它节点与连线不受影响(摘节点后索引重排正确)', async () => {
    const { tb, devIds } = await setup(base([alarm]))
    type Conn = { fromIndex: number; toIndex: number; type: string }
    // 在转发节点之后再挂一个别人的节点,确保摘除后连线索引不错位
    const meta = rootMeta(tb)
    meta.nodes.push({ type: 'x.TbOther', name: '同事的节点', configuration: {}, id: { id: 'other-1' } })
    ;(meta.connections as Conn[]).push({ fromIndex: 0, toIndex: meta.nodes.length - 1, type: 'Post attributes' })
    const before = (meta.connections as Conn[]).filter(c => c.type === 'Post attributes').length

    await publish(base([]), devIds, tb.api, collect().report, opts)
    const after = rootMeta(tb)
    expect(after.nodes.map(n => n.name)).toEqual(['Message Type Switch', '同事的节点'])
    const conn = (after.connections as Conn[]).filter(c => c.type === 'Post attributes')
    expect(conn).toHaveLength(before)
    expect(after.nodes[conn[0]!.toIndex]!.name).toBe('同事的节点')
  })

  it('删掉多级归档 / 收益后再发布:对应的链也被删', async () => {
    const { tb, devIds } = await setup(base([cascade, revenue]))
    expect(chainNamesOf(tb)).toEqual(expect.arrayContaining(['Site Rollups · S', 'Site Revenue · S']))

    const r2 = collect()
    expect(await publish(base([]), devIds, tb.api, r2.report, opts)).toEqual([])
    expect(chainNamesOf(tb)).toEqual(['Root Rule Chain'])
    expect(r2.log.find(l => l.startsWith('rollup:ok'))).toContain('已删上一版的 Site Rollups · S')
    expect(r2.log.find(l => l.startsWith('revenue:ok'))).toContain('已删上一版的 Site Revenue · S')
  })

  it('自定义 chainName 改回默认名:旧的自定义链被删,新链接好 Root', async () => {
    const { tb, devIds } = await setup(base([alarm], { alarm: { chainName: '自定义告警链' } }))
    expect(chainNamesOf(tb)).toContain('自定义告警链')

    const r2 = collect()
    expect(await publish(base([alarm]), devIds, tb.api, r2.report, opts)).toEqual([])
    expect(chainNamesOf(tb)).toContain('Site Alarms · S')
    expect(chainNamesOf(tb)).not.toContain('自定义告警链')
    expect(rootFlows(tb)).toHaveLength(1)
    const flow = rootFlows(tb)[0]!
    const target = tb.chains.find(c => c.name === 'Site Alarms · S')!
    expect(flow.configuration.ruleChainId).toBe(target.id.id)
  })

  it('别人的链一概不碰:同名前缀但属于其它站点的链原样保留', async () => {
    const { tb, devIds } = await setup(base([alarm]))
    await tb.api('/api/ruleChain', { name: 'Site Alarms · 别的站点', type: 'CORE' })
    await tb.api('/api/ruleChain', { name: '基站储能规则链', type: 'CORE' })

    await publish(base([]), devIds, tb.api, collect().report, opts)
    expect(chainNamesOf(tb)).toEqual(['Root Rule Chain', 'Site Alarms · 别的站点', '基站储能规则链'])
  })

  it('还有告警时不动链、不摘 Root(不制造无谓的重启)', async () => {
    const { tb, devIds } = await setup(base([alarm]))
    const chainId = tb.chains.find(c => c.name === 'Site Alarms · S')!.id.id
    const before = tb.calls.length

    const r2 = collect()
    expect(await publish(base([alarm]), devIds, tb.api, r2.report, opts)).toEqual([])
    expect(tb.chains.find(c => c.name === 'Site Alarms · S')!.id.id).toBe(chainId) // 原地更新,没重建
    expect(rootFlows(tb)).toHaveLength(1)
    expect(tb.calls.slice(before).filter(c => c.startsWith('DELETE /api/ruleChain'))).toEqual([])
    expect(r2.log.find(l => l.startsWith('alarm:ok'))).toBe('alarm:ok 1 条规则 · 转发已就位')
  })

  it('把告警加回来:链重建、Root 重新接线', async () => {
    const { tb, devIds } = await setup(base([alarm]))
    await publish(base([]), devIds, tb.api, collect().report, opts)
    expect(rootFlows(tb)).toHaveLength(0)

    const r3 = collect()
    expect(await publish(base([alarm]), devIds, tb.api, r3.report, opts)).toEqual([])
    expect(chainNamesOf(tb)).toContain('Site Alarms · S')
    expect(rootFlows(tb)).toHaveLength(1)
    expect(r3.log.find(l => l.startsWith('alarm:ok'))).toBe('alarm:ok 1 条规则 · Root 链已接线')
  })
})

describe('publish · 汇聚资产的 Customer 跟着站点走(审查 R5,2026-09-08)', () => {
  const CUST = '00000000-0000-0000-0000-0000000000aa'
  const OTHER = '00000000-0000-0000-0000-0000000000bb'
  const cfg = () =>
    ({
      schema: 'tbsite/v2',
      site: { name: 'S' },
      devices: [{ name: 'D1', profile: 'IED', keys: [{ key: 'P' }] }],
      computations: [
        {
          template: 'aggregate.crossEntity',
          name: '总功率',
          selector: { profiles: ['IED'], prefixes: [] },
          key: 'P',
          agg: 'sum',
          asset: 'S-agg',
          output: 'totalP',
        },
      ],
    }) as unknown as TbsiteConfig
  const opts = { layeredSettleMs: 0, healthWaitMs: 0 }
  const setup = async () => {
    const tb = fakeTb(['D1'])
    const { devIds } = await resolveDeviceIds(tb.api, ['D1'])
    await publish(cfg(), devIds, tb.api, collect().report, opts)
    return { tb, devIds }
  }
  const siteAsset = (tb: ReturnType<typeof fakeTb>) => tb.assets.find(a => a.name === 'S')!
  const aggAsset = (tb: ReturnType<typeof fakeTb>) => tb.assets.find(a => a.name === 'S-agg')!

  it('站点未分配 Customer:不去向占位 UUID 分配(那会 404 把 asset 步骤判失败)', async () => {
    const { tb, devIds } = await setup()
    siteAsset(tb).customerId = { id: NULL_UUID, entityType: 'CUSTOMER' }
    const r = collect()
    expect(await publish(cfg(), devIds, tb.api, r.report, opts)).toEqual([])
    expect(r.log.filter(l => l.startsWith('asset:err'))).toEqual([])
    expect(tb.calls.filter(c => c.includes(NULL_UUID))).toEqual([])
  })

  it('站点取消分配、汇聚资产还挂在原客户下:汇聚资产同步取消', async () => {
    const { tb, devIds } = await setup()
    siteAsset(tb).customerId = { id: CUST, entityType: 'CUSTOMER' }
    aggAsset(tb).customerId = { id: CUST, entityType: 'CUSTOMER' }
    siteAsset(tb).customerId = { id: NULL_UUID, entityType: 'CUSTOMER' }

    const r = collect()
    expect(await publish(cfg(), devIds, tb.api, r.report, opts)).toEqual([])
    expect(aggAsset(tb).customerId).toEqual({ id: NULL_UUID, entityType: 'CUSTOMER' })
    expect(tb.calls).toContain(`DELETE /api/customer/asset/${aggAsset(tb).id.id}`)
  })

  it('站点有 Customer:汇聚资产分配过去;换客户时跟着换;已一致则不重复分配', async () => {
    const { tb, devIds } = await setup()
    siteAsset(tb).customerId = { id: CUST, entityType: 'CUSTOMER' }
    expect(await publish(cfg(), devIds, tb.api, collect().report, opts)).toEqual([])
    expect((aggAsset(tb).customerId as { id: string }).id).toBe(CUST)

    siteAsset(tb).customerId = { id: OTHER, entityType: 'CUSTOMER' }
    expect(await publish(cfg(), devIds, tb.api, collect().report, opts)).toEqual([])
    expect((aggAsset(tb).customerId as { id: string }).id).toBe(OTHER)

    const before = tb.calls.filter(c => c.includes('/api/customer/')).length
    expect(await publish(cfg(), devIds, tb.api, collect().report, opts)).toEqual([])
    expect(tb.calls.filter(c => c.includes('/api/customer/')).length).toBe(before)
  })
})
