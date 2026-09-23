/**
 * 接线图编辑器的扩展点(ADR-005;计划 §3「波次 2 只新增文件」的前提)。
 *
 * 编辑器骨架(T5.5)实现 SldEditorContext 并 provide 出去;右侧面板(T5.6 绑定面板、T5.7 问题清单)、
 * 工具栏工具(T5.7 复制间隔 / 对齐 / 底图)各自放在 `panels/<名字>/index.ts`、`tools/<名字>/index.ts`,
 * `export default defineSldExtension({...})`,由骨架用
 *   import.meta.glob('./{panels,tools}/*\/index.ts', { eager: true })
 * 自动发现——加一个面板 / 工具不用改骨架的任何文件。
 *
 * 图的真相始终是 SldDoc(+ 本组件的 pt.* 绑定);X6 只是画布,扩展**不直接碰 X6**,一律经 ctx.apply 改文档,
 * 骨架负责把文档变化同步到画布并记入撤销栈。
 *
 * 本文件在一个波次内只读;要改先回主会话。
 * 2026-09-19 修订(T5.5 交付后):ctx.view、apply 返回是否提交、工具 active;SldEditorHost 定形(tree / client / declared / keyCn)。
 */
import type { Component, InjectionKey, Ref } from 'vue'
import type { Binding, SldDoc, SldPoint, SldSelection } from '@grid/scada-renderer'
import type { Declared } from '../editor/declared-keys'
import type { MetaClient, MetaNode } from '../meta/MetaNode'
import type { KeyCnFn } from '../naming'

/** 编辑中的内容:图 + 本组件的测点绑定(键为完整槽位名 `pt.<pointId>`)。两者必须一起改、一起撤销。 */
export interface SldEditorContent {
  doc: SldDoc
  bindings: Record<string, Binding>
}

/**
 * 一次修改:拿到深拷贝的草稿,直接改;返回 false 表示放弃(不进撤销栈)。
 * 骨架在 recipe 之后跑 validateSldDoc,有 error 级问题则整笔回滚并提示——扩展不用自己兜底。
 */
export type SldRecipe = (draft: SldEditorContent) => void | false

export interface SldEditorContext {
  /** 当前内容(只读;要改走 apply)。每次 apply / 撤销 / 重做后整体换新对象,可以放心 watch */
  readonly content: Readonly<Ref<SldEditorContent>>
  /** 当前选择集(画布上框选 / 点选的结果) */
  readonly selection: Readonly<Ref<SldSelection>>
  /** 只读模式(预览实时值时为 true):扩展应禁用会改文档的操作 */
  readonly readonly: Readonly<Ref<boolean>>

  /**
   * 改文档;一次 apply = 撤销栈里的一步。label 显示在「撤销:xxx」里。
   * 返回这一笔是否真的提交了:只读、recipe 返回 false、内容没变、或校验回滚时为 false(扩展据此决定要不要关对话框 / 提示)
   */
  apply(recipe: SldRecipe, label?: string): boolean
  /** 设置选择集(缺的键视为空);center 为 true 时把选中元素滚到视口中央(问题清单点一条用) */
  select(sel: Partial<SldSelection>, opts?: { center?: boolean }): void

  /** 生成在当前图内唯一的 id(节点 n、母线 b、连线 w、标签 l、分组框 f、测点 p);字符集符合 SLD_ID_PATTERN */
  newId(kind: 'n' | 'b' | 'w' | 'l' | 'f' | 'p'): string
  /** 屏幕坐标 → 画布坐标;snap 缺省 true(吸附栅格) */
  toCanvas(client: { x: number; y: number }, snap?: boolean): SldPoint

  /** 视口操作(扩展不直接碰 X6,缩放 / 适应窗口走这里) */
  readonly view: SldEditorView

  /** 宿主提供的服务(第 4 步编辑器里是真的设备树 / 测点元数据;独立开发入口里是 mock) */
  readonly host: SldEditorHost
}

export interface SldEditorView {
  /** 当前缩放倍数(1 = 100%) */
  readonly zoom: Readonly<Ref<number>>
  /** 整张图缩放到窗口内并居中(最大不超过 100%) */
  fit(): void
  /** 以视口中心为基准缩放:factor > 1 放大 */
  zoomBy(factor: number): void
  /** 回到 100% */
  resetZoom(): void
}

/**
 * 宿主服务:绑定面板(T5.6)复用现有的 EntityTree / BindingRow(含数据源面板),它们要的东西由宿主给。
 * - 第 4 步编辑器(T5.8)把自己手里的 tree / client / declared / keyCn 原样传进来;
 * - 独立开发入口(sld-editor.html)给 mock:一棵假设备树 + 返回固定 key 列表的假 MetaClient。
 * 任何一项缺省时,绑定面板要能降级(tree 为空 → 提示「未连接平台,无法选设备」),不许崩。
 */
export interface SldEditorHost {
  /** 设备 / 资产树(EntityTree 的 root、BindingRow 的 tree) */
  readonly tree?: MetaNode | null
  /** 元数据客户端(BindingRow 的 client:列测点 key、属性 key…) */
  readonly client?: MetaClient | null
  /** 向导第 3 步声明、可能还没发布的运算输出(BindingRow 的 declared) */
  readonly declared?: Declared | null
  /** 测点中文名(现有编辑器以 provide('keyCn') 给 BindingRow;接线图编辑器内由骨架用同名 key 再 provide 一次) */
  readonly keyCn?: KeyCnFn
  /** 站点 / 项目名,用于默认文件名与提示 */
  readonly siteName?: string
}

/** 右侧面板(页签) */
export interface SldPanelExt {
  id: string
  title: string
  /** 页签顺序,小的在前;缺省 100 */
  order?: number
  /** 面板组件:用 inject(SLD_EDITOR_CTX) 取上下文,不收 props */
  component: Component
  /** 页签上的角标(如问题数);返回 0 / undefined 不显示 */
  badge?: (ctx: SldEditorContext) => number | undefined
}

/** 工具栏工具 */
export interface SldToolExt {
  id: string
  title: string
  /** 工具栏分组:同组挨在一起,组间有分隔 */
  group?: 'edit' | 'arrange' | 'bay' | 'view' | 'file'
  order?: number
  /** 快捷键,如 'ctrl+d';与骨架内置快捷键冲突时以内置为准并在控制台告警 */
  shortcut?: string
  /** 模式类工具(底图描摹、画母线…)的激活态:为 true 时工具栏按钮高亮;缺省不高亮 */
  active?: (ctx: SldEditorContext) => boolean
  /** 当前是否可用(如「对齐」要求选中 ≥ 2 个节点);缺省恒可用 */
  enabled?: (ctx: SldEditorContext) => boolean
  /** 点击执行;需要参数的工具(复制间隔 ×N)自己弹对话框,再调 ctx.apply */
  run: (ctx: SldEditorContext) => void | Promise<void>
}

/** 拖放:从画布外拖东西进来(设备树里的设备 → 自动配图元与默认测点) */
export interface SldDropExt {
  /** DataTransfer 的 MIME 类型,如 'application/x-grid-entity' */
  type: string
  /** at 已换算成画布坐标并吸附栅格;data 是 getData(type) 的原始字符串 */
  onDrop: (ctx: SldEditorContext, data: string, at: SldPoint) => void
}

/** 画布图层:under 在图的下面(底图描摹),over 在图的上面(测量辅助线之类);组件铺满画布坐标系 */
export interface SldLayerExt {
  id: string
  z: 'under' | 'over'
  component: Component
}

export interface SldEditorExtension {
  panels?: SldPanelExt[]
  tools?: SldToolExt[]
  drops?: SldDropExt[]
  layers?: SldLayerExt[]
}

/** 只为类型提示:`export default defineSldExtension({ tools: [...] })` */
export const defineSldExtension = (ext: SldEditorExtension): SldEditorExtension => ext

export const SLD_EDITOR_CTX: InjectionKey<SldEditorContext> = Symbol('grid:sld-editor-ctx')
