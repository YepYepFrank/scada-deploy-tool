// 内存版 ThingsBoard:实现渲染器数据层会碰到的 REST 与 WS(tsSubCmds / attrSubCmds)协议子集。
// 与具体 DataSource 实现无关——LegacyDataSource 和同事的 TbClient 都能用它跑 conformance.ts 那套用例。
type Listener = ((ev: { data: string }) => void) | null

export class FakeSocket {
  static instances: FakeSocket[] = []
  readyState = 0
  /** 会话元数据已被 TB 丢弃(收到过不带 entityId 的退订) */
  dead = false
  sent: unknown[] = []
  onopen: (() => void) | null = null
  onmessage: Listener = null
  onclose: (() => void) | null = null
  onerror: (() => void) | null = null
  constructor(public url: string) {
    FakeSocket.instances.push(this)
  }
  send(data: string) {
    this.sent.push(JSON.parse(data))
    FakeSocket.server?.onSend(this, JSON.parse(data))
  }
  close() {
    if (this.readyState === 3) return
    this.readyState = 3
    this.onclose?.()
  }
  /** 测试侧:服务端打开连接 */
  serverOpen() {
    this.readyState = 1
    this.onopen?.()
  }
  serverPush(msg: unknown) {
    this.onmessage?.({ data: JSON.stringify(msg) })
  }
  static server: FakeTb | null = null
}

interface Point {
  ts: number
  value: unknown
}

export class FakeTb {
  /** entityId → key → 点列(升序) */
  ts = new Map<string, Map<string, Point[]>>()
  attrs = new Map<string, Map<string, Point>>()
  alarms = new Map<string, Record<string, unknown>[]>()
  requests: string[] = []
  /** cmdId → {socket, entityId, keys, kind} */
  subs = new Map<number, { socket: FakeSocket; entityId: string; keys: string[]; kind: 'ts' | 'attr' }>()
  token = 'jwt-test'

  constructor() {
    FakeSocket.instances = []
    FakeSocket.server = this
  }

  seedTs(entityId: string, key: string, points: [number, unknown][]) {
    const m = this.ts.get(entityId) ?? new Map()
    m.set(
      key,
      points.map(([ts, value]) => ({ ts, value }))
    )
    this.ts.set(entityId, m)
  }
  seedAttr(entityId: string, key: string, value: unknown, ts = 1_700_000_000_000) {
    const m = this.attrs.get(entityId) ?? new Map()
    m.set(key, { ts, value })
    this.attrs.set(entityId, m)
  }

  /** 服务端收到客户端命令 */
  onSend(socket: FakeSocket, msg: { tsSubCmds?: Record<string, unknown>[]; attrSubCmds?: Record<string, unknown>[] }) {
    if (socket.dead) {
      // TB 实测(CE 4.3.1):不带 entityId 的 unsubscribe 会被当成关闭整个会话,之后该连接上的任何命令都报错
      const n = (msg.tsSubCmds?.length ?? 0) + (msg.attrSubCmds?.length ?? 0)
      for (let i = 0; i < n; i++)
        socket.serverPush({ subscriptionId: 0, errorCode: 1, errorMsg: 'Session meta-data not found!', data: null })
      return
    }
    for (const [kind, cmds] of [
      ['ts', msg.tsSubCmds],
      ['attr', msg.attrSubCmds],
    ] as const) {
      for (const c of cmds ?? []) {
        const cmdId = Number(c.cmdId)
        if (c.unsubscribe) {
          if (!c.entityId) {
            socket.dead = true // TB:无 entityId 的退订 = cleanupWebSocketSession
            for (const [id, s] of this.subs) if (s.socket === socket) this.subs.delete(id)
            continue
          }
          this.subs.delete(cmdId)
          continue
        }
        const keys = String(c.keys ?? '')
          .split(',')
          .filter(Boolean)
        const entityId = String(c.entityId)
        this.subs.set(cmdId, { socket, entityId, keys, kind })
        // TB 订阅即回当前最新值(每 key 一个点;不存在的 key 为 [[ts, null]])
        const data: Record<string, [number, unknown][]> = {}
        for (const k of keys) {
          if (kind === 'ts') {
            const pts = this.ts.get(entityId)?.get(k)
            const last = pts?.[pts.length - 1]
            data[k] = last ? [[last.ts, String(last.value)]] : [[Date.now(), null]]
          } else {
            const a = this.attrs.get(entityId)?.get(k)
            if (a) data[k] = [[a.ts, String(a.value)]]
          }
        }
        socket.serverPush({ subscriptionId: cmdId, errorCode: 0, errorMsg: null, data })
      }
    }
  }

  /** 模拟设备上报:落库并推给订阅者 */
  pushTs(entityId: string, key: string, value: unknown, ts = Date.now()) {
    const m = this.ts.get(entityId) ?? new Map()
    const arr = m.get(key) ?? []
    arr.push({ ts, value })
    m.set(key, arr)
    this.ts.set(entityId, m)
    for (const [cmdId, s] of this.subs)
      if (s.kind === 'ts' && s.entityId === entityId && s.keys.includes(key) && s.socket.readyState === 1)
        s.socket.serverPush({
          subscriptionId: cmdId,
          errorCode: 0,
          errorMsg: null,
          data: { [key]: [[ts, String(value)]] },
        })
  }
  pushAttr(entityId: string, key: string, value: unknown, ts = Date.now()) {
    this.seedAttr(entityId, key, value, ts)
    for (const [cmdId, s] of this.subs)
      if (s.kind === 'attr' && s.entityId === entityId && s.keys.includes(key) && s.socket.readyState === 1)
        s.socket.serverPush({
          subscriptionId: cmdId,
          errorCode: 0,
          errorMsg: null,
          data: { [key]: [[ts, String(value)]] },
        })
  }

  /** 服务端主动断开全部连接(模拟网络中断) */
  dropAll() {
    for (const s of FakeSocket.instances) if (s.readyState === 1) s.close()
    this.subs.clear()
  }
  /** 打开所有待接受的连接 */
  acceptPending() {
    for (const s of FakeSocket.instances) if (s.readyState === 0) s.serverOpen()
  }

  /** REST */
  fetch: typeof fetch = async (input, init) => {
    const url = String(input)
    this.requests.push(url)
    const auth = (init?.headers as Record<string, string> | undefined)?.['X-Authorization']
    const u = new URL(url, 'http://tb')
    const json = (body: unknown, status = 200) =>
      new Response(body === null ? '' : JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
      })
    if (auth !== `Bearer ${this.token}`) return json({ message: 'Authentication failed' }, 401)
    let m: RegExpMatchArray | null
    if ((m = u.pathname.match(/^\/api\/plugins\/telemetry\/(DEVICE|ASSET)\/([^/]+)\/values\/timeseries$/))) {
      const entityId = m[2]!
      const keys = (u.searchParams.get('keys') ?? '').split(',').filter(Boolean)
      const start = u.searchParams.get('startTs')
      const end = u.searchParams.get('endTs')
      const agg = u.searchParams.get('agg') ?? 'NONE'
      const interval = Number(u.searchParams.get('interval') ?? 0)
      const out: Record<string, { ts: number; value: unknown }[]> = {}
      for (const k of keys) {
        const pts = this.ts.get(entityId)?.get(k) ?? []
        if (!start) {
          // latest:不存在的 key 返回 [{ts, value: null}](TB 真实行为)
          const last = pts[pts.length - 1]
          out[k] = last ? [{ ts: last.ts, value: String(last.value) }] : [{ ts: Date.now(), value: null }]
          continue
        }
        let sel = pts.filter(p => p.ts >= Number(start) && p.ts <= Number(end))
        if (agg !== 'NONE' && interval > 0) {
          // 按桶平均,桶起点对齐 startTs
          const buckets = new Map<number, number[]>()
          for (const p of sel) {
            const b = Number(start) + Math.floor((p.ts - Number(start)) / interval) * interval
            ;(buckets.get(b) ?? buckets.set(b, []).get(b)!).push(Number(p.value))
          }
          sel = [...buckets].map(([ts, vs]) => ({ ts, value: vs.reduce((a, b) => a + b, 0) / vs.length }))
        }
        // TB 返回降序
        out[k] = sel.map(p => ({ ts: p.ts, value: String(p.value) })).sort((a, b) => b.ts - a.ts)
      }
      return json(out)
    }
    if ((m = u.pathname.match(/^\/api\/alarm\/(DEVICE|ASSET)\/([^/]+)$/))) {
      const list = this.alarms.get(m[2]!) ?? []
      return json({ data: list, totalElements: list.length, hasNext: false })
    }
    return json({ message: `fake-tb: unknown ${u.pathname}` }, 404)
  }
}
