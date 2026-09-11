// 2026-09-10 live:即时计算的结果存哪——输入跨设备 → 结果资产;输入在一台设备 → 这台设备。
// publish 之后在镜像上等真实遥测触发、核对算出来的值,再 cleanup 全清。
// 用镜像上两台持续上报 temperature 的测试设备(Test Device A1 / A2,本来都没有 CF),临时站点名带随机标签,
// 不碰任何站点的 CF / 链 / 资产。凭据见 env.ts;没凭据整组 skip。
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { cleanup, findAsset, listCfs, publish, resolveDeviceIds, type TbApi, type TbsiteConfig } from '../../src/index'
import { hasCreds, makeApi, TB_BASE } from './env'

const A = 'Test Device A1'
const B = 'Test Device A2'
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))
type Pt = { ts: number; value: string }

describe.skipIf(!hasCreds)(`跨设备运算结果存资产(live @ ${TB_BASE})`, () => {
  const tag = `xd${Date.now().toString(36).slice(-4)}`
  const assetName = `${tag}-live_CALC`
  const cfg: TbsiteConfig = {
    schema: 'tbsite/v2',
    site: { name: `${tag}-live`, label: `跨设备运算 live 临时站点(${tag})` },
    outputPrefix: 'calc_',
    devices: [
      { name: A, profile: 'default', keys: [{ key: 'temperature' }] },
      { name: B, profile: 'default', keys: [{ key: 'temperature' }] },
    ],
    computations: [
      {
        template: 'expr.subtract',
        asset: assetName,
        output: `${tag}_dT`,
        inputs: { a: { device: A, key: 'temperature' }, b: { device: B, key: 'temperature' } },
      },
      {
        template: 'expr.custom',
        device: A,
        output: `${tag}_T2`,
        terms: [
          { kind: 'key', device: A, key: 'temperature' },
          { kind: 'const', value: 2 },
        ],
        ops: ['*'],
      },
    ],
  }
  const dT = `calc_${tag}_dT`
  const T2 = `calc_${tag}_T2`
  let api: TbApi
  let devIds: Record<string, string>

  const series = async (type: string, id: string, key: string, startTs: number, endTs: number, limit = 50) =>
    (((await api(
      `/api/plugins/telemetry/${type}/${id}/values/timeseries?keys=${encodeURIComponent(key)}` +
        `&startTs=${startTs}&endTs=${endTs}&limit=${limit}&orderBy=DESC`
    )) ?? {})[key] ?? []) as Pt[]
  /** 某时刻(含)之前最近的一个输入值 */
  const valueAt = async (dev: string, key: string, ts: number) =>
    Number((await series('DEVICE', devIds[dev]!, key, ts - 60_000, ts, 1))[0]?.value)

  beforeAll(async () => {
    api = await makeApi()
    ;({ devIds } = await resolveDeviceIds(api, [A, B]))
    expect(Object.keys(devIds)).toHaveLength(2)
    // 前提:两台测试设备本来没有 CF(不然临时站点可能撞单实体上限,也说明有人在用)
    expect(await listCfs(api, 'DEVICE', devIds[A]!)).toEqual([])
    expect(await listCfs(api, 'DEVICE', devIds[B]!)).toEqual([])
  })

  afterAll(async () => {
    if (!api || !devIds) return
    await cleanup(cfg, devIds, api).catch(() => {})
    // 单设备结果写在 Test Device A1 上,测完把这条遥测 key 的历史也删掉,不留痕
    await api(
      `/api/plugins/telemetry/DEVICE/${devIds[A]}/timeseries/delete?keys=${T2}&deleteAllDataForKeys=true`,
      null,
      'DELETE'
    ).catch(() => {})
  })

  it('publish:跨设备的 CF 建在结果资产上并挂到站点下,单设备的建在设备上', async () => {
    expect(await publish(cfg, devIds, api, () => {}, { publishedBy: 'live-test', checkHealth: false })).toEqual([])
    const asset = await findAsset(api, assetName)
    expect(asset?.type).toBe('tbsite-agg')
    expect((await listCfs(api, 'ASSET', asset.id.id)).map(c => c.name)).toEqual([dT])
    expect((await listCfs(api, 'DEVICE', devIds[A]!)).map(c => c.name)).toEqual([T2])
    expect(await listCfs(api, 'DEVICE', devIds[B]!)).toEqual([])
    const site = await findAsset(api, cfg.site.name)
    const rel = await api(
      `/api/relation?fromId=${site.id.id}&fromType=ASSET&relationType=Contains&toId=${asset.id.id}&toType=ASSET`
    )
    expect(rel?.type).toBe('Contains')
  })

  it('生效:资产上算出 A1 − A2、A1 上算出 A1 × 2,值与同一时刻的输入对得上', async () => {
    const asset = await findAsset(api, assetName)
    const t0 = Date.now() - 120_000
    let d: Pt[] = []
    let t: Pt[] = []
    for (let i = 0; i < 45; i++) {
      d = await series('ASSET', asset.id.id, dT, t0, Date.now() + 60_000)
      t = await series('DEVICE', devIds[A]!, T2, t0, Date.now() + 60_000)
      if (d.length >= 3 && t.length >= 3) break
      await sleep(2000)
    }
    expect(d.length, '90 秒内结果资产上没出数').toBeGreaterThan(0)
    expect(t.length, '90 秒内设备上没出数').toBeGreaterThan(0)
    console.info(`[live] 资产 ${assetName}.${dT} 已出 ${d.length} 点,${A}.${T2} 已出 ${t.length} 点`)
    // 输入一直在变:逐点拿「结果时刻之前最近的输入」来核,至少有一点精确对上(保留 2 位小数)
    const hitsD = []
    for (const p of d.slice(0, 5)) {
      const want = (await valueAt(A, 'temperature', p.ts)) - (await valueAt(B, 'temperature', p.ts))
      hitsD.push(Math.abs(Number(p.value) - want) <= 0.011)
    }
    const hitsT = []
    for (const p of t.slice(0, 5))
      hitsT.push(Math.abs(Number(p.value) - 2 * (await valueAt(A, 'temperature', p.ts))) <= 0.011)
    console.info(`[live] 逐点核对 A1−A2: ${hitsD.join(',')} · A1×2: ${hitsT.join(',')}`)
    expect(hitsD.some(Boolean), 'A1 − A2 一点都对不上').toBe(true)
    expect(hitsT.some(Boolean), 'A1 × 2 一点都对不上').toBe(true)
  })

  it('cleanup:结果资产(连同其上的 CF)、设备上的 CF、站点资产都删干净', async () => {
    const msg = await cleanup(cfg, devIds, api)
    expect(msg).toContain(`已删汇聚资产 ${assetName}`)
    expect(await findAsset(api, assetName)).toBeNull()
    expect(await findAsset(api, cfg.site.name)).toBeNull()
    expect(await listCfs(api, 'DEVICE', devIds[A]!)).toEqual([])
  })
})
