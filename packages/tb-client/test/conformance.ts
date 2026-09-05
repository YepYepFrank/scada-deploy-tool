// DataSource 一致性用例:任何实现(LegacyDataSource、同事的 TbClient)都用同一套断言,配合 fake-tb.ts。
// 同事交付 TbClient 时:新建 test/tb-client.test.ts,调用 describeDataSourceConformance('TbClient', () => ({ ds, tb }))。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DataSource, TsUpdate } from '../src/data-source'
import { FakeSocket, FakeTb } from './fake-tb'

export interface ConformanceHarness {
  ds: DataSource & { dispose?(): void }
  tb: FakeTb
}

const DEV = { type: 'DEVICE', id: 'dev-1', name: 'D1' } as const
/** 假定时器下推进 0ms:把 getToken / fetch 等微任务与 0ms 定时器都跑完 */
const flush = () => vi.advanceTimersByTimeAsync(0)
/** 让实现建好 socket → 服务端接受 → 首包送达 */
const connect = async (h: ConformanceHarness) => {
  await flush()
  h.tb.acceptPending()
  await flush()
}

export function describeDataSourceConformance(name: string, setup: () => ConformanceHarness) {
  describe(`DataSource 一致性:${name}`, () => {
    let h: ConformanceHarness
    beforeEach(() => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
      vi.setSystemTime(1_700_000_000_000)
      h = setup()
      h.tb.seedTs(DEV.id, 'P', [
        [1_699_999_990_000, '10.5'],
        [1_699_999_995_000, '11'],
      ])
      h.tb.seedTs(DEV.id, 'CB', [[1_699_999_995_000, 'true']])
      h.tb.seedTs(DEV.id, 'name', [[1_699_999_995_000, 'PCS-1']])
      h.tb.seedAttr(DEV.id, 'soh', '97.5')
    })
    afterEach(() => {
      h.ds.dispose?.()
      vi.useRealTimers()
    })

    it('subscribeTs:首次回调给最新值,之后按推送增量;字符串数值 / 布尔归一;不存在的 key 为 null', async () => {
      const got: TsUpdate[][] = []
      h.ds.subscribeTs(DEV, ['P', 'CB', 'name', 'nope'], u => got.push(u))
      await connect(h)
      expect(h.ds.status).toBe('live')
      expect(got).toHaveLength(1)
      const first = Object.fromEntries(got[0]!.map(u => [u.key, u.points]))
      expect(first.P).toEqual([{ ts: 1_699_999_995_000, value: 11 }])
      expect(first.CB).toEqual([{ ts: 1_699_999_995_000, value: true }])
      expect(first.name).toEqual([{ ts: 1_699_999_995_000, value: 'PCS-1' }])
      expect(first.nope?.[0]?.value).toBeNull()
      h.tb.pushTs(DEV.id, 'P', '12.25', 1_700_000_001_000)
      expect(got).toHaveLength(2)
      expect(got[1]).toEqual([{ key: 'P', points: [{ ts: 1_700_000_001_000, value: 12.25 }] }])
    })

    it('退订后不再回调;订阅另一个实体互不串线', async () => {
      const a: TsUpdate[][] = []
      const b: TsUpdate[][] = []
      const offA = h.ds.subscribeTs(DEV, ['P'], u => a.push(u))
      h.ds.subscribeTs({ type: 'DEVICE', id: 'dev-2' }, ['P'], u => b.push(u))
      await connect(h)
      offA()
      h.tb.pushTs(DEV.id, 'P', '1')
      h.tb.pushTs('dev-2', 'P', '2')
      expect(a).toHaveLength(1)
      expect(b).toHaveLength(2)
      expect(b[1]![0]!.points[0]!.value).toBe(2)
    })

    it('退订全部再订阅新的:退订命令必须带 entityId,否则 TB 关掉整个会话', async () => {
      const off = h.ds.subscribeTs(DEV, ['P'], () => {})
      await connect(h)
      off()
      const b: TsUpdate[][] = []
      h.ds.subscribeTs(DEV, ['CB'], u => b.push(u)) // 渲染器切设备 / 改配置就是这个模式:dispose 后立刻重订
      await flush()
      expect(b).toHaveLength(1)
      expect(b[0]![0]!.points[0]!.value).toBe(true)
      h.tb.pushTs(DEV.id, 'CB', 'false')
      expect(b).toHaveLength(2)
    })

    it('退订全部、隔一会再订阅:仍能收到数据(实现可关闭空闲连接后重开)', async () => {
      const off = h.ds.subscribeTs(DEV, ['P'], () => {})
      await connect(h)
      off()
      await vi.advanceTimersByTimeAsync(10_000)
      const b: TsUpdate[][] = []
      h.ds.subscribeTs(DEV, ['P'], u => b.push(u))
      await connect(h)
      expect(b).toHaveLength(1)
      expect(b[0]![0]!.points[0]!.value).toBe(11)
      expect(h.ds.status).toBe('live')
    })

    it('subscribeAttr:首次给当前值,推送增量', async () => {
      const got: unknown[] = []
      h.ds.subscribeAttr(DEV, 'SERVER_SCOPE', ['soh'], u => got.push(u))
      await connect(h)
      expect(got[0]).toEqual([{ scope: 'SERVER_SCOPE', key: 'soh', ts: 1_700_000_000_000, value: 97.5 }])
      h.tb.pushAttr(DEV.id, 'soh', '96', 1_700_000_002_000)
      expect(got[1]).toEqual([{ scope: 'SERVER_SCOPE', key: 'soh', ts: 1_700_000_002_000, value: 96 }])
    })

    it('断线 → status offline;重连后重放订阅并继续收数 → live', async () => {
      const statuses: string[] = []
      h.ds.onStatus(s => statuses.push(s))
      const got: TsUpdate[][] = []
      h.ds.subscribeTs(DEV, ['P'], u => got.push(u))
      await connect(h)
      h.tb.dropAll()
      expect(h.ds.status).toBe('offline')
      await vi.advanceTimersByTimeAsync(5000) // 重连间隔
      await connect(h)
      expect(h.ds.status).toBe('live')
      expect(got).toHaveLength(2) // 重连后重新收到最新值
      h.tb.pushTs(DEV.id, 'P', '3')
      expect(got).toHaveLength(3)
      expect(statuses).toEqual(['live', 'offline', 'connecting', 'live'])
      expect(FakeSocket.instances).toHaveLength(2)
    })

    it('getLatest:归一化;不存在的 key → null', async () => {
      const r = await h.ds.getLatest(DEV, ['P', 'CB', 'nope'])
      expect(r).toEqual({
        P: { ts: 1_699_999_995_000, value: 11 },
        CB: { ts: 1_699_999_995_000, value: true },
        nope: null,
      })
    })

    it('getHistory:按窗口自适应聚合;点列升序;每个请求的 key 都有数组', async () => {
      const t0 = 1_700_000_000_000
      for (let i = 0; i < 24 * 12; i++) h.tb.pushTs(DEV.id, 'P', String(i), t0 - 24 * 3_600_000 + i * 300_000)
      const raw = await h.ds.getHistory(DEV, ['P', 'nope'], '1h')
      expect(raw.P!.length).toBe(12 + 2) // 最近 1 小时 12 个 5 分钟点 + beforeEach 种的 2 个
      expect(raw.P!.every((p, i, a) => i === 0 || p.ts > a[i - 1]!.ts)).toBe(true)
      expect(raw.nope).toEqual([])
      expect(h.tb.requests.at(-1)).toMatch(/agg=NONE/)
      const day = await h.ds.getHistory(DEV, ['P'], '24h')
      expect(h.tb.requests.at(-1)).toMatch(/agg=AVG/)
      expect(h.tb.requests.at(-1)).toMatch(/interval=300000/)
      expect(day.P!.length).toBeGreaterThan(200)
      await h.ds.getHistory(DEV, ['P'], '7d')
      expect(h.tb.requests.at(-1)).toMatch(/interval=3600000/)
      await h.ds.getHistory(DEV, ['P'], '30d')
      expect(h.tb.requests.at(-1)).toMatch(/interval=86400000/)
      await h.ds.getHistory(DEV, ['P'], '30d', 'MAX')
      expect(h.tb.requests.at(-1)).toMatch(/agg=MAX/)
    })

    it('subscribeAlarms:给活动告警全集,归一 originator;退订后停止轮询', async () => {
      h.tb.alarms.set(DEV.id, [
        {
          id: { id: 'al-1', entityType: 'ALARM' },
          type: '过温',
          severity: 'MAJOR',
          acknowledged: false,
          cleared: false,
          startTs: 1_699_999_000_000,
          originator: { entityType: 'DEVICE', id: DEV.id },
          originatorName: 'D1',
          details: { message: 'x' },
        },
        {
          id: { id: 'al-2', entityType: 'ALARM' },
          type: '通讯',
          severity: 'WARNING',
          status: 'ACTIVE_ACK',
          startTs: 1_699_999_100_000,
          originator: { entityType: 'DEVICE', id: DEV.id },
        },
      ])
      const got: unknown[][] = []
      const off = h.ds.subscribeAlarms(DEV, undefined, a => got.push(a))
      await flush()
      expect(got).toHaveLength(1)
      expect(got[0]).toEqual([
        {
          id: 'al-1',
          type: '过温',
          severity: 'MAJOR',
          status: 'ACTIVE_UNACK',
          startTs: 1_699_999_000_000,
          originator: { type: 'DEVICE', id: DEV.id },
          originatorName: 'D1',
          details: { message: 'x' },
        },
        {
          id: 'al-2',
          type: '通讯',
          severity: 'WARNING',
          status: 'ACTIVE_ACK',
          startTs: 1_699_999_100_000,
          originator: { type: 'DEVICE', id: DEV.id },
        },
      ])
      const typed: unknown[][] = []
      h.ds.subscribeAlarms(DEV, ['通讯'], a => typed.push(a))
      await flush()
      expect((typed[0] as { type: string }[]).map(a => a.type)).toEqual(['通讯'])
      const n = h.tb.requests.length
      off()
      await vi.advanceTimersByTimeAsync(60_000)
      const alarmReqs = h.tb.requests.slice(n).filter(u => u.includes('/api/alarm/'))
      expect(alarmReqs.length).toBeGreaterThan(0) // 第二个订阅仍在轮询
      expect(alarmReqs.length).toBeLessThanOrEqual(7) // 第一个已停:60 秒内约 6 次而非 12 次
    })
  })
}
