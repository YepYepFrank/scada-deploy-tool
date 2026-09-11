// 2026-09-11 live:写入指纹 + 第 3 步同步的冲突检测,以及「对整个结果取绝对值」在真实 TB 上走一遍。
// 只用两台测试设备(Test Device A1 / A2)和临时站点;不建告警,不碰 Root 链。凭据见 env.ts;没凭据整组 skip。
//   ① 发布(跨设备运算整体取 abs + A1 上一条 5 分钟周期统计)→ 同步:全部一致;abs 的结果 ≥ 0
//   ② 模拟同事在 TB 里手工改:计算字段去掉 abs、周期统计链的定时周期 300 → 600 → 同步:两处都判冲突,差异精确
//   ③ 再发布(以向导为准)→ 同步:回到一致
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  cleanup,
  findAsset,
  listCfs,
  publish,
  readPlatformState,
  resolveDeviceIds,
  type Computation,
  type TbApi,
  type TbsiteConfig,
} from '../../src/index'
import { hasCreds, makeApi, TB_BASE } from './env'

const A = 'Test Device A1'
const B = 'Test Device A2'
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

describe.skipIf(!hasCreds)(`写入指纹与冲突检测(live @ ${TB_BASE})`, () => {
  const tag = `cf${Date.now().toString(36).slice(-4)}`
  const site = `${tag}-live`
  const asset = `${site}_CALC`
  const out = `calc_${tag}_absdT`
  const chainName = `Site Rollups · ${site}`
  const comps: Computation[] = [
    {
      template: 'expr.subtract',
      asset,
      output: `${tag}_absdT`,
      absAll: true,
      inputs: { a: { device: A, key: 'temperature' }, b: { device: B, key: 'temperature' } },
    },
    { template: 'window.aggregate', device: A, keys: ['temperature'], aggs: ['avg'], window: '5m' },
  ]
  const cfg: TbsiteConfig = {
    schema: 'tbsite/v2',
    site: { name: site, label: `冲突检测 live 临时站点(${tag})` },
    outputPrefix: 'calc_',
    devices: [
      { name: A, profile: 'default', keys: [{ key: 'temperature' }] },
      { name: B, profile: 'default', keys: [{ key: 'temperature' }] },
    ],
    computations: comps,
  }
  let api: TbApi
  let devIds: Record<string, string>
  const sync = () => readPlatformState(api, cfg, devIds)
  const cfOf = (st: Awaited<ReturnType<typeof sync>>) => st.cfs.find(x => x.cf.name === out)!
  const chainOf = (st: Awaited<ReturnType<typeof sync>>) => st.chains.find(c => c.name === chainName)!

  beforeAll(async () => {
    api = await makeApi()
    ;({ devIds } = await resolveDeviceIds(api, [A, B]))
    expect(Object.keys(devIds)).toHaveLength(2)
  })
  afterAll(async () => {
    if (!api || !devIds) return
    await cleanup(cfg, devIds, api).catch(() => {})
    await api(
      `/api/plugins/telemetry/DEVICE/${devIds[A]}/timeseries/delete?keys=calc_temperatureAvg5m&deleteAllDataForKeys=true`,
      null,
      'DELETE'
    ).catch(() => {})
  })

  it('发布后同步:计算字段与规则链都「一致」;abs(整条式子) TB 接受、算出来 ≥ 0', async () => {
    expect(await publish(cfg, devIds, api, () => {}, { publishedBy: 'live-test', checkHealth: false })).toEqual([])
    const st = await sync()
    expect(cfOf(st)).toMatchObject({ owner: 'mine', drift: 'same' })
    expect(chainOf(st)).toMatchObject({ mine: true, drift: 'same' })
    const a = await findAsset(api, asset)
    const cf = (await listCfs(api, 'ASSET', a.id.id)).find(c => c.name === out) as unknown as {
      configuration: { expression: string }
    }
    expect(cf.configuration.expression).toBe('abs(a - b)')
    let v: { value: string } | undefined
    for (let i = 0; i < 30 && !v; i++) {
      v = (await api(`/api/plugins/telemetry/ASSET/${a.id.id}/values/timeseries?keys=${out}`))?.[out]?.[0]
      if (!v) await sleep(2000)
    }
    expect(v, '60 秒内结果资产上没出数').toBeTruthy()
    expect(Number(v!.value)).toBeGreaterThanOrEqual(0)
  }, 120000)

  it('在 TB 里手工改了计算字段和周期统计链 → 同步判冲突,差异精确到表达式 / 节点的配置字段', async () => {
    // 计算字段:去掉 abs(带着读回的 version 写,就像同事在 TB 界面里保存)
    const a = await findAsset(api, asset)
    const cf = (await listCfs(api, 'ASSET', a.id.id)).find(c => c.name === out) as unknown as {
      configuration: { expression: string }
    }
    cf.configuration.expression = 'a - b'
    await api('/api/calculatedField', cf)
    // 规则链:把定时周期从 300 改成 600
    const chains: { id: { id: string }; name: string }[] = (await api('/api/ruleChains?pageSize=100&page=0')).data
    const ch = chains.find(c => c.name === chainName)!
    const meta = await api(`/api/ruleChain/${ch.id.id}/metadata`)
    const gen = meta.nodes.find((n: { type: string }) => n.type.endsWith('TbMsgGeneratorNode'))
    gen.configuration.periodInSeconds = 600
    await api('/api/ruleChain/metadata', meta)

    const st = await sync()
    expect(cfOf(st)).toMatchObject({ drift: 'conflict' })
    expect(cfOf(st).diff).toEqual([{ item: '表达式', tool: 'abs(a - b)', platform: 'a - b' }])
    expect(chainOf(st)).toMatchObject({ drift: 'conflict' })
    expect(chainOf(st).diff).toEqual([{ item: `节点「${gen.name}」· periodInSeconds`, tool: 300, platform: 600 }])
  }, 120000)

  it('再发布(以向导为准)→ 同步回到一致', async () => {
    expect(await publish(cfg, devIds, api, () => {}, { publishedBy: 'live-test', checkHealth: false })).toEqual([])
    const st = await sync()
    expect(cfOf(st)).toMatchObject({ drift: 'same' })
    expect(chainOf(st)).toMatchObject({ drift: 'same' })
  }, 120000)
})
