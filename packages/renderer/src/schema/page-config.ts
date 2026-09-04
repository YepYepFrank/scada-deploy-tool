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

import type { EntityRef, AttributeScope, Aggregation, ExtInterval } from '@grid/tb-client'

export type { EntityRef, AttributeScope, Aggregation, ExtInterval }

export const SCHEMA_VERSION = 1 as const

/** 一整页的配置。页面标头 / 导航菜单 / 时钟不在此内,归宿主应用(架构 §6「三条补充约定」)。 */
export interface PageConfig {
  schemaVersion: typeof SCHEMA_VERSION
  /**
   * 页面模板 id,在渲染器模板注册表中查(如 'overview-a' / 'monitor-3col' / 'grid-3x3')。
   * @pattern ^[a-z][a-z0-9-]*$
   */
  template: string
  /** 主题名;缺省用渲染器默认主题。 */
  theme?: string
  /** 页面标题,供宿主 / 独立薄壳在标头显示;渲染器本身不画。 */
  title?: string
  widgets: WidgetConfig[]
}

export interface WidgetConfig {
  /**
   * 页面内唯一。工具生成规则为 `w-<slot>`(同槽位多个组件时追加序号),渲染器只要求唯一。
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

/** 实时遥测:订阅一个 key 的最新值与后续推送。 */
export interface TsBinding {
  mode: 'ts'
  entity: EntityRef
  /** @minLength 1 */
  key: string
}

/** 历史 + 实时追加:先按窗口拉历史,再订阅同 key 追加。 */
export interface TsHistoryBinding {
  mode: 'ts-history'
  entity: EntityRef
  /** @minItems 1 */
  keys: string[]
  /**
   * 时间窗口:整数 + 单位(m / h / d),如 '15m' / '24h' / '7d'。
   * @pattern ^\d+(m|h|d)$
   */
  window: string
  /** 缺省由数据层按窗口长度自适应。 */
  agg?: Aggregation
}

/** 属性:订阅 server / shared / client scope 的某个属性。 */
export interface AttrBinding {
  mode: 'attr'
  entity: EntityRef
  scope: AttributeScope
  /** @minLength 1 */
  key: string
}

/** 告警:该实体当前活动告警;`types` 不填为全部,填了只看指定告警类型(状态卡 / 横幅按告警名过滤)。 */
export interface AlarmBinding {
  mode: 'alarm'
  entity: EntityRef
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
  /**
   * 时间窗口:同 ts-history。
   * @pattern ^\d+(m|h|d)$
   */
  window?: string
  /** 聚合粒度,对齐 kz 支持的枚举。 */
  interval?: ExtInterval
  /** 源特有参数(站点 / 业务 id、指标名等)。 */
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
