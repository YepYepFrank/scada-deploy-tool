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
  ExtInterval,
  ExtQuery,
  ExtResult,
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
  /**
   * kz 归档服务地址(ADR-004 路线 A,`mode: 'ext'`),如 '/kz'(同源反代)或 'http://host:8099';结尾不带 /。
   * 不给则 `ext()` 抛「kz 未配置」,渲染器把对应组件置为错误态。kz 用同一个 TB token 鉴权。
   */
  kzBaseUrl?: string
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

/**
 * kz 通用历史查询(ADR-004,第三轮回填 2026-09-06,接口文档 `TB汇总业务-接口_20260818002.docx`):
 * GET {kz}/kzserver/tskv/{桶}/telemetry/{entityType}/{entityId}/values/timeseries?keys=&startTs=&endTs=&interval=&agg=
 * 契约 interval → kz 路径段与 interval 毫秒(月 / 年按文档参数表:30 天 / 366 天)。
 */
export const KZ_BUCKETS: Record<ExtInterval, { path: string; intervalMs: number }> = {
  '1m': { path: 'minute', intervalMs: 60_000 },
  '5m': { path: 'minutefive', intervalMs: 300_000 },
  '1h': { path: 'hour', intervalMs: 3_600_000 },
  '1d': { path: 'day', intervalMs: 86_400_000 },
  '1M': { path: 'month', intervalMs: 30 * 86_400_000 },
  '1y': { path: 'year', intervalMs: 366 * 86_400_000 },
}
/** 没给 interval 时按窗口选粒度:≤2h 1 分钟;≤24h 5 分钟;≤7d 1 小时;≤90d 1 天;更长逐月 */
export function defaultKzInterval(windowMs: number): ExtInterval {
  if (windowMs <= 2 * 3_600_000) return '1m'
  if (windowMs <= 24 * 3_600_000) return '5m'
  if (windowMs <= 7 * 86_400_000) return '1h'
  if (windowMs <= 90 * 86_400_000) return '1d'
  return '1M'
}
/** kz 归档历史支持的聚合(编辑器的下拉也用这一份,免得两边枚举漂移) */
export const KZ_AGGS = new Set(['AVG', 'MAX', 'MIN', 'ZD'])

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

  /**
   * 外部源 kz(契约 §4.3b)。两种查询按 params 分派:
   * - 通用历史 `{ entity, keys, agg? }`:GET /kzserver/tskv/{桶}/telemetry/…(第三轮回填定稿),任意实体 + 任意 key,
   *   窗口 → startTs/endTs(毫秒,默认 30d 到现在),interval → 路径段(缺省按窗口选),agg ∈ AVG/MAX/MIN/ZD(默认 AVG)。
   *   series 就是 data 里「量名 → 升序点列」;meta { bucket, agg, startTs, endTs }。
   * - 收益趋势 `{ stationId, metric? }`:POST /kzserver/biz/power/stationRevenueTrend(反编译确认 queryType=2 本月逐日、3 本年逐月,
   *   日期范围由服务端时钟决定);本月没归档时降级为逐月(meta.mode);序列 inc / cost / net。
   */
  async ext(query: ExtQuery): Promise<ExtResult> {
    if (query.source !== 'kz') throw new Error(`不支持的外部源「${query.source}」(一期只有 kz)`)
    const kz = this.opts.kzBaseUrl
    if (!kz) throw new Error('kz 未配置:LegacyDataSource.kzBaseUrl(大屏 ?kz=)为空')
    const token = await this.opts.getToken()
    if (Array.isArray(query.params?.keys)) return this.kzTskv(kz, token, query)
    const stationId = query.params?.stationId
    if (!stationId) throw new Error('ext(kz) 缺 params:通用查询要 { entity, keys },收益趋势要 { stationId }')
    type Row = { statDate: string; dischargeIncome?: unknown; chargeCost?: unknown; netProfit?: unknown }
    const fetchRows = async (queryType: 2 | 3): Promise<Row[]> => {
      const r = await this.fetchImpl(`${kz}/kzserver/biz/power/stationRevenueTrend`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Authorization': `Bearer ${token}` },
        body: JSON.stringify({ queryType, stationId }),
      })
      if (!r.ok) throw new Error(`kz → HTTP ${r.status}`)
      const j = (await r.json()) as { code?: number; msg?: string; data?: Row[] }
      if (j.code !== 200) throw new Error(j.msg || 'kz 报表查询失败')
      return j.data ?? []
    }
    let mode: 'day' | 'month' = query.interval === '1M' || query.interval === '1y' ? 'month' : 'day'
    let rows = await fetchRows(mode === 'month' ? 3 : 2)
    if (!rows.length && mode === 'day') {
      rows = await fetchRows(3)
      mode = 'month'
    }
    const ts = (d: string) => new Date((d.length === 7 ? `${d}-01` : d) + 'T00:00:00+08:00').getTime()
    const num = (v: unknown) => (v === null || v === undefined || v === '' ? null : Number(v))
    const pick = (f: keyof Row): TsPoint[] => rows.map(r => ({ ts: ts(String(r.statDate)), value: num(r[f]) }))
    const all: Record<string, TsPoint[]> = {
      inc: pick('dischargeIncome'),
      cost: pick('chargeCost'),
      net: pick('netProfit'),
    }
    const metric = query.params?.metric
    const series = typeof metric === 'string' && all[metric] ? { [metric]: all[metric]! } : all
    return { series, meta: { mode, rows: rows.length } }
  }

  private async kzTskv(kz: string, token: string, query: ExtQuery): Promise<ExtResult> {
    const p = query.params as { entity?: EntityRef; keys: unknown[]; agg?: unknown; startTs?: unknown; endTs?: unknown }
    const entity = p.entity
    if (!entity?.type || !entity.id) throw new Error('ext(kz) 通用查询缺 params.entity { type, id }')
    const keys = p.keys.map(String).filter(Boolean)
    if (!keys.length) throw new Error('ext(kz) 通用查询 params.keys 为空')
    const endTs = typeof p.endTs === 'number' ? p.endTs : Date.now()
    const windowMs = parseWindow(query.window ?? '30d')
    const startTs = typeof p.startTs === 'number' ? p.startTs : endTs - windowMs
    const interval = query.interval ?? defaultKzInterval(endTs - startTs)
    const bucket = KZ_BUCKETS[interval]
    if (!bucket) throw new Error(`ext(kz) 不支持的粒度「${String(interval)}」`)
    const agg = typeof p.agg === 'string' && KZ_AGGS.has(p.agg) ? p.agg : 'AVG'
    const qs = new URLSearchParams({
      keys: keys.join(','),
      startTs: String(startTs),
      endTs: String(endTs),
      interval: String(bucket.intervalMs),
      agg,
    })
    const r = await this.fetchImpl(
      `${kz}/kzserver/tskv/${bucket.path}/telemetry/${entity.type}/${entity.id}/values/timeseries?${qs}`,
      { headers: { 'X-Authorization': `Bearer ${token}` } }
    )
    if (!r.ok) throw new Error(`kz → HTTP ${r.status}`)
    const j = (await r.json()) as {
      code?: number
      msg?: string
      data?: Record<string, { ts: number; value: unknown }[]>
    }
    if (j.code !== 200) throw new Error(j.msg || 'kz 历史查询失败')
    const series: Record<string, TsPoint[]> = {}
    for (const k of keys)
      series[k] = (j.data?.[k] ?? [])
        .map(pt => ({ ts: Number(pt.ts), value: normalizeValue(pt.value) }))
        .sort((a, b) => a.ts - b.ts)
    return { series, meta: { bucket: bucket.path, agg, startTs, endTs } }
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
