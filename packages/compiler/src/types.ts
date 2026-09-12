// tbsite 站点声明(tbsite/v1、v2)与写入计划的类型。
// 配置对象来自向导 / 项目文件,字段沿用 publisher.js 的约定;类型故意保持宽松(索引签名),
// 以便旧配置里的展示字段(console / focus / 布局)原样通过,编译核心只读它认识的字段。

export type Selector = { profiles?: string[]; prefixes?: string[] }

export interface DeviceDecl {
  name: string
  type?: string
  profile?: string
  keys?: { key: string; [k: string]: unknown }[]
  [k: string]: unknown
}

export type KeyRef = { device: string; key: string }

export type ExprTerm = { kind: 'const'; value: number } | { kind: 'key'; device: string; key: string; abs?: boolean }

export type AggName = 'avg' | 'min' | 'max' | 'sum'
export type Window = '5m' | '15m' | '1h'
export type CompareOp = 'gt' | 'lt' | 'gte' | 'lte' | 'eq' | 'ne'

/** 运算项。模板(deviceTemplates.items)里的运算项不带 device,展开后才绑定。 */
export interface Computation {
  template: string
  name?: string
  device?: string
  /** alarm.threshold 模板展开后:一条规则覆盖多台设备 */
  devices?: string[]
  output?: string
  outputMode?: 'ts' | 'attr'
  key?: string
  keys?: string[]
  aggs?: AggName[]
  window?: Window
  inputs?: Record<string, KeyRef>
  terms?: ExprTerm[]
  ops?: string[]
  condition?: { op: CompareOp; value: number }
  severity?: string
  message?: string
  trigger?: 'edge' | 'level'
  /** alarm.switch 开关变位告警:报哪几个方向(close 由分到合 / open 由合到分,可都选)(2026-09-11) */
  directions?: ('close' | 'open')[]
  /** alarm.switch:合闸时测点的值(默认 1);其它值都算分闸 */
  closedValue?: number
  selector?: Selector
  agg?: 'sum' | 'avg'
  asset?: string
  priceAsset?: string
  charge?: KeyRef
  discharge?: KeyRef
  /** 展开来源模板名(仅 TS 版携带,写入计划对比时忽略) */
  _tpl?: string
  /** 接管来的计算字段在 TB 上的名字(与输出测点名不同时才有;见 core/adopt.ts) */
  cfName?: string
  /** 从平台接管的运算:保持原实体 / 原字段名 / 原输出名(不加输出前缀),可以挂在非本工具建的资产上 */
  adopted?: boolean
  /** 即时计算:对整个结果再取绝对值,生成 `abs(整条式子)`(2026-09-11) */
  absAll?: boolean
  [k: string]: unknown
}

export interface DeviceTemplate {
  name: string
  selector?: Selector
  items?: Computation[]
  [k: string]: unknown
}

export interface TbsiteConfig {
  schema: 'tbsite/v1' | 'tbsite/v2' | string
  site: { name: string; [k: string]: unknown }
  devices: DeviceDecl[]
  deviceTemplates?: DeviceTemplate[]
  computations?: Computation[]
  rollup?: { chainName?: string }
  /** propagate:告警沿 Contains 关系向上传播到汇聚 / 站点资产(页面的告警列表绑站点资产时需要);默认不传播 */
  alarm?: { chainName?: string; propagate?: boolean }
  /**
   * 运算结果 key 的统一前缀(ADR-003)。向导新建站点写 'calc_';既有站点配置没有该字段 → 旧输出不改名。
   * 派生名(PAvg5m、级联各级、收益 Income/Cost/Daily)同样加前缀;引用其它运算输出的 key 由编译器同步改名。
   */
  outputPrefix?: string
  /**
   * 第 3 步冲突选了「以 TB 为准」、而向导表达不了 TB 上的改法的对象(规则链、模板展开的字段、汇聚字段等):
   * 发布时不覆盖,保留 TB 上的版本。元素是 cfItemKey / chainItemKey(core/print.ts)。2026-09-11
   */
  keepPlatform?: string[]
  [k: string]: unknown
}

// ── TB 侧对象(只声明编译器会产出 / 读取的字段)──────────────────

export type EntityType = 'DEVICE' | 'ASSET' | 'RULE_CHAIN'
export type EntityId = { entityType: EntityType; id: string }

export interface CfArgument {
  refEntityId?: EntityId
  refEntityKey: { type: 'TS_LATEST'; key: string }
  defaultValue?: string
}

export interface CalculatedField {
  id?: unknown
  /** 乐观锁:更新时带上 TB 读回的版本,别人先改过会回 409(写入器才填,计划里没有) */
  version?: number
  /** 归属标记 { managedBy, site }(写入器才填,计划里没有) */
  additionalInfo?: Record<string, unknown> | null
  entityId?: EntityId
  type: 'SIMPLE'
  name: string
  configurationVersion: 1
  configuration: {
    type: 'SIMPLE'
    arguments: Record<string, CfArgument>
    expression: string
    output: Record<string, unknown>
  }
}

export interface RuleNode {
  type: string
  name: string
  configuration: Record<string, unknown>
  additionalInfo: { layoutX: number; layoutY: number }
}
export interface RuleConnection {
  fromIndex: number
  toIndex: number
  type: string
}
export interface RuleChainMetadata {
  ruleChainId: EntityId
  firstNodeIndex: number | null
  nodes: RuleNode[]
  connections: RuleConnection[]
  ruleChainConnections: null
}

// ── 写入计划:编译核心的输出,不含任何网络调用 ────────────────────

/** 名称 → TB id。计划阶段未知的 id 用占位串(见 placeholderIds) */
export interface IdMap {
  devices: Record<string, string>
  assets?: Record<string, string>
  chains?: Record<string, string>
}

export interface RollupGroupSpec {
  avg: string[]
  min: string[]
  max: string[]
  sum: string[]
  delta: Record<string, string>
  integrate: Record<string, string>
}

export interface WritePlan {
  site: { name: string; assetType: 'tbsite' }
  validation: { errors: string[]; notes: string[] }
  /** 生效的输出前缀(ADR-003),'' 表示不加 */
  outputPrefix: string
  /** 这份配置会写出的全部 key(见 core/prefix.ts outputInventory) */
  outputs: { entityType: 'DEVICE' | 'ASSET'; entity: string; key: string; kind: string; template: string }[]
  /** 级联白名单:设备上被其它运算再当输入的带前缀 key;写进告警链入口过滤与站点资产属性 calcCascadeKeys */
  cascadeKeys: string[]
  /** 模板展开产物在前 + 手工运算项 */
  computations: Computation[]
  /**
   * 即时派生 CF(expr.* / formula.*):输入在一台设备上 → device(建在该设备);
   * 输入跨设备、声明了 asset → asset(建在该独立资产上,结果是资产遥测)。两者恰有其一。
   */
  cfs: {
    device?: string
    asset?: string
    output: string
    template: string
    /** 接管来的(core/adopt.ts) */
    adopted?: boolean
    body: CalculatedField
  }[]
  /** 跨设备汇聚:目标资产(tbsite-agg)+ 成员关系 + 资产上的 CF(分层时 分组N + 汇总1) */
  aggregates: { output: string; asset: string; members: string[]; layered: boolean; bodies: CalculatedField[] }[]
  revenue: { chainName: string; assets: string[]; items: Computation[]; metadata: RuleChainMetadata } | null
  rollup: {
    chainName: string
    groups: Record<string, RollupGroupSpec>
    cascades: Computation[]
    metadata: RuleChainMetadata
  } | null
  alarm: { chainName: string; rootFlowName: string; items: Computation[]; metadata: RuleChainMetadata } | null
  /** 站点资产属性:原始声明(不含展开产物) */
  siteAsset: { name: string; type: 'tbsite'; attributes: { siteConfig: TbsiteConfig; calcCascadeKeys?: string[] } }
}
