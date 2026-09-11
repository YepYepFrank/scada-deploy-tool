// 写入器:用内存版 TB(mock TbApi)验证幂等与清理。不连真实 TB(live 用例在 test/live,T2.5)。
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  cleanup,
  compile,
  ensureResultAssets,
  handBackCf,
  NULL_UUID,
  publish,
  readPlatformState,
  resolveDeviceIds,
  type Computation,
  type StepId,
  type TbApi,
  type TbCf,
  type TbsiteConfig,
} from '../src/index'

type Ent = { id: { id: string; entityType: string }; name: string; type?: string; root?: boolean; [k: string]: unknown }

/**
 * 极简 TB:设备 / 资产 / 规则链 / CF / 关系 / 属性 / 公开标记 / 节点生命周期事件,按 publisher 用到的接口实现。
 * startFailures:节点名 → 异常文本,模拟「配置字段不对导致节点 init 失败」(2026-09-08 P0-1)。
 */
function fakeTb(
  deviceNames: string[],
  startFailures: Record<string, string> = {},
  /** gaochaoWires:模拟高潮——站点告警链一出现,他就在 Root 上手工接一个转发节点(默认关) */
  { gaochaoWires = false }: { gaochaoWires?: boolean } = {}
) {
  /** 工具写了几次 Root(2026-09-11:只该在接线 / 摘线时写,且只动本站点自己的节点) */
  const stats = { rootWrites: 0 }
  let seq = 0
  const uid = () => `00000000-0000-0000-0000-${String(++seq).padStart(12, '0')}`
  const devices: Ent[] = deviceNames.map(name => ({ id: { id: uid(), entityType: 'DEVICE' }, name }))
  const assets: Ent[] = []
  const chains: Ent[] = [{ id: { id: uid(), entityType: 'RULE_CHAIN' }, name: 'Root Rule Chain', root: true }]
  type Meta = {
    ruleChainId: { id: string }
    nodes: {
      type: string
      name: string
      configuration: Record<string, unknown>
      id?: { id: string }
      additionalInfo?: Record<string, unknown> | null
    }[]
    connections: unknown[]
    firstNodeIndex: number | null
  }
  const rootId = chains[0]!.id.id
  const metadata: Record<string, Meta> = {
    [rootId]: {
      ruleChainId: { id: rootId },
      nodes: [
        {
          id: { id: 'root-switch' }, // 真实 TB 读回的节点都带 id;写 Root 前的「别人部分」核对按 id 认节点
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
    if ((m = p.match(/^\/api\/ruleChain\/(.+)\/metadata$/))) {
      const md = metadata[m[1]!]
      return md ? JSON.parse(JSON.stringify(md)) : md // 真实 TB 返回的是副本
    }
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
      if (md.ruleChainId.id === rootId) stats.rootWrites++ // Root 由高潮维护:工具只该在接线 / 摘线时走到这里
      // 真实 TB 保存时给每个节点分配 id,并重启这些节点的 actor(于是产生一条 LC_EVENT STARTED)
      for (const n of md.nodes) n.id ||= { id: uid() }
      metadata[md.ruleChainId.id] = md
      // 模拟高潮:站点告警链一出现,他就在 Root 上接好转发节点(直接改内存,不经过工具的 api)
      const root = metadata[rootId]!
      if (
        gaochaoWires &&
        md.nodes.some(n => n.type.endsWith('TbCreateAlarmNode')) &&
        !root.nodes.some(n => n.configuration.ruleChainId === md.ruleChainId.id)
      )
        root.nodes.push({
          type: 'org.thingsboard.rule.engine.flow.TbRuleChainInputNode',
          name: `高潮接的转发 · ${md.ruleChainId.id}`,
          configuration: { ruleChainId: md.ruleChainId.id },
        })
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
  return { api, devices, assets, chains, metadata, cfs, relations, attrs, publicIds, calls, stats }
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
    // Root 上接了本站点自己的转发节点(带归属标记),Root 只写了这一次
    expect(tb.stats.rootWrites).toBe(1)
    const root = tb.metadata[tb.chains[0]!.id.id]!
    expect(root.nodes.map(n => n.name)).toEqual(['Message Type Switch', `site alarms flow · ${cfg.site.name}`])
    expect(root.nodes[1]!.additionalInfo).toMatchObject({ managedBy: 'deploy-tool', site: cfg.site.name })
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

describe('第 3 步建结果资产 · 归属标记 · 接管 / 交还 · 同步(2026-09-11)', () => {
  const dev = (name: string, keys: string[]) => ({ name, profile: 'IED', keys: keys.map(key => ({ key })) })
  const OWNER_S = { managedBy: 'deploy-tool', site: 'S' }
  const cross = {
    template: 'expr.subtract',
    asset: 'S-CALC',
    output: 'dP',
    inputs: { a: { device: 'D1', key: 'P' }, b: { device: 'D2', key: 'P' } },
  }
  const pq = {
    template: 'expr.add',
    device: 'D1',
    output: 'pq',
    inputs: { a: { device: 'D1', key: 'P' }, b: { device: 'D1', key: 'Q' } },
  }
  const aggC = {
    template: 'aggregate.crossEntity',
    name: 'ΣP',
    selector: { profiles: ['IED'] },
    key: 'P',
    agg: 'sum',
    asset: 'S-agg',
    output: 'totalP',
  }
  const cfgOf = (computations: unknown[]) =>
    ({
      schema: 'tbsite/v2',
      site: { name: 'S' },
      outputPrefix: 'calc_',
      devices: [dev('D1', ['P', 'Q']), dev('D2', ['P'])],
      computations,
    }) as unknown as TbsiteConfig
  const setup = async () => {
    const tb = fakeTb(['D1', 'D2'])
    const { devIds } = await resolveDeviceIds(tb.api, ['D1', 'D2'])
    return { tb, devIds }
  }
  type Row = TbCf & {
    entityId: { id: string }
    configuration?: { expression?: string; output?: { name?: string } }
  }
  const rows = (tb: ReturnType<typeof fakeTb>) => tb.cfs as unknown as Row[]
  const contains = (tb: ReturnType<typeof fakeTb>, from: string, to: string) =>
    tb.relations.some((x: unknown) => {
      const r = x as { from: { id: string }; to: { id: string }; type: string }
      return r.from.id === from && r.to.id === to && r.type === 'Contains'
    })
  const colleagueCf = (devIds: Record<string, string>, assetId: string) => ({
    name: '实时曲线-总功率',
    type: 'SIMPLE',
    entityId: { entityType: 'ASSET', id: assetId },
    configuration: {
      type: 'SIMPLE',
      expression: 'P1+P2',
      arguments: {
        P1: { refEntityId: { entityType: 'DEVICE', id: devIds.D1 }, refEntityKey: { type: 'TS_LATEST', key: 'P' } },
        P2: { refEntityId: { entityType: 'DEVICE', id: devIds.D2 }, refEntityKey: { type: 'TS_LATEST', key: 'P' } },
      },
      output: { type: 'TIME_SERIES', name: 'tsTotal' },
    },
  })

  it('ensureResultAssets:只建资产 + 站点资产 + 关系,不写计算字段、不碰规则链;同名的别人的资产记冲突、不借用', async () => {
    const { tb, devIds } = await setup()
    tb.assets.push({ id: { id: 'colleague', entityType: 'ASSET' }, name: 'S-agg', type: 'building' })
    const r = await ensureResultAssets(cfgOf([cross, aggC]), devIds, tb.api)
    expect(r.created).toEqual(['S-CALC'])
    expect(r.conflicts).toEqual([{ name: 'S-agg', type: 'building' }])
    expect(tb.cfs).toHaveLength(0)
    expect(tb.calls.some(c => c.includes('/api/ruleChain'))).toBe(false)
    const calc = tb.assets.find(a => a.name === 'S-CALC')!
    expect(calc).toMatchObject({ type: 'tbsite-agg', additionalInfo: OWNER_S })
    const site = tb.assets.find(a => a.name === 'S')!
    expect(site).toMatchObject({ type: 'tbsite', additionalInfo: OWNER_S })
    expect(contains(tb, site.id.id, calc.id.id)).toBe(true)
    expect(contains(tb, site.id.id, 'colleague')).toBe(false)
    expect(r.followed).toBe(1)
    const again = await ensureResultAssets(cfgOf([cross]), devIds, tb.api)
    expect(again).toMatchObject({ created: [], existing: ['S-CALC'], conflicts: [] })
    expect(tb.assets.filter(a => a.name === 'S-CALC')).toHaveLength(1)
  })

  it('发布:计算字段带归属标记、更新时带 version;清理只删本站点标记 / 上一版声明的,别人的与别的站点的不碰', async () => {
    const { tb, devIds } = await setup()
    const d1 = { entityType: 'DEVICE', id: devIds.D1! }
    await tb.api('/api/calculatedField', { name: '总电压', entityId: d1, type: 'SIMPLE' })
    await tb.api('/api/calculatedField', { name: 'calc_old', entityId: d1, type: 'SIMPLE', additionalInfo: OWNER_S })
    await tb.api('/api/calculatedField', {
      name: 'calc_x',
      entityId: d1,
      type: 'SIMPLE',
      additionalInfo: { managedBy: 'deploy-tool', site: 'T' },
    })
    const r = collect()
    expect(await publish(cfgOf([pq, cross]), devIds, tb.api, r.report, { layeredSettleMs: 0 })).toEqual([])
    expect(
      rows(tb)
        .map(c => c.name)
        .sort()
    ).toEqual(['calc_dP', 'calc_pq', 'calc_x', '总电压'])
    expect(r.log.find(l => l.startsWith('cf:ok'))).toContain('清理旧输出 1')
    expect(rows(tb).find(c => c.name === 'calc_pq')!.additionalInfo).toMatchObject(OWNER_S)
    expect(rows(tb).find(c => c.name === 'calc_dP')!.additionalInfo).toMatchObject(OWNER_S)
    // 再发布:更新时把 TB 读回的 version 带上(乐观锁)
    rows(tb).find(c => c.name === 'calc_pq')!.version = 7
    const sent: Record<string, unknown>[] = []
    const spy: TbApi = async (url, data, method) => {
      if (url === '/api/calculatedField' && data) sent.push(data as Record<string, unknown>)
      return tb.api(url, data, method)
    }
    expect(await publish(cfgOf([pq, cross]), devIds, spy, () => {}, { layeredSettleMs: 0 })).toEqual([])
    expect(sent.find(b => b.name === 'calc_pq')!.version).toBe(7)
  })

  it('版本冲突(409):这一条失败并说人话,不重试、不覆盖', async () => {
    const { tb, devIds } = await setup()
    await publish(cfgOf([pq]), devIds, tb.api, () => {}, { layeredSettleMs: 0 })
    const api: TbApi = async (url, data, method) => {
      if (url === '/api/calculatedField' && data) throw new Error('/api/calculatedField → HTTP 409 version mismatch')
      return tb.api(url, data, method)
    }
    const failures = await publish(cfgOf([pq]), devIds, api, () => {}, { layeredSettleMs: 0 })
    expect(failures).toHaveLength(1)
    expect(failures[0]!.error).toContain('计算字段「calc_pq」刚被别人改过(版本冲突)')
    expect(failures[0]!.error).toContain('没有覆盖对方的修改')
  })

  it('接管:同步里列为可接管 → 发布后原地更新原字段(原名、原输出、原资产),打标记;同事的资产不挪不改归属', async () => {
    const { tb, devIds } = await setup()
    tb.assets.push({ id: { id: 'col', entityType: 'ASSET' }, name: 'REALTIME_TOTAL', type: 'REALTIME' })
    await tb.api('/api/calculatedField', colleagueCf(devIds, 'col'))
    const st = await readPlatformState(tb.api, cfgOf([]), devIds)
    const row = st.cfs.find(x => x.cf.name === '实时曲线-总功率')!
    expect(row).toMatchObject({ owner: 'foreign', entity: 'REALTIME_TOTAL' })
    expect(row.adopt!.ok).toBe(true)
    const adopted = (row.adopt as { computation: Computation }).computation

    const r = collect()
    expect(await publish(cfgOf([adopted]), devIds, tb.api, r.report, { layeredSettleMs: 0 })).toEqual([])
    const onCol = rows(tb).filter(c => c.entityId.id === 'col')
    expect(onCol.map(c => c.name)).toEqual(['实时曲线-总功率']) // 原地更新,没多建
    expect(onCol[0]!.configuration!.output!.name).toBe('tsTotal') // 不加 calc_ 前缀
    expect(onCol[0]!.additionalInfo).toMatchObject(OWNER_S)
    expect(tb.assets.find(a => a.id.id === 'col')).toMatchObject({ type: 'REALTIME' })
    const site = tb.assets.find(a => a.name === 'S')!
    expect(contains(tb, site.id.id, 'col')).toBe(false)

    const st2 = await readPlatformState(tb.api, cfgOf([adopted]), devIds)
    expect(st2.cfs.find(x => x.cf.name === '实时曲线-总功率')).toMatchObject({
      owner: 'mine',
      drift: 'same',
      adopted: true,
    })
  })

  it('交还:去掉标记、字段留着;之后发布(声明里已没有)与 cleanup 都不删它', async () => {
    const { tb, devIds } = await setup()
    tb.assets.push({ id: { id: 'col', entityType: 'ASSET' }, name: 'REALTIME_TOTAL', type: 'REALTIME' })
    await tb.api('/api/calculatedField', colleagueCf(devIds, 'col'))
    const st = await readPlatformState(tb.api, cfgOf([]), devIds)
    const adopted = (st.cfs[0]!.adopt as { computation: Computation }).computation
    await publish(cfgOf([adopted]), devIds, tb.api, () => {}, { layeredSettleMs: 0 })

    const f = rows(tb).find(c => c.name === '实时曲线-总功率')!
    expect(await handBackCf(tb.api, f)).toBe(true)
    expect(rows(tb).find(c => c.name === '实时曲线-总功率')!.additionalInfo).toBeNull()
    expect(
      await handBackCf(
        tb.api,
        rows(tb).find(c => c.name === '实时曲线-总功率')!
      )
    ).toBe(false) // 没标记就不写

    expect(await publish(cfgOf([]), devIds, tb.api, () => {}, { layeredSettleMs: 0 })).toEqual([])
    expect(rows(tb).map(c => c.name)).toEqual(['实时曲线-总功率'])
  })

  it('cleanup:接管来的交还(去标记)不删、本工具建的删;同事的资产留着', async () => {
    const { tb, devIds } = await setup()
    tb.assets.push({ id: { id: 'col', entityType: 'ASSET' }, name: 'REALTIME_TOTAL', type: 'REALTIME' })
    await tb.api('/api/calculatedField', colleagueCf(devIds, 'col'))
    const st = await readPlatformState(tb.api, cfgOf([]), devIds)
    const cfg = cfgOf([(st.cfs[0]!.adopt as { computation: Computation }).computation, pq])
    await publish(cfg, devIds, tb.api, () => {}, { layeredSettleMs: 0 })
    const msg = await cleanup(cfg, devIds, tb.api)
    expect(msg).toContain('计算字段 ×1')
    expect(msg).toContain('交还接管的 1 个')
    expect(rows(tb).map(c => [c.name, c.additionalInfo ?? null])).toEqual([['实时曲线-总功率', null]])
    expect(tb.assets.map(a => a.name)).toEqual(['REALTIME_TOTAL'])
  })

  it('规则链:TB 读回时补了默认字段、去掉了 null 字段,仍判为没变不重写;真改了才写(2026-09-11 镜像实测的两种差异)', async () => {
    const { tb, devIds } = await setup()
    const roll = { template: 'window.aggregate', device: 'D1', keys: ['P'], aggs: ['avg'], window: '5m' }
    const opts = { layeredSettleMs: 0, healthWaitMs: 0 }
    await publish(cfgOf([roll]), devIds, tb.api, () => {}, opts)
    const chain = tb.chains.find(c => c.name === 'Site Rollups · S')!
    for (const n of tb.metadata[chain.id.id]!.nodes) {
      if (n.type.endsWith('TbMsgTimeseriesNode')) n.configuration.processingSettings = { type: 'ON_EVERY_MESSAGE' }
      for (const [k, v] of Object.entries(n.configuration)) if (v === null) delete n.configuration[k]
    }
    const before = tb.calls.length
    const r = collect()
    expect(await publish(cfgOf([roll]), devIds, tb.api, r.report, opts)).toEqual([])
    expect(tb.calls.slice(before).filter(c => c === 'POST /api/ruleChain/metadata')).toEqual([])
    expect(r.log.find(l => l.startsWith('rollup:ok'))).toContain('(未变,未重写)')
    const r2 = collect()
    expect(await publish(cfgOf([{ ...roll, window: '15m' }]), devIds, tb.api, r2.report, opts)).toEqual([])
    expect(r2.log.find(l => l.startsWith('rollup:ok'))).not.toContain('未变')
  })

  it('同步:平台上被改过 / 还没有 / 别的站点 / 遗留 各归各类;占用名额含别人的;规则链只读列出', async () => {
    const { tb, devIds } = await setup()
    await publish(cfgOf([pq]), devIds, tb.api, () => {}, { layeredSettleMs: 0 })
    const d1 = { entityType: 'DEVICE', id: devIds.D1! }
    // 有人在 TB 界面里改了本工具的字段
    const mine = rows(tb).find(c => c.name === 'calc_pq')!
    ;(mine.configuration as { expression: string }).expression = 'a * b'
    await tb.api('/api/calculatedField', {
      name: 'calc_x',
      entityId: d1,
      type: 'SIMPLE',
      additionalInfo: { managedBy: 'deploy-tool', site: 'T' },
    })
    await tb.api('/api/calculatedField', { name: 'calc_gone', entityId: d1, type: 'SIMPLE', additionalInfo: OWNER_S })
    await tb.api('/api/calculatedField', {
      name: '总电压',
      entityId: d1,
      type: 'SIMPLE',
      configuration: {
        expression: 'a + b',
        arguments: {
          a: { refEntityKey: { type: 'TS_LATEST', key: 'Ua' } },
          b: { refEntityKey: { type: 'TS_LATEST', key: 'Uc' } },
        },
        output: { type: 'TIME_SERIES', name: '总电压' },
      },
    })
    const st = await readPlatformState(tb.api, cfgOf([pq, cross]), devIds)
    const by = (n: string) => st.cfs.find(x => x.cf.name === n)!
    // 平台上被人改过(发布时记下的指纹与现在对不上)→ 冲突,附逐项差异
    expect(by('calc_pq')).toMatchObject({ owner: 'mine', drift: 'conflict' })
    expect(by('calc_pq').diff).toEqual([{ item: '表达式', tool: 'a + b', platform: 'a * b' }])
    expect(by('calc_gone')).toMatchObject({ owner: 'mine', drift: 'orphan' })
    expect(by('calc_x')).toMatchObject({ owner: 'otherSite', site: 'T' })
    expect(by('总电压')).toMatchObject({ owner: 'foreign' })
    expect(by('总电压').adopt).toMatchObject({ ok: true })
    expect(st.missing).toEqual([{ entityType: 'ASSET', entity: 'S-CALC', name: 'calc_dP' }])
    expect(st.occupied['DEVICE|D1']).toBe(4)
    expect(st.chains.map(c => [c.name, c.root, c.mine])).toEqual([['Root Rule Chain', true, false]])
  })
})

describe('写入指纹与冲突(2026-09-11)', () => {
  const dev = (name: string, keys: string[]) => ({ name, profile: 'IED', keys: keys.map(key => ({ key })) })
  const pq = {
    template: 'expr.add',
    device: 'D1',
    output: 'pq',
    inputs: { a: { device: 'D1', key: 'P' }, b: { device: 'D1', key: 'Q' } },
  }
  const roll = { template: 'window.aggregate', device: 'D1', keys: ['P'], aggs: ['avg'], window: '5m' }
  const cfgOf = (computations: unknown[]) =>
    ({
      schema: 'tbsite/v2',
      site: { name: 'S' },
      outputPrefix: 'calc_',
      devices: [dev('D1', ['P', 'Q'])],
      computations,
    }) as unknown as TbsiteConfig
  const opts = { layeredSettleMs: 0, healthWaitMs: 0 }
  const setup = async (computations: unknown[]) => {
    const tb = fakeTb(['D1'])
    const { devIds } = await resolveDeviceIds(tb.api, ['D1'])
    expect(await publish(cfgOf(computations), devIds, tb.api, () => {}, opts)).toEqual([])
    return { tb, devIds }
  }
  const cfRow = (tb: ReturnType<typeof fakeTb>, name: string) =>
    (tb.cfs as unknown as (TbCf & { configuration: { expression: string } })[]).find(c => c.name === name)!
  const pqRow = (st: Awaited<ReturnType<typeof readPlatformState>>) => st.cfs.find(x => x.cf.name === 'calc_pq')!

  it('发布:计算字段标记里带写入指纹;站点资产上记下本站点规则链的指纹', async () => {
    const { tb } = await setup([pq, roll])
    expect(cfRow(tb, 'calc_pq').additionalInfo).toMatchObject({
      managedBy: 'deploy-tool',
      site: 'S',
      print: expect.stringMatching(/^[0-9a-f]{8}$/),
    })
    const site = tb.assets.find(a => a.name === 'S')!
    expect(Object.keys(tb.attrs[site.id.id]!.deployPrints as object)).toEqual(['Site Rollups · S'])
  })

  it('三方比对:向导改了、平台没动 → 待发布;平台上被人改了 → 冲突;两边都改 → 冲突且标明向导也改了', async () => {
    const { tb, devIds } = await setup([pq])
    const edited = { ...pq, template: 'expr.subtract' } // 向导里把 a + b 改成 a - b,还没发布
    let st = await readPlatformState(tb.api, cfgOf([edited]), devIds)
    expect(pqRow(st)).toMatchObject({ owner: 'mine', drift: 'pending' })
    expect(pqRow(st).diff).toEqual([{ item: '表达式', tool: 'a - b', platform: 'a + b' }])

    cfRow(tb, 'calc_pq').configuration.expression = 'a * b' // 有人在 TB 里改了
    st = await readPlatformState(tb.api, cfgOf([pq]), devIds)
    expect(pqRow(st)).toMatchObject({ drift: 'conflict' })
    expect(pqRow(st).localToo).toBeUndefined()
    expect(pqRow(st).diff).toEqual([{ item: '表达式', tool: 'a + b', platform: 'a * b' }])

    st = await readPlatformState(tb.api, cfgOf([edited]), devIds)
    expect(pqRow(st)).toMatchObject({ drift: 'conflict', localToo: true })

    // 再发布一次(以向导为准)→ 指纹更新,回到一致
    expect(await publish(cfgOf([pq]), devIds, tb.api, () => {}, opts)).toEqual([])
    expect(pqRow(await readPlatformState(tb.api, cfgOf([pq]), devIds))).toMatchObject({ drift: 'same' })
  })

  it('旧对象没有写入指纹:和向导一样算一致;不一样标「不一致」(分不清是谁改的)', async () => {
    const { tb, devIds } = await setup([pq])
    delete (cfRow(tb, 'calc_pq').additionalInfo as Record<string, unknown>).print
    expect(pqRow(await readPlatformState(tb.api, cfgOf([pq]), devIds))).toMatchObject({ drift: 'same' })
    cfRow(tb, 'calc_pq').configuration.expression = 'a * b'
    expect(pqRow(await readPlatformState(tb.api, cfgOf([pq]), devIds))).toMatchObject({ drift: 'mismatch' })
  })

  it('规则链:向导改了周期 → 待发布;平台上被人改了节点配置 → 冲突,差异精确到节点的配置字段', async () => {
    const { tb, devIds } = await setup([roll])
    const chainName = 'Site Rollups · S'
    const row = (st: Awaited<ReturnType<typeof readPlatformState>>) => st.chains.find(c => c.name === chainName)!
    expect(row(await readPlatformState(tb.api, cfgOf([roll]), devIds))).toMatchObject({ mine: true, drift: 'same' })

    const pend = row(await readPlatformState(tb.api, cfgOf([{ ...roll, window: '15m' }]), devIds))
    expect(pend.drift).toBe('pending')
    expect(pend.diff!.length).toBeGreaterThan(0)

    const chain = tb.chains.find(c => c.name === chainName)!
    const gen = tb.metadata[chain.id.id]!.nodes.find(n => n.type.endsWith('TbMsgGeneratorNode'))!
    gen.configuration.periodInSeconds = 60 // 有人在 TB 里把定时周期改了
    const hit = row(await readPlatformState(tb.api, cfgOf([roll]), devIds))
    expect(hit.drift).toBe('conflict')
    expect(hit.diff).toEqual([{ item: `节点「${gen.name}」· periodInSeconds`, tool: 300, platform: 60 }])
  })

  it('冲突的处理:待定(skip)与以 TB 为准(keepPlatform)发布时都不覆盖;以本工具为准照常覆盖', async () => {
    const { tb, devIds } = await setup([pq, roll])
    const chainName = 'Site Rollups · S'
    const chain = tb.chains.find(c => c.name === chainName)!
    const period = () =>
      tb.metadata[chain.id.id]!.nodes.find(n => n.type.endsWith('TbMsgGeneratorNode'))!.configuration.periodInSeconds
    // 有人在 TB 里改了计算字段和统计链
    cfRow(tb, 'calc_pq').configuration.expression = 'a * b'
    tb.metadata[chain.id.id]!.nodes.find(n => n.type.endsWith('TbMsgGeneratorNode'))!.configuration.periodInSeconds = 60
    let st = await readPlatformState(tb.api, cfgOf([pq, roll]), devIds)
    const cfKey = pqRow(st).key
    const chKey = st.chains.find(c => c.name === chainName)!.key
    expect([cfKey, chKey]).toEqual(['cf:DEVICE|D1|calc_pq', 'chain:Site Rollups · S'])

    // 待定:这次发布跳过两处;链的指纹沿用旧的 → 下次同步仍是冲突
    const detail: Record<string, string> = {}
    const rec = (id: string, s: string, d?: string) => {
      if (s !== 'run') detail[id] = d ?? ''
    }
    expect(await publish(cfgOf([pq, roll]), devIds, tb.api, rec, { ...opts, skip: [cfKey, chKey] })).toEqual([])
    expect(cfRow(tb, 'calc_pq').configuration.expression).toBe('a * b')
    expect(period()).toBe(60)
    expect(detail.cf).toContain('保留平台版本 1')
    expect(detail.rollup).toContain('保留平台上的版本')
    st = await readPlatformState(tb.api, cfgOf([pq, roll]), devIds)
    expect(pqRow(st).drift).toBe('conflict')
    expect(st.chains.find(c => c.name === chainName)!.drift).toBe('conflict')

    // 以 TB 为准(记进配置 keepPlatform):链照样不覆盖;没保留的计算字段照常按向导写
    const pinned = { ...cfgOf([pq, roll]), keepPlatform: [chKey] } as TbsiteConfig
    expect(await publish(pinned, devIds, tb.api, () => {}, opts)).toEqual([])
    expect(period()).toBe(60)
    expect(cfRow(tb, 'calc_pq').configuration.expression).toBe('a + b')

    // 以本工具为准:不跳过 → 覆盖,回到一致
    expect(await publish(cfgOf([pq, roll]), devIds, tb.api, () => {}, opts)).toEqual([])
    expect(period()).toBe(300)
    st = await readPlatformState(tb.api, cfgOf([pq, roll]), devIds)
    expect(st.chains.find(c => c.name === chainName)!.drift).toBe('same')
    expect(pqRow(st).drift).toBe('same')
  })
})

describe('cleanup', () => {
  it('删掉本站点的 CF / 规则链 / Root 上本站点的转发节点 / 汇聚资产 / 站点资产,不碰存量', async () => {
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
    expect(msg).toContain('Root 上本站点的转发节点已摘除')
    expect(msg).toContain('站点资产已删除')
    expect(tb.chains.map(c => c.name).sort()).toEqual(['Root Rule Chain', 'Site Alarms · other'])
    expect(tb.assets.map(a => a.name)).toEqual(['other'])
    expect(tb.cfs.map(c => c.name)).toEqual(['manual_cf'])
    expect(tb.metadata[tb.chains[0]!.id.id]!.nodes.map(n => n.name)).toEqual(['Message Type Switch'])
    expect(tb.stats.rootWrites).toBe(2) // 发布时接一次、清理时摘一次
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
  const chainId = (tb: Tb, name: string) => tb.chains.find(c => c.name === name)!.id.id
  type Conn = { fromIndex: number; toIndex: number; type: string }
  /** Root 上本站点自己的转发节点 */
  const ownFlows = (tb: Tb) => rootMeta(tb).nodes.filter(n => n.name === 'site alarms flow · S') as RootNode[]
  /** Root 上除本站点自己节点以外的部分(节点原样 + 连线按节点 id),核对「别人的部分一字不差」 */
  const othersOf = (tb: Tb) => {
    const m = rootMeta(tb)
    const own = (i: number) => m.nodes[i]!.name === 'site alarms flow · S'
    return JSON.stringify({
      nodes: m.nodes.filter((_, i) => !own(i)),
      conns: (m.connections as Conn[])
        .filter(c => !own(c.fromIndex) && !own(c.toIndex))
        .map(c => `${m.nodes[c.fromIndex]!.id?.id}>${m.nodes[c.toIndex]!.id?.id}:${c.type}`)
        .sort(),
    })
  }
  /** 高潮在 Root 上配的东西:一个定时器连一个 REST 节点,Switch 也连到定时器 */
  const addColleagueNodes = (tb: Tb) => {
    const m = rootMeta(tb)
    m.nodes.push(
      {
        id: { id: 'gc-gen' },
        type: 'org.thingsboard.rule.engine.debug.TbMsgGeneratorNode',
        name: '按天归档数据',
        configuration: { periodInSeconds: 86400 },
      },
      {
        id: { id: 'gc-rest' },
        type: 'org.thingsboard.rule.engine.rest.TbRestApiCallNode',
        name: '按天归档',
        configuration: { restEndpointUrlPattern: 'http://localhost:8099/rulestaticsapi/day' },
      }
    )
    ;(m.connections as Conn[]).push(
      { fromIndex: m.nodes.length - 2, toIndex: m.nodes.length - 1, type: 'Success' },
      { fromIndex: 0, toIndex: m.nodes.length - 2, type: 'Other' }
    )
  }

  it('首次有告警:Root 上接一个本站点的转发节点(带标记);高潮配的节点、连线一字不差;只写一次 Root', async () => {
    const tb = fakeTb(['D1'])
    addColleagueNodes(tb)
    const before = othersOf(tb)
    const { devIds } = await resolveDeviceIds(tb.api, ['D1'])
    const r = collect()
    expect(await publish(base([alarm]), devIds, tb.api, r.report, opts)).toEqual([])
    expect(ownFlows(tb)).toHaveLength(1)
    expect(ownFlows(tb)[0]!.configuration.ruleChainId).toBe(chainId(tb, 'Site Alarms · S'))
    expect((ownFlows(tb)[0] as { additionalInfo?: unknown }).additionalInfo).toMatchObject({
      managedBy: 'deploy-tool',
      site: 'S',
    })
    expect(othersOf(tb)).toBe(before)
    expect(tb.stats.rootWrites).toBe(1)
    expect(r.log.find(l => l.startsWith('alarm:ok'))).toBe('alarm:ok 1 条规则 · Root 链已接线')
  })

  it('删掉最后一条告警再发布:只摘本站点自己的节点和连到它的线,高潮的节点与连线一字不差(索引重排正确);告警链删掉', async () => {
    const tb = fakeTb(['D1'])
    const { devIds } = await resolveDeviceIds(tb.api, ['D1'])
    await publish(base([alarm]), devIds, tb.api, collect().report, opts)
    addColleagueNodes(tb) // 在我们的节点之后再挂别人的,确保摘除后连线索引重排正确
    const before = othersOf(tb)

    const r2 = collect()
    expect(await publish(base([]), devIds, tb.api, r2.report, opts)).toEqual([])
    expect(ownFlows(tb)).toHaveLength(0)
    expect(othersOf(tb)).toBe(before)
    expect(rootMeta(tb).nodes.map(n => n.name)).toEqual(['Message Type Switch', '按天归档数据', '按天归档'])
    expect(chainNamesOf(tb)).not.toContain('Site Alarms · S')
    expect(r2.log.find(l => l.startsWith('alarm:ok'))).toBe(
      'alarm:ok 无(已删上一版的 Site Alarms · S,已摘除 Root 上本站点的转发节点)'
    )
    expect(tb.stats.rootWrites).toBe(2)
  })

  it('Root 上已有别人接的节点转发到本站点告警链(比如高潮手工接的):不再加自己的,也不写 Root', async () => {
    const tb = fakeTb(['D1'], {}, { gaochaoWires: true })
    const { devIds } = await resolveDeviceIds(tb.api, ['D1'])
    const r = collect()
    expect(await publish(base([alarm]), devIds, tb.api, r.report, opts)).toEqual([])
    expect(ownFlows(tb)).toHaveLength(0)
    expect(tb.stats.rootWrites).toBe(0)
    expect(r.log.find(l => l.startsWith('alarm:ok'))).toBe('alarm:ok 1 条规则 · 转发已就位')
  })

  it('删告警时 Root 上还有别人的节点转发到它:别人的节点不摘,告警链只清空不删', async () => {
    const tb = fakeTb(['D1'], {}, { gaochaoWires: true })
    const { devIds } = await resolveDeviceIds(tb.api, ['D1'])
    await publish(base([alarm]), devIds, tb.api, collect().report, opts)
    const r2 = collect()
    expect(await publish(base([]), devIds, tb.api, r2.report, opts)).toEqual([])
    expect(chainNamesOf(tb)).toContain('Site Alarms · S')
    expect(tb.metadata[chainId(tb, 'Site Alarms · S')]!.nodes).toEqual([])
    expect(r2.log.find(l => l.startsWith('alarm:ok'))).toBe(
      'alarm:ok 无(Site Alarms · S 已清空未删:Root 上还有别人的节点转发到它)'
    )
    expect(tb.stats.rootWrites).toBe(0)
  })

  it('Root 被别人刚改过(409):告警步骤报冲突、不覆盖,Root 上什么也没多', async () => {
    const tb = fakeTb(['D1'])
    const { devIds } = await resolveDeviceIds(tb.api, ['D1'])
    const rootId = tb.chains[0]!.id.id
    const api: TbApi = async (url, data, method) => {
      if (url === '/api/ruleChain/metadata' && (data as { ruleChainId: { id: string } }).ruleChainId.id === rootId)
        throw new Error('/api/ruleChain/metadata → HTTP 409 version mismatch')
      return tb.api(url, data, method)
    }
    const failures = await publish(base([alarm]), devIds, api, collect().report, opts)
    expect(failures.map(f => f.step)).toEqual(['alarm'])
    expect(failures[0]!.error).toContain('Root 规则链刚被别人改过(版本冲突)')
    expect(ownFlows(tb)).toHaveLength(0)
    expect(tb.stats.rootWrites).toBe(0)
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

  it('自定义 chainName 改回默认名:旧的自定义链被删,本站点的转发节点指向新链', async () => {
    const { tb, devIds } = await setup(base([alarm], { alarm: { chainName: '自定义告警链' } }))
    expect(chainNamesOf(tb)).toContain('自定义告警链')

    const r2 = collect()
    expect(await publish(base([alarm]), devIds, tb.api, r2.report, opts)).toEqual([])
    expect(chainNamesOf(tb)).toContain('Site Alarms · S')
    expect(chainNamesOf(tb)).not.toContain('自定义告警链')
    expect(ownFlows(tb)).toHaveLength(1)
    expect(ownFlows(tb)[0]!.configuration.ruleChainId).toBe(chainId(tb, 'Site Alarms · S'))
  })

  it('别人的链一概不碰:同名前缀但属于其它站点的链原样保留', async () => {
    const { tb, devIds } = await setup(base([alarm]))
    await tb.api('/api/ruleChain', { name: 'Site Alarms · 别的站点', type: 'CORE' })
    await tb.api('/api/ruleChain', { name: '基站储能规则链', type: 'CORE' })

    await publish(base([]), devIds, tb.api, collect().report, opts)
    expect(chainNamesOf(tb)).toEqual(['Root Rule Chain', 'Site Alarms · 别的站点', '基站储能规则链'])
  })

  it('还有告警时不动链、不写 Root(不制造无谓的重启)', async () => {
    const { tb, devIds } = await setup(base([alarm]))
    const id = chainId(tb, 'Site Alarms · S')
    const before = tb.calls.length
    const writes = tb.stats.rootWrites

    const r2 = collect()
    expect(await publish(base([alarm]), devIds, tb.api, r2.report, opts)).toEqual([])
    expect(chainId(tb, 'Site Alarms · S')).toBe(id) // 原地更新,没重建
    expect(ownFlows(tb)).toHaveLength(1)
    expect(tb.calls.slice(before).filter(c => c.startsWith('DELETE /api/ruleChain'))).toEqual([])
    // 2026-09-11:内容没变就连元数据都不写(写一次 TB 就重启链上全部节点、定时器从头计时)
    expect(tb.calls.slice(before).filter(c => c === 'POST /api/ruleChain/metadata')).toEqual([])
    expect(tb.stats.rootWrites).toBe(writes)
    expect(r2.log.find(l => l.startsWith('alarm:ok'))).toBe('alarm:ok 1 条规则(未变,未重写) · 转发已就位')
    expect(r2.log.find(l => l.startsWith('health:ok'))).toBe('health:ok 跳过(这次没有重写任何规则链,节点没有重启)')
  })

  it('把告警加回来:链重建、Root 重新接上本站点的节点', async () => {
    const { tb, devIds } = await setup(base([alarm]))
    await publish(base([]), devIds, tb.api, collect().report, opts)
    expect(ownFlows(tb)).toHaveLength(0)

    const r3 = collect()
    expect(await publish(base([alarm]), devIds, tb.api, r3.report, opts)).toEqual([])
    expect(chainNamesOf(tb)).toContain('Site Alarms · S')
    expect(ownFlows(tb)).toHaveLength(1)
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
