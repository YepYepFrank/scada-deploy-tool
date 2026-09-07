// live:LegacyDataSource.ext() 对真 kz(镜像 8099)——通用历史六个粒度桶、ZD、资产 key、错误路径、收益趋势。
// 2026-09-07 首跑记录见 docs/联调记录/kz-接口实测-2026-09-07.md。没凭据整组 skip。
import { beforeAll, describe, expect, it } from 'vitest'
import { KZ_BUCKETS, LegacyDataSource, type ExtInterval, type TsPoint } from '../../src/index'
import { entityId, hasCreds, KZ_BASE, loginToken, MIRROR, TB_BASE } from './env'

const H = 3_600_000
const D = 86_400_000

describe.skipIf(!hasCreds)(`kz 通用历史(live @ ${KZ_BASE})`, () => {
  let ds: LegacyDataSource
  let ied: { type: 'DEVICE'; id: string }
  let agg: { type: 'ASSET'; id: string }
  beforeAll(async () => {
    const token = await loginToken()
    ds = new LegacyDataSource({ baseUrl: TB_BASE, getToken: () => token, kzBaseUrl: KZ_BASE })
    ied = { type: 'DEVICE', id: await entityId(token, 'DEVICE', MIRROR.ied) }
    agg = { type: 'ASSET', id: await entityId(token, 'ASSET', MIRROR.aggAsset) }
  })

  const steps = (pts: TsPoint[]) => [...new Set(pts.slice(1).map((p, i) => p.ts - pts[i]!.ts))]
  const numeric = (pts: TsPoint[]) => pts.every(p => typeof p.value === 'number' && Number.isFinite(p.value))
  const ascending = (pts: TsPoint[]) => pts.every((p, i) => i === 0 || p.ts > pts[i - 1]!.ts)

  it('minute:1h 窗口 → 升序、60 秒步长、数值;meta 带桶 / agg / 窗口', async () => {
    const r = await ds.ext({ source: 'kz', window: '1h', interval: '1m', params: { entity: ied, keys: ['P', 'Q'] } })
    expect(Object.keys(r.series).sort()).toEqual(['P', 'Q'])
    const p = r.series.P!
    expect(p.length).toBeGreaterThan(30)
    expect(ascending(p)).toBe(true)
    expect(numeric(p)).toBe(true)
    expect(steps(p)).toEqual([60_000])
    expect(r.meta).toMatchObject({ bucket: 'minute', agg: 'AVG' })
    expect((r.meta!.endTs as number) - (r.meta!.startTs as number)).toBe(H)
  })

  it('缺省粒度按窗口选:12h → minutefive(300 秒步长);3d → hour;90d → day', async () => {
    const five = await ds.ext({ source: 'kz', window: '12h', params: { entity: ied, keys: ['P'] } })
    expect(five.meta!.bucket).toBe('minutefive')
    expect(steps(five.series.P!)).toEqual([300_000])
    const hour = await ds.ext({ source: 'kz', window: '3d', params: { entity: ied, keys: ['P'] } })
    expect(hour.meta!.bucket).toBe('hour')
    // 归档有空洞(09-05 镜像停机等),步长只要求整小时倍数
    expect(steps(hour.series.P!).every(s => s % H === 0)).toBe(true)
    expect(hour.series.P!.length).toBeGreaterThan(24)
    const day = await ds.ext({ source: 'kz', window: '90d', params: { entity: ied, keys: ['P'] } })
    expect(day.meta!.bucket).toBe('day')
    // 归档从 09-02 起才有,天级只有几个点;步长是天的整数倍(缺天不补 0)
    expect(day.series.P!.length).toBeGreaterThan(0)
    expect(steps(day.series.P!).every(s => s % D === 0)).toBe(true)
  })

  it('month / year 桶:月点落在月初 0 点;年桶只回 1 个「当年到现在」的点,ts 是查询时刻(kz 实测怪癖)', async () => {
    const m = await ds.ext({
      source: 'kz',
      interval: '1M',
      params: { entity: ied, keys: ['P'], startTs: Date.now() - 365 * D, endTs: Date.now() },
    })
    expect(m.meta!.bucket).toBe('month')
    for (const p of m.series.P!) {
      const d = new Date(p.ts + 8 * H) // 东八区
      expect([d.getUTCDate(), d.getUTCHours(), d.getUTCMinutes()]).toEqual([1, 0, 0])
    }
    const y = await ds.ext({
      source: 'kz',
      interval: '1y',
      params: { entity: ied, keys: ['P'], startTs: Date.now() - 400 * D, endTs: Date.now() },
    })
    expect(y.meta!.bucket).toBe('year')
    expect(y.series.P!.length).toBe(1)
    expect(Math.abs(y.series.P![0]!.ts - Date.now())).toBeLessThan(60_000)
  })

  it('agg=ZD(整点值)与 MAX 都能查;MAX ≥ AVG', async () => {
    const zd = await ds.ext({
      source: 'kz',
      window: '1h',
      interval: '1m',
      params: { entity: ied, keys: ['P'], agg: 'ZD' },
    })
    expect(zd.meta!.agg).toBe('ZD')
    expect(numeric(zd.series.P!)).toBe(true)
    const max = await ds.ext({
      source: 'kz',
      window: '24h',
      interval: '1h',
      params: { entity: ied, keys: ['P'], agg: 'MAX' },
    })
    const avg = await ds.ext({
      source: 'kz',
      window: '24h',
      interval: '1h',
      params: { entity: ied, keys: ['P'], agg: 'AVG' },
    })
    const byTs = new Map(avg.series.P!.map(p => [p.ts, p.value as number]))
    for (const p of max.series.P!)
      if (byTs.has(p.ts)) expect(p.value as number).toBeGreaterThanOrEqual(byTs.get(p.ts)! - 1e-6)
  })

  it('资产上的工具输出(calc_totalP)也进了归档:ASSET 路径可查', async () => {
    const r = await ds.ext({
      source: 'kz',
      window: '1h',
      interval: '1m',
      params: { entity: agg, keys: ['calc_totalP'] },
    })
    expect(r.series.calc_totalP!.length).toBeGreaterThan(10)
    expect(numeric(r.series.calc_totalP!)).toBe(true)
  })

  it('错误路径:不存在的 key → kz 回 HTTP 200 + code 500「key不存在」→ ext 抛明确错误;六个粒度桶路径与 KZ_BUCKETS 一致', async () => {
    await expect(ds.ext({ source: 'kz', window: '1h', params: { entity: ied, keys: ['NOPE'] } })).rejects.toThrow(
      /key不存在/
    )
    for (const [iv, b] of Object.entries(KZ_BUCKETS) as [ExtInterval, { path: string }][]) {
      const r = await ds.ext({
        source: 'kz',
        interval: iv,
        params: { entity: ied, keys: ['P'], startTs: Date.now() - 2 * H, endTs: Date.now() },
      })
      expect(r.meta!.bucket).toBe(b.path)
    }
  })

  it('收益趋势(stationRevenueTrend)仍可用:返回 inc / cost / net 三条序列', async () => {
    const r = await ds.ext({ source: 'kz', params: { stationId: MIRROR.revenueStationId } })
    expect(Object.keys(r.series)).toEqual(['inc', 'cost', 'net'])
    expect(['day', 'month']).toContain(r.meta!.mode)
  })
})
