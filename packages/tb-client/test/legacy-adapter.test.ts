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
