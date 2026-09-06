import { describe, expect, it } from 'vitest'
import { LegacyDataSource, normalizeValue } from '../src/index'
import { describeDataSourceConformance } from './conformance'
import { FakeSocket, FakeTb } from './fake-tb'

describeDataSourceConformance('LegacyDataSource', () => {
  const tb = new FakeTb()
  const ds = new LegacyDataSource({
    baseUrl: 'http://tb',
    getToken: () => tb.token,
    fetchImpl: tb.fetch,
    WebSocketImpl: FakeSocket as unknown as typeof WebSocket,
  })
  return { ds, tb }
})

describe('LegacyDataSource 细节', () => {
  it('normalizeValue:数值串 / 布尔串 / 其它字符串 / null', () => {
    expect(normalizeValue('78.5')).toBe(78.5)
    expect(normalizeValue('-1e3')).toBe(-1000)
    expect(normalizeValue(' 7 ')).toBe(7)
    expect(normalizeValue('true')).toBe(true)
    expect(normalizeValue('false')).toBe(false)
    expect(normalizeValue('PCS-1')).toBe('PCS-1')
    expect(normalizeValue('')).toBe('')
    expect(normalizeValue(null)).toBeNull()
    expect(normalizeValue(undefined)).toBeNull()
    expect(normalizeValue(3)).toBe(3)
  })

  it('WS 地址:绝对 baseUrl 换协议;相对 baseUrl 用当前 origin;wsUrl 显式覆盖', () => {
    const urls = (o: Partial<ConstructorParameters<typeof LegacyDataSource>[0]>) => {
      const tb = new FakeTb()
      const ds = new LegacyDataSource({
        baseUrl: '/tbm',
        getToken: () => 't',
        fetchImpl: tb.fetch,
        WebSocketImpl: FakeSocket as unknown as typeof WebSocket,
        ...o,
      })
      ds.subscribeTs({ type: 'DEVICE', id: 'x' }, ['P'], () => {})
      return new Promise<string>(r => setTimeout(() => r(FakeSocket.instances.at(-1)!.url), 0))
    }
    return (async () => {
      expect(await urls({ baseUrl: 'https://tb.example:8443' })).toBe(
        'wss://tb.example:8443/api/ws/plugins/telemetry?token=t'
      )
      expect(await urls({ wsUrl: 'ws://custom:1' })).toBe('ws://custom:1/api/ws/plugins/telemetry?token=t')
    })()
  })

  it('dispose 后不再重连', async () => {
    const tb = new FakeTb()
    const ds = new LegacyDataSource({
      baseUrl: 'http://tb',
      getToken: () => tb.token,
      fetchImpl: tb.fetch,
      WebSocketImpl: FakeSocket as unknown as typeof WebSocket,
      reconnectMs: 1,
    })
    ds.subscribeTs({ type: 'DEVICE', id: 'x' }, ['P'], () => {})
    await new Promise(r => setTimeout(r, 0))
    tb.acceptPending()
    const n = FakeSocket.instances.length
    ds.dispose()
    await new Promise(r => setTimeout(r, 10))
    expect(FakeSocket.instances.length).toBe(n)
    expect(ds.status).toBe('live') // dispose 不改状态,只停止活动
  })

  it('REST 401 时 getLatest 抛出带状态码的错误', async () => {
    const tb = new FakeTb()
    const ds = new LegacyDataSource({
      baseUrl: 'http://tb',
      getToken: () => 'wrong',
      fetchImpl: tb.fetch,
      WebSocketImpl: FakeSocket as unknown as typeof WebSocket,
    })
    await expect(ds.getLatest({ type: 'DEVICE', id: 'x' }, ['P'])).rejects.toThrow('HTTP 401')
  })
})

describe('LegacyDataSource.ext(kz,ADR-004 路线 A)', () => {
  const make = (kzBaseUrl?: string) => {
    const tb = new FakeTb()
    tb.kz.set('st-1', {
      day: [
        { statDate: '2026-09-04', dischargeIncome: '10.5', chargeCost: '4', netProfit: '6.5' },
        { statDate: '2026-09-05', dischargeIncome: 12, chargeCost: 5, netProfit: 7 },
      ],
      month: [{ statDate: '2026-08', dischargeIncome: 300, chargeCost: 120, netProfit: 180 }],
    })
    tb.kz.set('st-empty', { day: [], month: [{ statDate: '2026-07', netProfit: 1 }] })
    const ds = new LegacyDataSource({
      baseUrl: 'http://tb',
      getToken: () => tb.token,
      kzBaseUrl,
      fetchImpl: tb.fetch,
      WebSocketImpl: FakeSocket as unknown as typeof WebSocket,
    })
    return { tb, ds }
  }

  it('本月逐日:三条序列,数值串归一,ts 为当天 0 点(+08:00);metric 指定只返回一条', async () => {
    const { ds, tb } = make('http://kz')
    const r = await ds.ext({ source: 'kz', window: '30d', interval: '1d', params: { stationId: 'st-1' } })
    expect(Object.keys(r.series)).toEqual(['inc', 'cost', 'net'])
    expect(r.series.net).toEqual([
      { ts: new Date('2026-09-04T00:00:00+08:00').getTime(), value: 6.5 },
      { ts: new Date('2026-09-05T00:00:00+08:00').getTime(), value: 7 },
    ])
    expect(r.meta).toEqual({ mode: 'day', rows: 2 })
    expect(tb.requests.at(-1)).toBe('http://kz/kzserver/biz/power/stationRevenueTrend')
    const one = await ds.ext({ source: 'kz', params: { stationId: 'st-1', metric: 'inc' } })
    expect(Object.keys(one.series)).toEqual(['inc'])
    expect(one.series.inc![0]!.value).toBe(10.5)
  })

  it('本月无归档降级为本年逐月(meta.mode=month,YYYY-MM 补成月初);interval 1M 直接逐月', async () => {
    const { ds } = make('/kz')
    const r = await ds.ext({ source: 'kz', params: { stationId: 'st-empty' } })
    expect(r.meta?.mode).toBe('month')
    expect(r.series.net).toEqual([{ ts: new Date('2026-07-01T00:00:00+08:00').getTime(), value: 1 }])
    const m = await ds.ext({ source: 'kz', interval: '1M', params: { stationId: 'st-1' } })
    expect([m.meta?.mode, m.series.net!.length]).toEqual(['month', 1])
  })

  it('kz 未配置 / 非 kz 源 / 缺 stationId / 站点不存在 都是明确错误(渲染器据此置错误态)', async () => {
    const none = make().ds
    await expect(none.ext({ source: 'kz', params: { stationId: 'st-1' } })).rejects.toThrow(/kz 未配置/)
    const { ds } = make('/kz')
    await expect(ds.ext({ source: 'other', params: {} })).rejects.toThrow(/不支持的外部源/)
    await expect(ds.ext({ source: 'kz', params: {} })).rejects.toThrow(/stationId/)
    await expect(ds.ext({ source: 'kz', params: { stationId: 'nope' } })).rejects.toThrow(/站点不存在/)
  })
})
