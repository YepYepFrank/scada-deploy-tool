/**
 * PageConfig —— 部署工具与渲染器之间唯一的接口(契约 v1,T0.2)。
 *
 * - 由渲染器包定义,从 `@grid/scada-renderer/schema` 子路径导出(架构 v2 §0 ②、§6)。
 * - JSON Schema(page-config.schema.json)由本文件生成:`pnpm -F @grid/scada-renderer gen:schema`,不手写。
 * - `schemaVersion` 固定为 1;一期内不允许破坏性变更,新增字段必须可选(开发计划 §2.2)。
 * - 渲染器只见实体 id。项目文件里按名称存、发布时解析为 id 的规则属于工具侧(ADR-002),不在本契约内。
 *
 * 待 T0.1 回填后可能的补充(均为可选新增,不破坏 v1):
 * - ADR-004 若选「ext 过渡路线」:Binding 增加 `{ mode: 'ext'; source: string; params?: … }`。
 */

import type { EntityRef, AttributeScope, Aggregation, ExtInterval, AbsoluteRange } from '@grid/tb-client'

export type { EntityRef, AttributeScope, Aggregation, ExtInterval, AbsoluteRange }

export const SCHEMA_VERSION = 1 as const

/**
 * 大屏抬头(0.6.0):页面顶部那条标题带,**属于页面本身**(工程人员在部署工具里填,跟着页面一起发布)。
 * 与架构 §6「页面标头 / 导航菜单 / 时钟归宿主」不冲突:那说的是宿主应用自己的框架——导航、时钟、
 * 登录身份;这里是这张大屏印在最上面的名字,换一张页面就该换一个,只能由配页面的人决定。
 * 不配 `header`(或 `title` 为空)就不画,行为与 0.5.0 一致;宿主想自己画可传 `<ScadaPage :header="false">`。
 */
export interface PageHeader {
  /** 主标题,如「仙人山服务区智能微电网监控系统」。为空 = 不画抬头。 */
  title?: string
  /** 副标题,常放英文名或一句说明。 */
  subtitle?: string
  /** 左侧单位 / 项目名。 */
  org?: string
  /**
   * 左侧图标:`http(s)://…` 或 `data:image/…;base64,…`(部署工具选图后转 data URI 存进来,限 200 KB)。
   * @maxLength 300000
   */
  logo?: string
  /** 主标题对齐:居中(缺省)或靠左。 */
  align?: 'center' | 'left'
  /** false = 配置留着但不画(编辑器里的「显示抬头」开关);缺省视为 true。 */
  show?: boolean
}

/** 一整页的配置。导航菜单 / 时钟 / 登录身份不在此内,归宿主应用(架构 §6「三条补充约定」)。 */
export interface PageConfig {
  schemaVersion: typeof SCHEMA_VERSION
  /**
   * 页面模板 id,在渲染器模板注册表中查(如 'overview-a' / 'monitor-3col' / 'grid-3x3')。
   * @pattern ^[a-z][a-z0-9-]*$
   */
  template: string
  /** 主题名;缺省用渲染器默认主题。 */
  theme?: string
  /** 页面标题,供宿主 / 独立薄壳在自己的标头 / 页面列表里显示;渲染器本身不画(要画在页面里的是 `header`)。 */
  title?: string
  /** 大屏抬头(0.6.0);不填不画。 */
  header?: PageHeader
  widgets: WidgetConfig[]
}

export interface WidgetConfig {
  /**
   * 页面内唯一、创建后不变:宿主按「页面 id + 组件 id」引用单张卡片(<ScadaWidget> / pickWidget)。
   * 工具在创建组件时生成一次(`w_` + 8 位随机),改属性 / 绑定 / 换模板都不变;换组件类型 = 新组件 = 新 id;
   * 将来若有移动 / 复制:移动只改 slot,复制生成新 id。旧页面的 `w-<slot>` / `<type>-<slot>` 形式继续有效。渲染器只要求唯一。
   * @pattern ^[A-Za-z0-9_-]+$
   */
  id: string
  /**
   * 模板槽位名(如 'r1c2' / 'main' / 'side-top'),须存在于所选模板的 slots 中。
   * @pattern ^[A-Za-z0-9_-]+$
   */
  slot: string
  /**
   * 组件类型,在组件注册表中查(如 'number-card' / 'gauge' / 'line' / 'alarm-list')。
   * @pattern ^[a-z][a-z0-9-]*$
   */
  type: string
  /** 组件自定义属性,形状由该组件的 propsSchema 决定;渲染器按 propsSchema 校验。 */
  props?: Record<string, unknown>
  /**
   * 绑定:组件「绑定槽位名」→ 数据来源。
   * 声明 `multiple: true` 的绑定槽位(如曲线的 series)**必须**写成数组,一项一序列,单条也写成一项的数组;
   * 非 multiple 槽位必须是单个对象。JSON Schema 无法按槽位区分,由注册表运行时校验强制(T0.1 回填 B2,2026-09-04)。
   */
  bindings: Record<string, Binding | Binding[]>
  /**
   * 写操作:契约保留,一期不实现。渲染器一期只做 schema 校验并把对应组件渲染为禁用态(架构 §0 ⑤、§8)。
   */
  actions?: Record<string, Action>
}

// ───────── 绑定上下文(0.9.0,方案讨论-BindingContext-2026-09-21)─────────
// 绑定里的实体 / 测点 / 时间范围除了写死,还可以写「取自页面上下文的某个键」。宿主只给上下文
// (<ScadaPage :binding-context> / provideBindingContext()),渲染器解析成具体值再去订阅;上下文变了只重订受影响的组件。
// **只有显式写了 source: 'context' 的地方才会被替换**,固定绑定永远不动。全部是可选新增,schemaVersion 仍为 1;
// 但 0.8.0 及更早的渲染器不认识这种写法(会判该页配置无效)——宿主先升 0.9.0,再发布这类页面。

/**
 * 上下文键:标准键 `selectedSite` / `selectedDevice` / `selectedMeasurePoint` / `timeRange`,
 * 其余业务键一律放在 `custom` 下(`custom.selectedTu`),避免顶层键名失控。`selectedAlarm` 为预留,一期绑定不可引用。
 * @pattern ^(selectedSite|selectedDevice|selectedMeasurePoint|timeRange|custom\.[A-Za-z][A-Za-z0-9_]*)$
 */
export type ContextKey = string

/**
 * 上下文里没有这个键(或为 null)时这张卡怎么办:
 * - `empty`(缺省):显示中性的「未选择设备」空态,不请求、不订阅、不算报错;
 * - `hide`:整张卡不画;
 * - `error`:显示错误态并抛 bindError(这一页必须有上下文才有意义时用);
 * - `fallback`:用 `fallback` 去订阅(必须同时给 fallback;适合「默认先看 1# PCS」的页面)。
 */
export type WhenMissing = 'empty' | 'hide' | 'error' | 'fallback'

/** 实体取自上下文 */
export interface ContextEntityRef {
  source: 'context'
  key: ContextKey
  /** 期望的实体类型;填了就校验,上下文给的类型不符 → 该卡显示配置错误而不是去订阅 */
  type?: 'DEVICE' | 'ASSET'
  /**
   * 样例 / 兜底实体:编辑器靠它挑测点、出预览。**运行时只有 whenMissing 为 'fallback' 才用它**——
   * 样例设备不该悄悄成为生产页面的默认值。
   */
  fallback?: EntityRef
  whenMissing?: WhenMissing
}

/** 测点(key)取自上下文:历史数据页「选测点」用。上下文里的值是 key 字符串或 `{ key, label?, unit? }` */
export interface ContextKeyRef {
  source: 'context'
  key: ContextKey
  /** @minLength 1 */
  fallback?: string
  whenMissing?: WhenMissing
}

/**
 * 时间窗口字面量:整数 + 单位(m / h / d),如 '15m' / '24h' / '7d'。
 * @pattern ^\d+(m|h|d)$
 */
export type WindowLiteralString = string

/** 时间范围取自上下文:上下文里的值是窗口字面量('24h')或绝对区间 `{ from, to }`(毫秒 / ISO 字符串 / Date) */
export interface ContextWindowRef {
  source: 'context'
  key: ContextKey
  fallback?: WindowLiteralString | AbsoluteRange
  whenMissing?: WhenMissing
}

/** 固定实体,或取自上下文 */
export type EntitySource = EntityRef | ContextEntityRef
/** 固定测点,或取自上下文 */
export type KeySource = string | ContextKeyRef
/** 「最近 N」、绝对区间,或取自上下文。绝对区间只拉历史,不追加实时 */
export type WindowSource = WindowLiteralString | AbsoluteRange | ContextWindowRef

/** 实时遥测:订阅一个 key 的最新值与后续推送。 */
export interface TsBinding {
  mode: 'ts'
  entity: EntitySource
  /** @minLength 1 */
  key: KeySource
}

/** 历史 + 实时追加:先按窗口拉历史,再订阅同 key 追加。 */
export interface TsHistoryBinding {
  mode: 'ts-history'
  entity: EntitySource
  /** @minItems 1 */
  keys: KeySource[]
  /** 时间窗口:'15m' / '24h' / '7d',或绝对区间 { from, to },或取自上下文(0.9.0) */
  window: WindowSource
  /** 缺省由数据层按窗口长度自适应。 */
  agg?: Aggregation
}

/** 属性:订阅 server / shared / client scope 的某个属性。 */
export interface AttrBinding {
  mode: 'attr'
  entity: EntitySource
  scope: AttributeScope
  /** @minLength 1 */
  key: KeySource
}

/** 告警:该实体当前活动告警;`types` 不填为全部,填了只看指定告警类型(状态卡 / 横幅按告警名过滤)。 */
export interface AlarmBinding {
  mode: 'alarm'
  entity: EntitySource
  /** @minItems 1 */
  types?: string[]
}

/** 常量:编辑器缩略图与 /dev 展示页用假数据渲染;也用于 image.src 这类静态值。 */
export interface ConstBinding {
  mode: 'const'
  value: unknown
}

/**
 * 外部数据源(kz 归档 / 报表):TB 只保留 3–7 天原始遥测,≥ 3 天窗口或 ≥ 1 天粒度的统计一律从 kz 取
 * (T0.1 回填 A4,2026-09-04;ADR-004 改为正式路线)。`params` 形状待澄清会拿到 kz 通用查询接口后冻结。
 */
export interface ExtBinding {
  mode: 'ext'
  /**
   * 外部源标识,一期固定 'kz'。
   * @pattern ^[a-z][a-z0-9-]*$
   */
  source: string
  /** 时间窗口:同 ts-history(0.9.0 起同样可以是绝对区间或取自上下文)。 */
  window?: WindowSource
  /** 聚合粒度,对齐 kz 支持的枚举。 */
  interval?: ExtInterval
  /**
   * 源特有参数(站点 / 业务 id、指标名等)。kz 通用历史查询的 `params.entity` 与 `params.keys[i]`
   * 同样可以写成取自上下文的形式(`{ source: 'context', key: … }`),由渲染器在调用 ext() 前解析。
   */
  params: Record<string, unknown>
}

export type Binding = TsBinding | TsHistoryBinding | AttrBinding | AlarmBinding | ConstBinding | ExtBinding

export type BindingMode = Binding['mode']

/** RPC 写操作(二期)。只允许绑 DEVICE,由 JSON Schema 的 entity.type 常量约束。 */
export interface RpcAction {
  kind: 'rpc'
  entity: { type: 'DEVICE'; id: string }
  /** @minLength 1 */
  method: string
  /** true 时执行前弹二次确认。 */
  confirm?: boolean
}

/** 写属性(二期)。只允许绑 DEVICE 的 SHARED_SCOPE / SERVER_SCOPE。 */
export interface AttrWriteAction {
  kind: 'attr'
  entity: { type: 'DEVICE'; id: string }
  scope: 'SHARED_SCOPE' | 'SERVER_SCOPE'
  /** @minLength 1 */
  key: string
}

export type Action = RpcAction | AttrWriteAction

/** 运行时类型守卫:只检查形状,不校验 schema(schema 校验用 validatePageConfig)。 */
export function isPageConfig(x: unknown): x is PageConfig {
  return (
    !!x &&
    typeof x === 'object' &&
    (x as PageConfig).schemaVersion === SCHEMA_VERSION &&
    typeof (x as PageConfig).template === 'string' &&
    Array.isArray((x as PageConfig).widgets)
  )
}
