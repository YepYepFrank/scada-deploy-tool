/**
 * LegacyDataSource —— T1.1 预案:用现有向导同一套 TB 调用(REST + `/api/ws/plugins/telemetry` 的
 * tsSubCmds / attrSubCmds 协议,见 apps/deploy-tool/src/composables/useTelemetry.js)临时实现 DataSource,
 * 让渲染器在同事的 TbClient 交付前就能吃镜像真数据。
 *
 * 刻意保持薄:一条 WS、断线 3 秒后重连并重放订阅、告警走 REST 轮询;不做限流、不做 token 刷新
 * (token 由宿主通过 getToken 提供;刷新也归宿主,见部署工具 `standalone/session.ts`)。
 * WS 订阅按实体合并 + 按字节数分片发送(T5.4,TB 入站单条消息上限 32768 字节,见 MAX_WS_MESSAGE_BYTES)。
 * **2026-09-09 起不再计划删除**:同事的 TbClient 在她的内网仓库、我们的 CI 是 GitHub 跑机拉不到,
 * 挪进本仓库对她是绕一圈;两份实现的行为一致由 test/conformance.ts 那套用例保证。
 * 定位从「T1.1 临时预案」改为「部署工具(编辑器预览 / 独立大屏 / 渲染器 /dev)自用的数据源」。
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
  TimeRange,
  TsPoint,
  TsUpdate,
  Unsubscribe,
} from './data-source'
import { parseWindow, resolveTimeRange } from './data-source'

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

/**
 * 发往 TB WS 的单条消息字节上限(UTF-8 字节,不是字符数)。TB 入站文本消息上限是
 * `server.ws.max_text_message_buffer_size`,缺省 32768,超了直接以 1009 关连接(2026-09-18 实测,
 * docs/给同事的-WS订阅单条消息上限-2026-09-18.md);留出余量取 24000。
 */
export const MAX_WS_MESSAGE_BYTES = 24000

type WsData = Record<string, [number, unknown][]>
/** 逻辑订阅:一次 subscribeTs / subscribeAttr 调用。与 WS 命令解耦——同实体同 scope 的多个逻辑订阅挂在一条 WsCmd 下 */
interface Sub {
  kind: 'ts' | 'attr'
  entity: EntityRef
  scope?: AttributeScope
  keys: string[]
  cb: (data: WsData) => void
  /** TB 对这条订阅回 errorCode≠0(如无权访问实体)时回调一次 */
  onError?: (err: Error) => void
  /** 当前连接上承载它的 WS 命令;还没发出去(排队中 / 未连上)为 null */
  cmd: WsCmd | null
}
/** 一条已发给 TB 的订阅命令(一个 cmdId):keys 是成员 keys 的并集;成员全部退订后才发 unsubscribe */
interface WsCmd {
  cmdId: number
  kind: 'ts' | 'attr'
  entity: EntityRef
  scope?: AttributeScope
  keys: string[]
  members: Set<Sub>
}
/** 线上格式的一条命令 */
export interface WireCmd {
  entityType: string
  entityId: string
  cmdId: number
  keys: string
  scope?: string
  unsubscribe?: true
}
/** 线上格式的一条消息 */
export interface WsMessage {
  tsSubCmds: WireCmd[]
  attrSubCmds: WireCmd[]
}

export class LegacyDataSource implements DataSource {
  private _status: ConnectionStatus = 'connecting'
  private statusCbs = new Set<(s: ConnectionStatus) => void>()
  /** 存活的逻辑订阅(重连重放以它为准) */
  private subs = new Set<Sub>()
  /** 当前连接上已发出的 WS 命令,cmdId → 命令;换连接即清空重建 */
  private cmds = new Map<number, WsCmd>()
  private nextCmdId = 1
  private ws: WebSocket | null = null
  private wsOpen = false
  private closed = false
  private reconnectTimer: unknown = null
  private pendingSubs: Sub[] = []
  private pendingUnsubs: WsCmd[] = []
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
    this.cmds.clear()
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
      kind: 'ts',
      entity,
      keys,
      cb: data => cb(toTsUpdates(data, keys)),
      onError,
      cmd: null,
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
      kind: 'attr',
      entity,
      scope,
      keys,
      onError,
      cmd: null,
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
    window: TimeRange,
    agg?: Aggregation
  ): Promise<Record<string, TsPoint[]>> {
    // 「最近 N」与绝对区间 { from, to } 统一成 startTs / endTs;桶宽按区间长度选
    const { startTs, endTs } = resolveTimeRange(window)
    const ms = endTs - startTs
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
    // 起止时间的优先级:query.range(绝对区间,2026-09-21)> params.startTs / endTs(旧写法)> window(最近 N)
    const endTs = query.range ? query.range.to : typeof p.endTs === 'number' ? p.endTs : Date.now()
    const windowMs = parseWindow(query.window ?? '30d')
    const startTs = query.range ? query.range.from : typeof p.startTs === 'number' ? p.startTs : endTs - windowMs
    if (startTs >= endTs) throw new Error('ext(kz) 起始时间必须早于结束时间')
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
    this.subs.add(sub)
    if (this.wsOpen) {
      this.pendingSubs.push(sub)
      this.scheduleFlush()
    } else this.ensureWs()
    return () => {
      if (!this.subs.delete(sub)) return
      const i = this.pendingSubs.indexOf(sub)
      if (i >= 0) {
        this.pendingSubs.splice(i, 1) // 还没发出去,直接撤回
        return
      }
      // 从承载它的 WS 命令上摘下来;同命令下还有别的订阅者就什么都不发(别人的 key 不能跟着退),
      // 全部摘完才退订这条命令。摘掉的 key TB 仍会推,分发时按各订阅者自己的 keys 过滤掉。
      const cmd = sub.cmd
      sub.cmd = null
      if (!cmd) return
      cmd.members.delete(sub)
      if (cmd.members.size > 0 || !this.cmds.delete(cmd.cmdId)) return
      if (this.wsOpen) {
        this.pendingUnsubs.push(cmd)
        this.scheduleFlush()
      }
    }
  }

  /**
   * 把一批逻辑订阅按「kind + entityType + entityId + scope」合并成 WS 命令(keys 去重并集,一组一个 cmdId)、
   * 登记到 this.cmds 并回填 sub.cmd。只在同一批内合并:不往已发出的命令里追加 key(TB 没有「改订阅」的命令)。
   * 合并后单条命令自己就要超限时,同一实体另起一条命令,保证分片一定切得开。
   */
  private buildCmds(subs: Iterable<Sub>): WsCmd[] {
    const open = new Map<string, { cmd: WsCmd; seen: Set<string>; bytes: number }>()
    const out: WsCmd[] = []
    for (const sub of subs) {
      const gk = `${sub.kind}|${sub.entity.type}|${sub.entity.id}|${sub.kind === 'ts' ? '' : sub.scope}`
      let g = open.get(gk)
      const seen = g?.seen
      const extra = sub.keys.reduce((n, k) => (seen?.has(k) ? n : n + keyBytes(k) + 1), 0)
      if (!g || g.bytes + extra > MAX_WS_MESSAGE_BYTES - ENVELOPE_BYTES) {
        const cmd: WsCmd = {
          cmdId: this.nextCmdId++,
          kind: sub.kind,
          entity: sub.entity,
          scope: sub.scope,
          keys: [],
          members: new Set(),
        }
        g = { cmd, seen: new Set(), bytes: utf8Bytes(JSON.stringify(wireCmd(cmd))) + 1 }
        open.set(gk, g)
        out.push(cmd)
        this.cmds.set(cmd.cmdId, cmd)
      }
      for (const k of sub.keys) {
        if (g.seen.has(k)) continue
        g.seen.add(k)
        g.cmd.keys.push(k)
        g.bytes += keyBytes(k) + 1
      }
      g.cmd.members.add(sub)
      sub.cmd = g.cmd
    }
    return out
  }

  /** 订阅 / 退订命令的唯一出口:首发(flush)与重连重放都走这里,按字节数分片后连续发送 */
  private sendCmds(subscribe: WsCmd[], unsubscribe: WsCmd[]) {
    const items = [
      ...unsubscribe.map(c => ({ kind: c.kind, cmd: wireCmd(c, true) })),
      ...subscribe.map(c => ({ kind: c.kind, cmd: wireCmd(c) })),
    ]
    for (const msg of chunkWsCommands(items)) this.send(msg)
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
   * 同一 tick 内的订阅变更合并发送(渲染器切配置时是「dispose 全部 → 立刻重订」的模式):同实体的订阅并成一条命令,
   * 整批按 MAX_WS_MESSAGE_BYTES 分片,先退订后订阅;没有任何订阅时关掉连接,下次订阅重开,不留空闲 WS。
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
    if (subs.length || unsubs.length) this.sendCmds(this.buildCmds(subs), unsubs)
  }

  private idleClose() {
    const ws = this.ws
    this.ws = null
    this.wsOpen = false
    this.cmds.clear()
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
      // 重放全部存活的逻辑订阅(首连与重连同一路径):旧连接上的命令作废,重新合并、分片
      this.pendingSubs = []
      this.pendingUnsubs = []
      this.cmds.clear()
      for (const s of this.subs) s.cmd = null
      if (this.subs.size) this.sendCmds(this.buildCmds(this.subs), [])
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
      const cmd = this.cmds.get(msg.subscriptionId)
      if (!cmd) return
      if (msg.errorCode) {
        // TB 对这条订阅明确拒绝(CE 4.3.1 实测:CUSTOMER_USER 订阅未分配实体回 errorCode 1「Failed to fetch data!」);
        // 每个订阅者只通知一次
        for (const sub of [...cmd.members]) {
          const onError = sub.onError
          sub.onError = undefined
          onError?.(new Error(`TB 订阅被拒绝(${msg.errorCode}):${msg.errorMsg ?? ''}`.trim()))
        }
        return
      }
      if (!msg.data) return
      // 合并命令的回推按 key 分发:这次推送里没有自己 key 的订阅者不打扰(各自的 cb 内部再按 keys 过滤);
      // 空数据(如属性订阅首帧一个 key 都不存在)照旧通知所有成员。回调里可能退订,先拍快照再逐个确认仍在
      const pushed = Object.keys(msg.data)
      for (const sub of [...cmd.members]) {
        if (!cmd.members.has(sub)) continue
        if (pushed.length && !pushed.some(k => sub.keys.includes(k))) continue
        sub.cb(msg.data)
      }
    }
    ws.onclose = () => {
      this.wsOpen = false
      this.ws = null
      this.cmds.clear()
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
function wireCmd(c: WsCmd, unsubscribe = false): WireCmd {
  return {
    entityType: c.entity.type,
    entityId: c.entity.id,
    cmdId: c.cmdId,
    keys: c.keys.join(','),
    ...(c.kind === 'ts' ? { scope: 'LATEST_TELEMETRY' } : { scope: c.scope }),
    ...(unsubscribe ? { unsubscribe: true as const } : {}),
  }
}

const utf8 = new TextEncoder()
function utf8Bytes(s: string): number {
  return utf8.encode(s).length
}
/** 一个 key 放进 JSON 字符串里占的字节数(含转义,不含引号) */
function keyBytes(k: string): number {
  return utf8Bytes(JSON.stringify(k)) - 2
}
/** 空消息 `{"tsSubCmds":[],"attrSubCmds":[]}` 的字节数 */
const ENVELOPE_BYTES = utf8Bytes(JSON.stringify({ tsSubCmds: [], attrSubCmds: [] }))

/**
 * 把一串命令按顺序装进若干条消息,每条序列化后不超过 maxBytes(UTF-8 字节;每个命令按「自身 + 一个逗号」计,略偏保守)。
 * 单个命令自己就超限时单独成一条照发(拆不了),并 console.warn——TB 多半会以 1009 关连接,得从配置上减 key。
 */
export function chunkWsCommands(
  items: { kind: 'ts' | 'attr'; cmd: WireCmd }[],
  maxBytes = MAX_WS_MESSAGE_BYTES
): WsMessage[] {
  const out: WsMessage[] = []
  let cur: WsMessage | null = null
  let bytes = 0
  for (const { kind, cmd } of items) {
    const n = utf8Bytes(JSON.stringify(cmd)) + 1
    if (ENVELOPE_BYTES + n > maxBytes)
      console.warn(
        `[LegacyDataSource] 单条订阅命令约 ${ENVELOPE_BYTES + n} 字节,超过 ${maxBytes} 且无法再拆(${cmd.entityType} ${cmd.entityId})`
      )
    if (!cur || bytes + n > maxBytes) {
      cur = { tsSubCmds: [], attrSubCmds: [] }
      bytes = ENVELOPE_BYTES
      out.push(cur)
    }
    ;(kind === 'ts' ? cur.tsSubCmds : cur.attrSubCmds).push(cmd)
    bytes += n
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
