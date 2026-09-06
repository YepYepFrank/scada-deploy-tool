/**
 * LegacyDataSource —— T1.1 预案:用现有向导同一套 TB 调用(REST + `/api/ws/plugins/telemetry` 的
 * tsSubCmds / attrSubCmds 协议,见 apps/deploy-tool/src/composables/useTelemetry.js)临时实现 DataSource,
 * 让渲染器在同事的 TbClient 交付前就能吃镜像真数据。
 *
 * 刻意保持薄:一条 WS、断线 3 秒后重连并重放订阅、告警走 REST 轮询;不做限流、不做 token 刷新
 * (token 由宿主通过 getToken 提供)。同事版到位后整个文件删除,test/conformance.ts 那套用例照跑。
 */
import type {
  AlarmInfo,
  AttrUpdate,
  AttributeScope,
  Aggregation,
  ConnectionStatus,
  DataSource,
  EntityRef,
  TsPoint,
  TsUpdate,
  Unsubscribe,
} from './data-source'
import { parseWindow } from './data-source'

export interface LegacyDataSourceOptions {
  /** REST 根,如 '' (走 Vite 代理)或 'http://192.168.20.61:8080';结尾不带 / */
  baseUrl: string
  /** 取 JWT;宿主负责登录与刷新 */
  getToken: () => string | Promise<string>
  /** WS 地址;缺省由 baseUrl(或当前页面 origin)推出 */
  wsUrl?: string
  /** 告警轮询周期,毫秒(默认 10 秒) */
  alarmPollMs?: number
  /** 断线重连间隔,毫秒(默认 3 秒) */
  reconnectMs?: number
  /** 依赖注入,测试用 */
  fetchImpl?: typeof fetch
  WebSocketImpl?: typeof WebSocket
  setTimeoutImpl?: (fn: () => void, ms: number) => unknown
  clearTimeoutImpl?: (timer: unknown) => void
}

/** 历史查询的自适应粒度(契约 §4.2):窗口 ≤2h 原始点;2h–24h 5 分钟;24h–7d 1 小时;>7d 1 天 */
export const HISTORY_BUCKETS: { maxWindowMs: number; intervalMs: number }[] = [
  { maxWindowMs: 2 * 3_600_000, intervalMs: 0 },
  { maxWindowMs: 24 * 3_600_000, intervalMs: 300_000 },
  { maxWindowMs: 7 * 86_400_000, intervalMs: 3_600_000 },
  { maxWindowMs: Infinity, intervalMs: 86_400_000 },
]

/** TB 推的值是字符串:数值串转 number,true/false 转 boolean,其余原样;null 透传 */
export function normalizeValue(raw: unknown): TsPoint['value'] {
  if (raw === null || raw === undefined) return null
  if (typeof raw === 'number' || typeof raw === 'boolean') return raw
  if (typeof raw !== 'string') return String(raw)
  const s = raw.trim()
  if (s === 'true') return true
  if (s === 'false') return false
  if (s !== '' && /^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/.test(s)) return Number(s)
  return raw
}

type WsData = Record<string, [number, unknown][]>
interface Sub {
  cmdId: number
  kind: 'ts' | 'attr'
  entity: EntityRef
  scope?: AttributeScope
  keys: string[]
  cb: (data: WsData) => void
  /** TB 对这条订阅回 errorCode≠0(如无权访问实体)时回调一次 */
  onError?: (err: Error) => void
}

export class LegacyDataSource implements DataSource {
  private _status: ConnectionStatus = 'connecting'
  private statusCbs = new Set<(s: ConnectionStatus) => void>()
  private subs = new Map<number, Sub>()
  private nextCmdId = 1
  private ws: WebSocket | null = null
  private wsOpen = false
  private closed = false
  private reconnectTimer: unknown = null
  private pendingSubs: Sub[] = []
  private pendingUnsubs: Sub[] = []
  private flushScheduled = false
  private tbErrors = 0
  private readonly fetchImpl: typeof fetch
  private readonly WS: typeof WebSocket
  private readonly setT: (fn: () => void, ms: number) => unknown
  private readonly clearT: (timer: unknown) => void

  constructor(private readonly opts: LegacyDataSourceOptions) {
    this.fetchImpl = opts.fetchImpl ?? ((...a) => fetch(...a))
    this.WS = opts.WebSocketImpl ?? WebSocket
    this.setT = opts.setTimeoutImpl ?? ((fn, ms) => setTimeout(fn, ms))
    this.clearT = opts.clearTimeoutImpl ?? (t => clearTimeout(t as ReturnType<typeof setTimeout>))
  }

  get status(): ConnectionStatus {
    return this._status
  }

  onStatus(cb: (status: ConnectionStatus) => void): Unsubscribe {
    this.statusCbs.add(cb)
    return () => this.statusCbs.delete(cb)
  }

  /** 关闭 WS 与轮询;之后不再重连 */
  dispose(): void {
    this.closed = true
    if (this.reconnectTimer) this.clearT(this.reconnectTimer)
    this.subs.clear()
    this.ws?.close()
    this.ws = null
  }

  // ---------- 订阅 ----------

  subscribeTs(
    entity: EntityRef,
    keys: string[],
    cb: (updates: TsUpdate[]) => void,
    onError?: (err: Error) => void
  ): Unsubscribe {
    return this.addSub({
      cmdId: this.nextCmdId++,
      kind: 'ts',
      entity,
      keys,
      cb: data => cb(toTsUpdates(data, keys)),
      onError,
    })
  }

  subscribeAttr(
    entity: EntityRef,
    scope: AttributeScope,
    keys: string[],
    cb: (updates: AttrUpdate[]) => void,
    onError?: (err: Error) => void
  ): Unsubscribe {
    return this.addSub({
      cmdId: this.nextCmdId++,
      kind: 'attr',
      entity,
      scope,
      keys,
      onError,
      cb: data =>
        cb(
          Object.entries(data)
            .filter(([k]) => keys.includes(k))
            .map(([key, arr]) => ({ scope, key, ts: arr[0]?.[0] ?? Date.now(), value: normalizeValue(arr[0]?.[1]) }))
        ),
    })
  }

  subscribeAlarms(
    entity: EntityRef,
    types: string[] | undefined,
    cb: (alarms: AlarmInfo[]) => void,
    onError?: (err: Error) => void
  ): Unsubscribe {
    let timer: unknown = null
    let stopped = false
    const poll = async () => {
      if (stopped) return
      try {
        const page = (await this.rest(
          `/api/alarm/${entity.type}/${entity.id}?pageSize=100&page=0&searchStatus=ACTIVE&sortProperty=createdTime&sortOrder=DESC`
        )) as { data?: Record<string, unknown>[] } | null
        let alarms = (page?.data ?? []).map(toAlarmInfo)
        if (types?.length) alarms = alarms.filter(a => types.includes(a.type))
        if (!stopped) cb(alarms)
      } catch (e) {
        /* 轮询失败保留上次结果;连接状态由 WS 反映。403(无权访问实体)通知一次,之后不再重试 */
        const text = e instanceof Error ? e.message : String(e)
        if (/HTTP 403/.test(text)) {
          stopped = true
          onError?.(new Error(`告警订阅被拒绝:${text}`))
          return
        }
      }
      if (!stopped) timer = this.setT(poll, this.opts.alarmPollMs ?? 10_000)
    }
    void poll()
    return () => {
      stopped = true
      if (timer) this.clearT(timer)
    }
  }

  // ---------- 查询 ----------

  async getHistory(
    entity: EntityRef,
    keys: string[],
    window: string,
    agg?: Aggregation
  ): Promise<Record<string, TsPoint[]>> {
    const ms = parseWindow(window)
    const endTs = Date.now()
    const startTs = endTs - ms
    const bucket = HISTORY_BUCKETS.find(b => ms <= b.maxWindowMs)!
    const effAgg: Aggregation = agg ?? (bucket.intervalMs ? 'AVG' : 'NONE')
    const q = new URLSearchParams({
      keys: keys.join(','),
      startTs: String(startTs),
      endTs: String(endTs),
      limit: '5000',
      agg: effAgg,
    })
    if (effAgg !== 'NONE') q.set('interval', String(bucket.intervalMs || 300_000))
    const raw = (await this.rest(
      `/api/plugins/telemetry/${entity.type}/${entity.id}/values/timeseries?${q}`
    )) as Record<string, { ts: number; value: unknown }[]>
    const out: Record<string, TsPoint[]> = {}
    for (const k of keys)
      out[k] = (raw?.[k] ?? []).map(p => ({ ts: p.ts, value: normalizeValue(p.value) })).sort((a, b) => a.ts - b.ts)
    return out
  }

  async getLatest(entity: EntityRef, keys: string[]): Promise<Record<string, TsPoint | null>> {
    const raw = (await this.rest(
      `/api/plugins/telemetry/${entity.type}/${entity.id}/values/timeseries?keys=${encodeURIComponent(keys.join(','))}`
    )) as Record<string, { ts: number; value: unknown }[]>
    const out: Record<string, TsPoint | null> = {}
    for (const k of keys) {
      const p = raw?.[k]?.[0]
      out[k] = p && p.value !== null && p.value !== undefined ? { ts: p.ts, value: normalizeValue(p.value) } : null
    }
    return out
  }

  // ---------- 内部:REST ----------

  private async rest(path: string): Promise<unknown> {
    const token = await this.opts.getToken()
    const r = await this.fetchImpl(this.opts.baseUrl + path, {
      headers: { 'X-Authorization': `Bearer ${token}` },
    })
    if (!r.ok) throw new Error(`${path.split('?')[0]} → HTTP ${r.status}`)
    const text = await r.text()
    return text ? JSON.parse(text) : null
  }

  // ---------- 内部:WS ----------

  private addSub(sub: Sub): Unsubscribe {
    this.subs.set(sub.cmdId, sub)
    if (this.wsOpen) {
      this.pendingSubs.push(sub)
      this.scheduleFlush()
    } else this.ensureWs()
    return () => {
      if (!this.subs.delete(sub.cmdId)) return
      const i = this.pendingSubs.indexOf(sub)
      if (i >= 0) {
        this.pendingSubs.splice(i, 1) // 还没发出去,直接撤回
        return
      }
      if (this.wsOpen) {
        this.pendingUnsubs.push(sub)
        this.scheduleFlush()
      }
    }
  }

  private scheduleFlush() {
    if (this.flushScheduled) return
    this.flushScheduled = true
    queueMicrotask(() => {
      this.flushScheduled = false
      this.flush()
    })
  }

  /**
   * 同一 tick 内的订阅变更合并成一条消息(渲染器切配置时是「dispose 全部 → 立刻重订」的模式,
   * 合并后一次往返);没有任何订阅时关掉连接,下次订阅重开,不留空闲 WS。
   */
  private flush() {
    const subs = this.pendingSubs
    const unsubs = this.pendingUnsubs
    this.pendingSubs = []
    this.pendingUnsubs = []
    if (!this.wsOpen || !this.ws) return
    if (this.subs.size === 0) {
      this.idleClose()
      return
    }
    if (subs.length || unsubs.length)
      this.send(merge([...subs.map(s => subCmd(s)), ...unsubs.map(s => subCmd(s, true))]))
  }

  private idleClose() {
    const ws = this.ws
    this.ws = null
    this.wsOpen = false
    if (ws) {
      ws.onclose = null
      ws.onerror = null
      ws.close()
    }
  }

  private send(msg: unknown) {
    this.ws?.send(JSON.stringify(msg))
  }

  private setStatus(s: ConnectionStatus) {
    if (this._status === s) return
    this._status = s
    for (const cb of this.statusCbs) cb(s)
  }

  private ensureWs() {
    if (this.ws || this.closed) return
    this.setStatus('connecting')
    void this.openWs()
  }

  private async openWs() {
    let token: string
    try {
      token = await this.opts.getToken()
    } catch {
      this.scheduleReconnect()
      return
    }
    if (this.closed || this.ws) return
    const ws = new this.WS(`${this.wsBase()}/api/ws/plugins/telemetry?token=${encodeURIComponent(token)}`)
    this.ws = ws
    ws.onopen = () => {
      this.wsOpen = true
      this.setStatus('live')
      // 重放全部订阅(首连与重连同一路径)
      this.pendingSubs = []
      this.pendingUnsubs = []
      const cmds = [...this.subs.values()]
      if (cmds.length) this.send(merge(cmds.map(s => subCmd(s))))
    }
    ws.onmessage = ev => {
      let msg: { subscriptionId?: number; data?: WsData; errorCode?: number; errorMsg?: string }
      try {
        msg = JSON.parse(String(ev.data))
      } catch {
        return
      }
      if (msg.errorCode && this.tbErrors++ < 3)
        console.warn('[LegacyDataSource] TB:', msg.errorMsg, 'cmdId', msg.subscriptionId)
      if (msg.subscriptionId === undefined) return
      const sub = this.subs.get(msg.subscriptionId)
      if (!sub) return
      if (msg.errorCode) {
        // TB 对这条订阅明确拒绝(CE 4.3.1 实测:CUSTOMER_USER 订阅未分配实体回 errorCode 1「Failed to fetch data!」);只通知一次
        const onError = sub.onError
        sub.onError = undefined
        onError?.(new Error(`TB 订阅被拒绝(${msg.errorCode}):${msg.errorMsg ?? ''}`.trim()))
        return
      }
      if (!msg.data) return
      sub.cb(msg.data)
    }
    ws.onclose = () => {
      this.wsOpen = false
      this.ws = null
      if (this.closed) return
      this.setStatus('offline')
      this.scheduleReconnect()
    }
    ws.onerror = () => ws.close()
  }

  private scheduleReconnect() {
    if (this.closed || this.reconnectTimer) return
    this.reconnectTimer = this.setT(() => {
      this.reconnectTimer = null
      if (this.subs.size) this.ensureWs()
    }, this.opts.reconnectMs ?? 3000)
  }

  private wsBase(): string {
    if (this.opts.wsUrl) return this.opts.wsUrl
    const b = this.opts.baseUrl
    if (/^https?:\/\//i.test(b)) return b.replace(/^http/i, 'ws')
    const loc = typeof location !== 'undefined' ? location : { protocol: 'http:', host: 'localhost' }
    return `${loc.protocol === 'https:' ? 'wss' : 'ws'}://${loc.host}${b}`
  }
}

// ---------- 协议映射 ----------

/**
 * 退订命令必须带 entityType / entityId:TB 把「没有 entityId 的 unsubscribe」当成关闭整个 WS 会话
 * (DefaultWebSocketService.unsubscribe → cleanupWebSocketSession),之后同一连接上的所有命令都回
 * "Session meta-data not found!"。镜像 CE 4.3.1 实测,2026-09-05。
 */
function subCmd(s: Sub, unsubscribe = false) {
  const cmd = {
    entityType: s.entity.type,
    entityId: s.entity.id,
    cmdId: s.cmdId,
    keys: s.keys.join(','),
    ...(s.kind === 'ts' ? { scope: 'LATEST_TELEMETRY' } : { scope: s.scope }),
    ...(unsubscribe ? { unsubscribe: true } : {}),
  }
  return s.kind === 'ts' ? { tsSubCmds: [cmd] } : { attrSubCmds: [cmd] }
}

function merge(msgs: { tsSubCmds?: unknown[]; attrSubCmds?: unknown[] }[]) {
  const out: { tsSubCmds: unknown[]; attrSubCmds: unknown[] } = { tsSubCmds: [], attrSubCmds: [] }
  for (const m of msgs) {
    if (m.tsSubCmds) out.tsSubCmds.push(...m.tsSubCmds)
    if (m.attrSubCmds) out.attrSubCmds.push(...m.attrSubCmds)
  }
  return out
}

function toTsUpdates(data: WsData, keys: string[]): TsUpdate[] {
  const out: TsUpdate[] = []
  for (const [key, arr] of Object.entries(data)) {
    if (!keys.includes(key) || !Array.isArray(arr)) continue
    out.push({
      key,
      points: arr.map(([ts, v]) => ({ ts, value: normalizeValue(v) })).sort((a, b) => a.ts - b.ts),
    })
  }
  return out
}

function toAlarmInfo(a: Record<string, unknown>): AlarmInfo {
  const id = a.id as { id: string }
  const orig = a.originator as { entityType: string; id: string }
  const status =
    (a.status as AlarmInfo['status'] | undefined) ??
    (((a.cleared ? 'CLEARED_' : 'ACTIVE_') + (a.acknowledged ? 'ACK' : 'UNACK')) as AlarmInfo['status'])
  return {
    id: id.id,
    type: String(a.type),
    severity: a.severity as AlarmInfo['severity'],
    status,
    startTs: Number(a.startTs ?? a.createdTime),
    ...(a.endTs ? { endTs: Number(a.endTs) } : {}),
    originator: { type: orig.entityType as EntityRef['type'], id: orig.id },
    ...(a.originatorName ? { originatorName: String(a.originatorName) } : {}),
    ...(a.details && typeof a.details === 'object' ? { details: a.details as Record<string, unknown> } : {}),
  }
}
