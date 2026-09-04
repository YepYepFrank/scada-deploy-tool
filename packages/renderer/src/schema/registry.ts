/**
 * 注册表类型 —— 组件与模板的「编辑期元数据」(契约 v1,T0.2)。
 *
 * 组件定义只写一次,渲染与编辑都从它派生(架构 v2 §8「各部分要点」):
 * - 渲染器按 `component` 渲染、按 `bindingSlots` 填数据;
 * - 部署工具按 `propsSchema` 自动生成属性面板、按 `bindingSlots` 生成绑定选择器、按模板 `slots` 画槽位示意图。
 *
 * 这些类型不进 JSON Schema(它们描述代码,不描述数据);由 `registerWidget / registerTemplate` 在运行时校验。
 */

import type { Component } from 'vue'
import type { BindingMode } from './page-config'

/**
 * propsSchema 使用 JSON Schema draft-07 的一个子集,保证属性面板能无兜底地生成表单(计划 T3.3):
 * string / number(min,max,step) / boolean / enum / color(string + format:'color') / array<object>。
 * 这里只给出结构类型,不引入完整 JSON Schema 类型库。
 */
export interface PropsSchema {
  type: 'object'
  properties: Record<string, PropSchema>
  required?: string[]
  additionalProperties?: false
}

export type PropSchema =
  | {
      type: 'string'
      title?: string
      description?: string
      default?: string
      enum?: string[]
      enumNames?: string[]
      format?: 'color' | 'url' | 'multiline'
      maxLength?: number
    }
  | {
      type: 'number' | 'integer'
      title?: string
      description?: string
      default?: number
      minimum?: number
      maximum?: number
      multipleOf?: number
    }
  | { type: 'boolean'; title?: string; description?: string; default?: boolean }
  | { type: 'array'; title?: string; description?: string; items: PropsSchema; minItems?: number; maxItems?: number }

/** 绑定槽位的值类型;渲染器据此把 Binding 的结果整形后交给组件。 */
export type SlotValueType =
  | 'number' // 单个数值(数字卡、仪表、指示灯)
  | 'string' // 单个文本
  | 'boolean'
  | 'series' // 时间序列 {ts,value}[](曲线、表格)
  | 'alarms' // AlarmInfo[]
  | 'any' // const 任意值(图片地址、文本模板)

export interface BindingSlotSpec {
  /** 槽位名,对应 WidgetConfig.bindings 的 key */
  name: string
  title?: string
  valueType: SlotValueType
  required?: boolean
  /** 允许的 Binding.mode;为空表示全部允许 */
  modes?: BindingMode[]
  /**
   * 多序列槽位:为 true 时该槽位的绑定**必须**是数组(单条也写成一项的数组);为 false / 缺省时必须是单个对象。
   * 由 registerWidget / <ScadaPage> 运行时校验(T0.1 回填 B2,2026-09-04)。
   */
  multiple?: boolean
}

/** 写操作槽位(二期);一期注册表里可声明但渲染器只渲染禁用态。 */
export interface ActionSlotSpec {
  name: string
  title?: string
  kinds?: Array<'rpc' | 'attr'>
}

export type WidgetCategory = 'value' | 'chart' | 'alarm' | 'media' | 'diagram' | 'text'

export interface WidgetDefinition<P extends Record<string, unknown> = Record<string, unknown>> {
  /** 组件类型 id,对应 WidgetConfig.type */
  type: string
  name: string
  category: WidgetCategory
  description?: string
  component: Component
  propsSchema: PropsSchema
  bindingSlots: BindingSlotSpec[]
  actionSlots?: ActionSlotSpec[]
  /** props 默认值;工具新建组件时填入 */
  defaults?: Partial<P>
  /** /dev 展示页与编辑器缩略图用的假数据:按 bindingSlots 名给值 */
  sampleData?: () => Record<string, unknown>
  /** 推荐最小尺寸(模板槽位单位:栅格格数),工具用于 accepts 之外的软提示 */
  minSize?: { w: number; h: number }
}

export interface TemplateSlotDefinition {
  /** 槽位名,对应 WidgetConfig.slot */
  name: string
  title?: string
  /**
   * 位置:`grid` 模板为 CSS grid-area 名;`scaled` 模板为设计稿像素矩形。
   */
  area: string | { x: number; y: number; w: number; h: number }
  /** 允许放入的组件 type;缺省任意 */
  accepts?: string[]
  /** 必填槽位:校验层要求必须配置组件 */
  required?: boolean
  /** 内建固定组件(如告警横幅),不可由用户更换,可隐藏 */
  fixed?: { type: string; props?: Record<string, unknown>; hideable?: boolean }
}

export interface TemplateDefinition {
  /** 模板 id,对应 PageConfig.template */
  id: string
  name: string
  description?: string
  /**
   * scaled:固定设计尺寸 + 整体 transform: scale()(大屏);grid:CSS grid 响应式(后台页)。
   */
  kind: 'scaled' | 'grid'
  /** scaled 必填:设计稿尺寸 */
  design?: { w: number; h: number }
  /** grid 必填:grid-template-areas 每行一个字符串 */
  areas?: string[]
  slots: TemplateSlotDefinition[]
  /** 编辑器模板选择卡片用的缩略图(data URL 或相对路径);缺省由槽位布局自动绘制 */
  thumbnail?: string
}
