// 2026-09-11 live:第 3 步建结果资产 · 进第 3 步同步 · 接管 / 交还 · 规则链没变不重写,在镜像上走一遍。
// 只用两台测试设备(Test Device A1 / A2,本来没有 CF)和临时站点 / 临时资产;不建告警,所以不碰 Root 链。
// 「同事配的字段」用一个临时资产模拟(不带归属标记),测完连同其上的字段一起删。凭据见 env.ts;没凭据整组 skip。
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  cleanup,
  ensureResultAssets,
  findAsset,
  handBackCf,
  listCfs,
  publish,
  readPlatformState,
  resolveDeviceIds,
  type Computation,
  type StepId,
  type TbApi,
  type TbsiteConfig,
} from '../../src/index'
import { hasCreds, makeApi, TB_BASE } from './env'

const A = 'Test Device A1'
const B = 'Test Device A2'

describe.skipIf(!hasCreds)(`第 3 步建资产 / 同步 / 接管 / 交还(live @ ${TB_BASE})`, () => {
  const tag = `sa${Date.now().toString(36).slice(-4)}`
  const site = `${tag}-live`
  const calcAsset = `${site}_CALC`
  const colleagueAsset = `${tag}-colleague`
  const colleagueCfName = `${tag} 同事的求和`
  const colleagueOut = `${tag}_sum`
  const cross: Computation = {
    template: 'expr.subtract',
    asset: calcAsset,
    output: `${tag}_dT`,
    inputs: { a: { device: A, key: 'temperature' }, b: { device: B, key: 'temperature' } },
  }
  const rollup: Computation = {
    template: 'window.aggregate',
    device: A,
    keys: ['temperature'],
    aggs: ['avg'],
    window: '5m',
  }
  const cfgOf = (computations: Computation[]): TbsiteConfig => ({
    schema: 'tbsite/v2',
    site: { name: site, label: `同步 / 接管 live 临时站点(${tag})` },
    outputPrefix: 'calc_',
    devices: [
      { name: A, profile: 'default', keys: [{ key: 'temperature' }] },
      { name: B, profile: 'default', keys: [{ key: 'temperature' }] },
    ],
    computations,
  })
  let api: TbApi
  let devIds: Record<string, string>
  let colleagueId = ''
  let adopted: Computation
  const collect = () => {
    const log: string[] = []
    return { log, report: (s: StepId, st: string, d?: string) => log.push(`${s}:${st}${d ? ' ' + d : ''}`) }
  }

  beforeAll(async () => {
    api = await makeApi()
    ;({ devIds } = await resolveDeviceIds(api, [A, B]))
    expect(Object.keys(devIds)).toHaveLength(2)
    expect(await listCfs(api, 'DEVICE', devIds[A]!)).toEqual([])
    // 模拟同事手配:一个普通资产,上面一个不带标记的 SIMPLE 字段,名字与输出名不同
    colleagueId = (await api('/api/asset', { name: colleagueAsset, type: 'live-colleague' })).id.id
    await api('/api/calculatedField', {
      entityId: { entityType: 'ASSET', id: colleagueId },
      type: 'SIMPLE',
      name: colleagueCfName,
      configurationVersion: 1,
      configuration: {
        type: 'SIMPLE',
        expression: 'T1+T2',
        arguments: {
          T1: {
            refEntityId: { entityType: 'DEVICE', id: devIds[A] },
            refEntityKey: { type: 'TS_LATEST', key: 'temperature' },
          },
          T2: {
            refEntityId: { entityType: 'DEVICE', id: devIds[B] },
            refEntityKey: { type: 'TS_LATEST', key: 'temperature' },
          },
        },
        output: { type: 'TIME_SERIES', name: colleagueOut, scope: null, decimalsByDefault: 2 },
      },
    })
  })

  afterAll(async () => {
    if (!api || !devIds) return
    await cleanup(cfgOf([cross, rollup]), devIds, api).catch(() => {})
    if (colleagueId) await api(`/api/asset/${colleagueId}`, null, 'DELETE').catch(() => {})
    await api(
      `/api/plugins/telemetry/DEVICE/${devIds[A]}/timeseries/delete?keys=calc_temperatureAvg5m&deleteAllDataForKeys=true`,
      null,
      'DELETE'
    ).catch(() => {})
  })

  it('第 3 步保存:只建结果资产 + 站点资产 + 关系,不建计算字段、不建规则链', async () => {
    const r = await ensureResultAssets(cfgOf([cross, rollup]), devIds, api)
    expect(r).toMatchObject({ created: [calcAsset], conflicts: [] })
    const a = await findAsset(api, calcAsset)
    expect(a).toMatchObject({ type: 'tbsite-agg', additionalInfo: { managedBy: 'deploy-tool', site } })
    expect(await listCfs(api, 'ASSET', a.id.id)).toEqual([])
    const s = await findAsset(api, site)
    expect(s?.type).toBe('tbsite')
    const rel = await api(
      `/api/relation?fromId=${s.id.id}&fromType=ASSET&relationType=Contains&toId=${a.id.id}&toType=ASSET`
    )
    expect(rel?.type).toBe('Contains')
    const chains: { name: string }[] = (await api('/api/ruleChains?pageSize=100&page=0')).data
    expect(chains.some(c => c.name.endsWith(`· ${site}`))).toBe(false)
  })

  it('同步:同事的字段列为可接管;声明里的跨设备运算列为「平台上还没有」', async () => {
    const st = await readPlatformState(api, cfgOf([cross, rollup]), devIds)
    const row = st.cfs.find(x => x.cf.name === colleagueCfName)!
    expect(row).toMatchObject({ owner: 'foreign', entity: colleagueAsset })
    expect(row.adopt!.ok).toBe(true)
    adopted = (row.adopt as { computation: Computation }).computation
    expect(adopted).toMatchObject({
      asset: colleagueAsset,
      output: colleagueOut,
      cfName: colleagueCfName,
      adopted: true,
    })
    expect(st.missing).toEqual([{ entityType: 'ASSET', entity: calcAsset, name: `calc_${tag}_dT` }])
    expect(st.chains.some(c => c.root)).toBe(true)
    expect(st.occupied[`ASSET|${colleagueAsset}`]).toBe(1)
  })

  it('接管后发布:同事的字段原地更新(原名、原输出)并打标记;规则链第二次发布内容没变不重写', async () => {
    const cfg = cfgOf([cross, rollup, adopted])
    const r1 = collect()
    expect(await publish(cfg, devIds, api, r1.report, { publishedBy: 'live-test' })).toEqual([])
    const onCol = await listCfs(api, 'ASSET', colleagueId)
    expect(onCol.map(c => c.name)).toEqual([colleagueCfName])
    expect(onCol[0]!.additionalInfo).toMatchObject({ managedBy: 'deploy-tool', site })
    expect((onCol[0] as unknown as { configuration: { output: { name: string } } }).configuration.output.name).toBe(
      colleagueOut
    )
    expect(r1.log.find(l => l.startsWith('rollup:ok'))).not.toContain('未变')

    const r2 = collect()
    expect(await publish(cfg, devIds, api, r2.report, { publishedBy: 'live-test' })).toEqual([])
    // 真实 TB 读回来的元数据与计划比对一致 → 不重写、不重启定时器
    expect(r2.log.find(l => l.startsWith('rollup:ok'))).toContain('(未变,未重写)')
    expect(r2.log.find(l => l.startsWith('cf:ok'))).toContain('新建 0 · 更新 2')
    expect(r2.log.find(l => l.startsWith('health:ok'))).toContain('跳过')
    const st = await readPlatformState(api, cfg, devIds)
    expect(st.cfs.find(x => x.cf.name === colleagueCfName)).toMatchObject({
      owner: 'mine',
      drift: 'same',
      adopted: true,
    })
    expect(st.cfs.find(x => x.cf.name === `calc_${tag}_dT`)).toMatchObject({ owner: 'mine', drift: 'same' })
  })

  it('交还:去掉标记、字段留着;声明里去掉后再发布也不删它', async () => {
    const f = (await listCfs(api, 'ASSET', colleagueId)).find(c => c.name === colleagueCfName)!
    expect(await handBackCf(api, f)).toBe(true)
    expect((await listCfs(api, 'ASSET', colleagueId))[0]!.additionalInfo ?? null).toBeNull()
    expect(await publish(cfgOf([cross, rollup]), devIds, api, () => {}, { publishedBy: 'live-test' })).toEqual([])
    expect((await listCfs(api, 'ASSET', colleagueId)).map(c => c.name)).toEqual([colleagueCfName])
  })

  it('cleanup:本站点的资产 / 链全清,同事的资产和字段不动', async () => {
    const msg = await cleanup(cfgOf([cross, rollup]), devIds, api)
    expect(msg).toContain(`已删汇聚资产 ${calcAsset}`)
    expect(await findAsset(api, calcAsset)).toBeNull()
    expect(await findAsset(api, site)).toBeNull()
    expect((await listCfs(api, 'ASSET', colleagueId)).map(c => c.name)).toEqual([colleagueCfName])
  })
})
