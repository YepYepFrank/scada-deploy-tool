// T5.4:WS 订阅按实体合并 + 按字节数分片(TB 入站单条消息上限 32768 字节,超了以 1009 关连接)
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AttrUpdate, EntityRef, TsUpdate } from '../src/index'
import { LegacyDataSource } from '../src/index'
import { MAX_WS_MESSAGE_BYTES, chunkWsCommands, type WireCmd, type WsMessage } from '../src/legacy-adapter'
import { FakeSocket, FakeTb } from '../src/testing/fake-tb'

const tick = () => new Promise(r => setTimeout(r, 0))
const bytes = (msg: unknown) => new TextEncoder().encode(JSON.stringify(msg)).length
const dev = (id: string): EntityRef => ({ type: 'DEVICE', id })
/** 36 位 id,与真实 TB 的 UUID 等长,这样字节数估算贴近线上 */
const uuid = (i: number) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`

let ds: LegacyDataSource | null = null
afterEach(() => {
  ds?.dispose()
  ds = null
  vi.restoreAllMocks()
})

function make() {
  const tb = new FakeTb()
  ds = new LegacyDataSource({
    baseUrl: 'http://tb',
    getToken: () => tb.token,
    fetchImpl: tb.fetch,
    WebSocketImpl: FakeSocket as unknown as typeof WebSocket,
    reconnectMs: 1,
  })
  return { tb, ds }
}
/** 先挂一个无关订阅把连接打开,之后的订阅走 flush(首发)路径;返回时 sent 已清空 */
async function makeOpen() {
  const h = make()
  h.ds.subscribeTs(dev('anchor'), ['x'], () => {})
  await tick()
  h.tb.acceptPending()
  await tick()
  const sock = FakeSocket.instances.at(-1)!
  sock.sent.length = 0
  return { ...h, sock }
}
const sentOf = (sock: FakeSocket) => sock.sent as WsMessage[]
const tsCmds = (sock: FakeSocket) => sentOf(sock).flatMap(m => m.tsSubCmds)
const attrCmds = (sock: FakeSocket) => sentOf(sock).flatMap(m => m.attrSubCmds)

describe('WS 订阅按实体合并', () => {
  it('同 tick 同实体 5 个 key → 1 条命令(keys 逗号拼接、去重)', async () => {
    const { ds, sock } = await makeOpen()
    for (const k of ['P', 'Q', 'Ia', 'Ib', 'Ic']) ds.subscribeTs(dev('d1'), [k], () => {})
    ds.subscribeTs(dev('d1'), ['P', 'Q'], () => {}) // 重复 key 不重复订
    await tick()
    expect(sentOf(sock)).toHaveLength(1)
    expect(tsCmds(sock)).toHaveLength(1)
    expect(tsCmds(sock)[0]).toMatchObject({
      entityType: 'DEVICE',
      entityId: 'd1',
      keys: 'P,Q,Ia,Ib,Ic',
      scope: 'LATEST_TELEMETRY',
    })
  })

  it('首连(重放路径)同样合并;不同实体、ts 与 attr、不同 attr scope 各自成命令', async () => {
    const { ds, tb } = make()
    ds.subscribeTs(dev('d1'), ['P'], () => {})
    ds.subscribeTs(dev('d1'), ['Q'], () => {})
    ds.subscribeTs(dev('d2'), ['P'], () => {})
    ds.subscribeTs({ type: 'ASSET', id: 'd1' }, ['P'], () => {})
    ds.subscribeAttr(dev('d1'), 'SERVER_SCOPE', ['a'], () => {})
    ds.subscribeAttr(dev('d1'), 'SERVER_SCOPE', ['b'], () => {})
    ds.subscribeAttr(dev('d1'), 'SHARED_SCOPE', ['a'], () => {})
    await tick()
    tb.acceptPending()
    const sock = FakeSocket.instances.at(-1)!
    expect(sentOf(sock)).toHaveLength(1)
    expect(tsCmds(sock).map(c => `${c.entityType}/${c.entityId}:${c.keys}`)).toEqual([
      'DEVICE/d1:P,Q',
      'DEVICE/d2:P',
      'ASSET/d1:P',
    ])
    expect(attrCmds(sock).map(c => `${c.scope}:${c.keys}`)).toEqual(['SERVER_SCOPE:a,b', 'SHARED_SCOPE:a'])
    const ids = [...tsCmds(sock), ...attrCmds(sock)].map(c => c.cmdId)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('不同 tick 对同一实体追加订阅:各自成命令,互不影响', async () => {
    const { ds, tb, sock } = await makeOpen()
    const a: TsUpdate[][] = []
    const b: TsUpdate[][] = []
    ds.subscribeTs(dev('d1'), ['P'], u => a.push(u))
    await tick()
    ds.subscribeTs(dev('d1'), ['Q'], u => b.push(u))
    await tick()
    expect(tsCmds(sock).map(c => c.keys)).toEqual(['P', 'Q'])
    expect(tsCmds(sock)[0]!.cmdId).not.toBe(tsCmds(sock)[1]!.cmdId)
    tb.pushTs('d1', 'Q', '5', 1000)
    expect(a).toHaveLength(1) // 只有首帧
    expect(b.at(-1)).toEqual([{ key: 'Q', points: [{ ts: 1000, value: 5 }] }])
  })

  it('合并订阅的回推按 key 分发,互不串值;共用的 key 各收一份', async () => {
    const { ds, tb, sock } = await makeOpen()
    tb.seedTs('d1', 'P', [[10, '1']])
    tb.seedTs('d1', 'Q', [[10, '2']])
    const p: TsUpdate[][] = []
    const q: TsUpdate[][] = []
    const pq: TsUpdate[][] = []
    ds.subscribeTs(dev('d1'), ['P'], u => p.push(u))
    ds.subscribeTs(dev('d1'), ['Q'], u => q.push(u))
    ds.subscribeTs(dev('d1'), ['P', 'Q'], u => pq.push(u))
    await tick()
    expect(tsCmds(sock)).toHaveLength(1)
    // 首帧:一条回推里带全部 key,各订阅者只拿到自己的
    expect(p).toEqual([[{ key: 'P', points: [{ ts: 10, value: 1 }] }]])
    expect(q).toEqual([[{ key: 'Q', points: [{ ts: 10, value: 2 }] }]])
    expect(pq[0]!.map(u => u.key).sort()).toEqual(['P', 'Q'])
    tb.pushTs('d1', 'P', '7', 20)
    expect(p).toHaveLength(2)
    expect(p[1]).toEqual([{ key: 'P', points: [{ ts: 20, value: 7 }] }])
    expect(q).toHaveLength(1) // 没有自己 key 的推送不打扰(也不会收到空数组)
    expect(pq).toHaveLength(2)
    expect(pq[1]).toEqual([{ key: 'P', points: [{ ts: 20, value: 7 }] }])
    tb.pushTs('d1', 'Q', '8', 30)
    expect(p).toHaveLength(2)
    expect(q[1]).toEqual([{ key: 'Q', points: [{ ts: 30, value: 8 }] }])
  })

  it('attr 订阅同理:按 scope 合并,按 key 分发', async () => {
    const { ds, tb, sock } = await makeOpen()
    tb.seedAttr('d1', 'a', '1', 5)
    tb.seedAttr('d1', 'b', '2', 5)
    const a: AttrUpdate[][] = []
    const b: AttrUpdate[][] = []
    ds.subscribeAttr(dev('d1'), 'SERVER_SCOPE', ['a'], u => a.push(u))
    ds.subscribeAttr(dev('d1'), 'SERVER_SCOPE', ['b'], u => b.push(u))
    await tick()
    expect(attrCmds(sock)).toHaveLength(1)
    expect(attrCmds(sock)[0]!.keys).toBe('a,b')
    expect(a).toEqual([[{ scope: 'SERVER_SCOPE', key: 'a', ts: 5, value: 1 }]])
    expect(b).toEqual([[{ scope: 'SERVER_SCOPE', key: 'b', ts: 5, value: 2 }]])
    tb.pushAttr('d1', 'b', '9', 6)
    expect(a).toHaveLength(1)
    expect(b[1]).toEqual([{ scope: 'SERVER_SCOPE', key: 'b', ts: 6, value: 9 }])
  })

  it('其中一个订阅者退订:不发 unsubscribe,其余 key 照常收;全部退订后才发,且带 entityType / entityId', async () => {
    const { ds, tb, sock } = await makeOpen()
    const p: TsUpdate[][] = []
    const q: TsUpdate[][] = []
    const offP = ds.subscribeTs(dev('d1'), ['P'], u => p.push(u))
    const offQ = ds.subscribeTs(dev('d1'), ['Q'], u => q.push(u))
    await tick()
    const cmdId = tsCmds(sock)[0]!.cmdId
    sock.sent.length = 0
    offP()
    offP() // 重复退订无副作用
    await tick()
    expect(sock.sent).toEqual([])
    tb.pushTs('d1', 'P', '1', 100)
    tb.pushTs('d1', 'Q', '2', 100)
    expect(p).toHaveLength(1) // 只有首帧,退订后不再回调
    expect(q.at(-1)).toEqual([{ key: 'Q', points: [{ ts: 100, value: 2 }] }])
    offQ()
    await tick()
    expect(sentOf(sock)).toHaveLength(1)
    expect(tsCmds(sock)).toEqual([
      expect.objectContaining({ cmdId, unsubscribe: true, entityType: 'DEVICE', entityId: 'd1' }),
    ])
    expect(sock.dead).toBe(false)
    const n = q.length
    tb.pushTs('d1', 'Q', '3', 200)
    expect(q).toHaveLength(n)
  })

  it('同 tick 订了又退:还没发出去的直接撤回,不进合并命令', async () => {
    const { ds, sock } = await makeOpen()
    ds.subscribeTs(dev('d1'), ['P'], () => {})
    ds.subscribeTs(dev('d1'), ['Q'], () => {})()
    await tick()
    expect(tsCmds(sock).map(c => c.keys)).toEqual(['P'])
  })

  it('无权访问的实体:合并命令被拒,每个订阅者的 onError 各回调一次', async () => {
    const { ds, tb } = await makeOpen()
    tb.forbidden.add('secret')
    const errs: string[] = []
    ds.subscribeTs(
      dev('secret'),
      ['P'],
      () => {},
      () => errs.push('p')
    )
    ds.subscribeTs(
      dev('secret'),
      ['Q'],
      () => {},
      () => errs.push('q')
    )
    await tick()
    expect(errs).toEqual(['p', 'q'])
  })
})

describe('WS 消息按字节数分片', () => {
  it('400 个不同实体 → 多条消息,每条 ≤ 24000 字节,命令总数 400,全部有回推', async () => {
    const { ds, sock } = await makeOpen()
    let first = 0
    for (let i = 0; i < 400; i++) ds.subscribeTs(dev(uuid(i)), ['开关状态'], () => first++)
    await tick()
    expect(sentOf(sock).length).toBeGreaterThan(1)
    for (const m of sentOf(sock)) expect(bytes(m)).toBeLessThanOrEqual(MAX_WS_MESSAGE_BYTES)
    expect(tsCmds(sock)).toHaveLength(400)
    expect(new Set(tsCmds(sock).map(c => c.entityId)).size).toBe(400)
    expect(first).toBe(400)
  })

  it('400 个测点分布在 67 台设备上 → 67 条命令,一条消息就装得下', async () => {
    const { ds, sock } = await makeOpen()
    for (let i = 0; i < 400; i++) ds.subscribeTs(dev(uuid(i % 67)), [`key_${i}`], () => {})
    await tick()
    expect(tsCmds(sock)).toHaveLength(67)
    expect(sentOf(sock)).toHaveLength(1)
    expect(bytes(sentOf(sock)[0])).toBeLessThanOrEqual(MAX_WS_MESSAGE_BYTES)
  })

  it('断线重连后的重放同样合并、分片;回推继续按 key 分发', async () => {
    const { ds, tb } = make()
    const got = new Map<string, TsUpdate[][]>()
    for (let i = 0; i < 400; i++)
      for (const k of ['P', 'Q']) {
        const arr: TsUpdate[][] = []
        got.set(`${i}/${k}`, arr)
        ds.subscribeTs(dev(uuid(i)), [k], u => arr.push(u))
      }
    const off = ds.subscribeTs(dev(uuid(0)), ['gone'], () => {})
    await tick()
    tb.acceptPending()
    const first = FakeSocket.instances.at(-1)!
    expect(tsCmds(first)).toHaveLength(400)
    off() // 断线前退掉的逻辑订阅,重放时不应再带上它的 key
    await tick()
    tb.dropAll()
    expect(ds.status).toBe('offline')
    await new Promise(r => setTimeout(r, 10))
    tb.acceptPending()
    await tick()
    expect(FakeSocket.instances).toHaveLength(2)
    const second = FakeSocket.instances.at(-1)!
    expect(ds.status).toBe('live')
    expect(sentOf(second).length).toBeGreaterThan(1)
    for (const m of sentOf(second)) expect(bytes(m)).toBeLessThanOrEqual(MAX_WS_MESSAGE_BYTES)
    expect(tsCmds(second)).toHaveLength(400)
    expect(tsCmds(second).every(c => c.keys === 'P,Q' && !c.unsubscribe)).toBe(true)
    tb.pushTs(uuid(399), 'Q', '42', 9_999)
    expect(got.get('399/Q')!.at(-1)).toEqual([{ key: 'Q', points: [{ ts: 9_999, value: 42 }] }])
    expect(got.get('399/P')!).toHaveLength(2) // 首连首帧 + 重连首帧,没被 Q 的推送打扰
  })

  it('含中文 key:按 UTF-8 字节数而不是字符数分片', async () => {
    const { ds, sock } = await makeOpen()
    const key = '母线电压'.repeat(25) // 100 个字符 = 300 字节
    for (let i = 0; i < 60; i++) ds.subscribeTs(dev(uuid(i)), [key], () => {})
    await tick()
    const chars = JSON.stringify({ tsSubCmds: tsCmds(sock), attrSubCmds: [] }).length
    expect(chars).toBeLessThan(MAX_WS_MESSAGE_BYTES) // 按字符数算一条就够……
    expect(sentOf(sock).length).toBeGreaterThan(1) // ……按字节数必须拆
    for (const m of sentOf(sock)) expect(bytes(m)).toBeLessThanOrEqual(MAX_WS_MESSAGE_BYTES)
    expect(tsCmds(sock)).toHaveLength(60)
  })

  it('同一实体的 key 多到一条命令装不下:另起一条命令,仍不超限;单个订阅自己就超限则照发并告警', async () => {
    const { ds, sock } = await makeOpen()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    for (let i = 0; i < 3000; i++) ds.subscribeTs(dev('big'), [`measure_point_${i}`], () => {})
    await tick()
    expect(tsCmds(sock).length).toBeGreaterThan(1)
    for (const m of sentOf(sock)) expect(bytes(m)).toBeLessThanOrEqual(MAX_WS_MESSAGE_BYTES)
    expect(new Set(tsCmds(sock).flatMap(c => c.keys.split(','))).size).toBe(3000)
    expect(warn).not.toHaveBeenCalled()

    sock.sent.length = 0
    ds.subscribeTs(
      dev('huge'),
      Array.from({ length: 3000 }, (_, i) => `measure_point_${i}`),
      () => {}
    )
    ds.subscribeTs(dev('small'), ['P'], () => {})
    await tick()
    expect(warn).toHaveBeenCalledTimes(1)
    expect(sentOf(sock)).toHaveLength(2) // 超限的那条单独成一条消息,不连累别的命令
    expect(sentOf(sock)[0]!.tsSubCmds.map(c => c.entityId)).toEqual(['huge'])
    expect(sentOf(sock)[1]!.tsSubCmds.map(c => c.entityId)).toEqual(['small'])
  })

  it('chunkWsCommands:保持顺序,ts / attr 各归各的数组,空输入不产生消息', () => {
    const cmd = (cmdId: number): WireCmd => ({ entityType: 'DEVICE', entityId: uuid(cmdId), cmdId, keys: 'P' })
    expect(chunkWsCommands([])).toEqual([])
    const items = Array.from({ length: 10 }, (_, i) => ({
      kind: i % 2 ? ('attr' as const) : ('ts' as const),
      cmd: cmd(i),
    }))
    const msgs = chunkWsCommands(items, 400)
    expect(msgs.length).toBeGreaterThan(1)
    for (const m of msgs) expect(bytes(m)).toBeLessThanOrEqual(400)
    expect(
      msgs
        .flatMap(m => [...m.tsSubCmds, ...m.attrSubCmds])
        .map(c => c.cmdId)
        .sort((a, b) => a - b)
    ).toEqual(items.map(i => i.cmd.cmdId))
    expect(msgs.flatMap(m => m.tsSubCmds).every(c => c.cmdId % 2 === 0)).toBe(true)
    expect(msgs.flatMap(m => m.attrSubCmds).every(c => c.cmdId % 2 === 1)).toBe(true)
  })
})
