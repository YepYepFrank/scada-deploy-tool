/**
 * DataSource —— 渲染器与数据层之间唯一的接口(契约 v1,T0.2)。
 *
 * 依赖方向:工具 → 渲染器 → DataSource ← tbClient(架构 v2 §10「依赖方向」)。
 * 渲染器只依赖这个接口,通过 provide / inject 从宿主拿到实现;`TbClient` 实现它(T1.1);
 * Vitest 里给渲染器一个 MockDataSource 即可断言它订阅了哪些 key(架构 §7「真正的收益是可测」)。
 *
 * 本文件不依赖 Vue:连接状态用「当前值 + 变更回调」表达,Vue 适配层(`@grid/tb-client/vue`)
 * 再把它包成 ref。这是对开发计划 §5.3 草案(`Readonly<Ref<…>>`)的一处收紧,见 契约-v1.md §4。
 */

/** 实体引用:渲染器与数据层只认 id(项目文件里按名称存、发布时解析为 id 的规则见 ADR-002)。 */
export interface EntityRef {
  type: 'DEVICE' | 'ASSET'
  /** ThingsBoard 实体 UUID */
  id: string
}

/** 遥测 / 属性的单个点。TB 推送的值是字符串,数据层负责转成 number / boolean;不存在的 key 为 null。 */
export interface TsPoint {
  ts: number
  value: number | string | boolean | null
}

/** 实时遥测更新:一次推送可含多个 key、每个 key 一到多个点(历史回填时多个)。 */
export interface TsUpdate {
  key: string
  points: TsPoint[]
}

/** 属性更新(server / shared / client scope)。 */
export interface AttrUpdate {
  scope: AttributeScope
  key: string
  ts: number
  value: unknown
}

export type AttributeScope = 'SERVER_SCOPE' | 'SHARED_SCOPE' | 'CLIENT_SCOPE'

/** 告警快照(订阅回调每次给出该实体当前「活动中」的告警全集,渲染器不做增量合并)。 */
export interface AlarmInfo {
  id: string
  type: string
  severity: 'CRITICAL' | 'MAJOR' | 'MINOR' | 'WARNING' | 'INDETERMINATE'
  status: 'ACTIVE_UNACK' | 'ACTIVE_ACK' | 'CLEARED_UNACK' | 'CLEARED_ACK'
  startTs: number
  endTs?: number
  originator: EntityRef
  originatorName?: string
  details?: Record<string, unknown>
}

/** 历史聚合方式;`NONE` 为原始点。数据层按窗口长度自适应默认粒度(见 契约-v1.md §4.2)。 */
export type Aggregation = 'AVG' | 'MIN' | 'MAX' | 'SUM' | 'COUNT' | 'NONE'

/**
 * 时间窗口字面量:整数 + 单位,`15m` / `24h` / `7d`。
 * TS 层面只能约束为 string,格式由 JSON Schema 的 pattern 与运行时 `parseWindow()` 校验。
 */
export type WindowLiteral = `${number}m` | `${number}h` | `${number}d`

export type ConnectionStatus = 'connecting' | 'live' | 'offline'

export type Unsubscribe = () => void

export interface DataSource {
  /** 当前连接状态。<ScadaPage> 根节点据此显示离线 / 重连徽标(架构 §8)。 */
  readonly status: ConnectionStatus
  /** 状态变化回调;返回取消函数。 */
  onStatus(cb: (status: ConnectionStatus) => void): Unsubscribe

  /** 订阅实时遥测。首次回调应给出最新值(latest),之后按推送增量回调。 */
  subscribeTs(entity: EntityRef, keys: string[], cb: (updates: TsUpdate[]) => void): Unsubscribe

  /** 订阅属性。 */
  subscribeAttr(entity: EntityRef, scope: AttributeScope, keys: string[], cb: (updates: AttrUpdate[]) => void): Unsubscribe

  /** 订阅告警;`types` 为空 / undefined 表示全部类型。回调给出当前活动告警全集。 */
  subscribeAlarms(entity: EntityRef, types: string[] | undefined, cb: (alarms: AlarmInfo[]) => void): Unsubscribe

  /**
   * 查历史。`agg` 缺省时由数据层按窗口长度自适应(≤2h 原始点;2h–24h AVG/5min;24h–7d AVG/1h;>7d AVG/1d),
   * 调用方显式传 `agg` 时仍由数据层决定桶宽。渲染器不关心粒度(架构 §7「长窗口」)。
   */
  getHistory(entity: EntityRef, keys: string[], window: WindowLiteral | string, agg?: Aggregation): Promise<Record<string, TsPoint[]>>

  /** 最新值;不存在的 key 返回 null(TB 对不存在的 key 返回 `[{ts, value: null}]`,数据层需归一)。 */
  getLatest(entity: EntityRef, keys: string[]): Promise<Record<string, TsPoint | null>>

  // ext?(source: string, params: Record<string, unknown>): Promise<unknown>
  //   ↑ 预留:仅当 ADR-004 选「mode: 'ext' 过渡路线」时启用;默认不在契约内。
}

/** 解析窗口字面量为毫秒;非法格式抛错。 */
export function parseWindow(window: string): number {
  const m = /^(\d+)(m|h|d)$/.exec(window)
  if (!m) throw new Error(`invalid window literal: "${window}" (expected e.g. 15m / 24h / 7d)`)
  const n = Number(m[1])
  const unit = m[2] as 'm' | 'h' | 'd'
  return n * { m: 60_000, h: 3_600_000, d: 86_400_000 }[unit]
}
