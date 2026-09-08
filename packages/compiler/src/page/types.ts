// 页面配置的严格类型(契约 v1 §1 PageConfig / §2 Binding / §3 Action 的 TS 镜像)。
// 编译器不依赖渲染器包(它带 Vue),所以在这里按契约原文再声明一份;两边靠契约 JSON Schema 保持一致。
// 契约冻结(2026-09-06):这里改字段 = 契约改字段,要走 ADR + 双方签字。

export interface EntityRef {
  type: 'DEVICE' | 'ASSET'
  /** 发布前可为空串 / 占位(ADR-002 按名存),publishPage 按 name 解析后回填 */
  id: string
  /** 仅供显示与按名解析 */
  name?: string
}
export type Aggregation = 'AVG' | 'MIN' | 'MAX' | 'SUM' | 'COUNT' | 'NONE'
export type ExtInterval = '1m' | '5m' | '1h' | '1d' | '1M' | '1y'
export type AttrScope = 'SERVER_SCOPE' | 'SHARED_SCOPE' | 'CLIENT_SCOPE'

export type TsBinding = { mode: 'ts'; entity: EntityRef; key: string }
export type TsHistoryBinding = {
  mode: 'ts-history'
  entity: EntityRef
  keys: string[]
  window: string
  agg?: Aggregation
}
export type AttrBinding = { mode: 'attr'; entity: EntityRef; scope: AttrScope; key: string }
export type AlarmBinding = { mode: 'alarm'; entity: EntityRef; types?: string[] }
export type ConstBinding = { mode: 'const'; value: unknown }
/** kz 归档(ADR-004 路线 A);通用历史的 params = { entity, keys, agg?, startTs?, endTs? },收益 = { stationId, metric? }(契约 §4.3b) */
export type ExtBinding = {
  mode: 'ext'
  source: string
  window?: string
  interval?: ExtInterval
  params: Record<string, unknown> & { entity?: EntityRef; keys?: string[] }
}
export type Binding = TsBinding | TsHistoryBinding | AttrBinding | AlarmBinding | ConstBinding | ExtBinding
export type BindingMode = Binding['mode']

/** 契约 §3 保留:一期渲染器只校验形状、画成禁用态;发布器只关心 entity(按名解析) */
export interface Action {
  entity?: EntityRef
  [k: string]: unknown
}

export interface WidgetConfig {
  id: string
  slot: string
  type: string
  props?: Record<string, unknown>
  bindings: Record<string, Binding | Binding[]>
  actions?: Record<string, Action>
}

/** 页面配置 = 契约 PageConfig;发布器写进 ScadaPage 资产 pageConfig 属性的就是它 */
export interface PagePayload {
  schemaVersion: 1
  template: string
  theme?: string
  title?: string
  widgets: WidgetConfig[]
}

/** 带 entity 的绑定(ts / ts-history / attr / alarm);ext 的实体在 params 里,用 extEntityOf 取 */
export type EntityBinding = TsBinding | TsHistoryBinding | AttrBinding | AlarmBinding
export const hasEntity = (b: Binding): b is EntityBinding => b.mode !== 'const' && b.mode !== 'ext'
export const extEntityOf = (b: Binding): EntityRef | undefined =>
  b.mode === 'ext' && b.params && typeof b.params.entity === 'object' && b.params.entity
    ? (b.params.entity as EntityRef)
    : undefined
/** 遍历一个组件的全部绑定(数组槽位摊平),给出路径 `<widget>/<slot>[/<i>]` */
export function* eachBinding(w: WidgetConfig): Generator<{ at: string; binding: Binding }> {
  for (const [slot, b] of Object.entries(w.bindings ?? {})) {
    if (Array.isArray(b)) for (const [i, one] of b.entries()) yield { at: `${w.id}/${slot}/${i}`, binding: one }
    else if (b) yield { at: `${w.id}/${slot}`, binding: b }
  }
}
