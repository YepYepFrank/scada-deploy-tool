/**
 * <ScadaPage> 的 props 契约(宿主应用与部署工具共同依赖)。实现随 T1.2 加入,这里先定形状。
 */
import type { PageConfig } from './page-config'
import type { DataSource } from '@grid/tb-client'

export interface ScadaPageProps {
  /** 页面配置(已通过 validatePageConfig 或由渲染器内部校验) */
  config: PageConfig
  /**
   * 数据源。缺省时从 provide/inject(`provideTbClient`)获取;显式传入优先——部署工具「Customer 视角预览」用另一个实例。
   */
  dataSource?: DataSource
  /**
   * 是否在根节点显示连接状态徽标(connecting / offline)。
   * **默认 false**:宿主应用认为该信息对最终用户无意义(T0.1 回填 C3,庄艳芹);部署工具预览默认传 true 以便排障。
   */
  showStatus?: boolean
  /** 覆盖 config.theme */
  theme?: string
  /**
   * 编辑态:所有绑定改用组件 sampleData 渲染,不建立任何订阅;工具的槽位缩略图与 /dev 展示页使用。
   */
  design?: boolean
  /**
   * 组件右上角是否显示「放大」按钮(2026-09-16):点开把该组件铺满整个视口再渲染一份(共用同一份值,不新建订阅),
   * Esc / ✕ 关闭。**默认 true**;design 态下不显示。宿主不想要就传 false。
   */
  expandable?: boolean
  /**
   * 页面装饰层(0.5.0):背景渐变 + 光晕 + 细网格 + 暗角,scaled 模板另加舞台四角角标。
   * **默认 true**——交付出去的页面不该是一块素底加几个方块。宿主自己有整套背景 / 不想要这层时传 false,
   * 观感回到 0.4.0(卡片质感不受影响,那部分只是主题令牌,想调改 --sr-panel-* 即可)。
   */
  decor?: boolean
}

/** 组件内 `emit('widget-event', { name, detail? })` 的载荷(组件自己定义 name,如接线图的 node-click) */
export interface WidgetEventInput {
  name: string
  detail?: unknown
}

/** 渲染器向宿主抛出的 widget-event 载荷:在组件给的 name / detail 上补组件 id 与类型 */
export interface WidgetEventPayload {
  widgetId: string
  type: string
  name: string
  detail?: unknown
}

/** 渲染器根节点向外抛出的事件。 */
export interface ScadaPageEmits {
  /** 配置校验失败(schemaVersion 不符、未知组件 / 模板、绑定形状错) */
  (e: 'invalid', issues: { path: string; message: string }[]): void
  /** 连接状态变化(即使 showStatus=false 也会抛,宿主可自行呈现) */
  (e: 'status', status: 'connecting' | 'live' | 'offline'): void
  /**
   * 组件事件透传(接线图计划 D6 ②):组件内 `emit('widget-event', { name, detail })`,这里补上 widgetId / type 原样抛给宿主;
   * 放大层里触发的也从这里出去。渲染器不解释 name,含义由组件约定(如 sld 的 node-click)。
   */
  (e: 'widget-event', payload: WidgetEventPayload): void
}
