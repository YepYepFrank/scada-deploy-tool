/**
 * 一次接线图接入第 4 步页面编辑器的纯逻辑(T5.8,ADR-005 D1 / D2 / D10)。无 Vue、无 X6,可单测。
 *
 * - 图在 `sld` 组件的 `props.doc`,测点绑定在 `bindings['pt.<pointId>']`(动态槽位),静态槽位(alarms)与之并存;
 *   接线图编辑器只管 doc + pt.*,其余槽位归页面编辑器的绑定面板——拆分 / 合并在这里。
 * - 接线图编辑器关闭时**一次性**写回(页面编辑器的撤销栈里只占一步);内容没变不写。
 * - 发布到 TB 之前剥掉描摹底图 `doc.background`(D10);项目文件 / 草稿保留。
 */
import {
  emptySldDoc,
  SLD_POINT_SLOT_PREFIX,
  type Binding,
  type SldDoc,
  type WidgetConfig,
  type WidgetDefinition,
} from '@grid/scada-renderer'
import type { SldEditorContent } from '../sld-editor/ext'

type Bindings = WidgetConfig['bindings']

export const SLD_WIDGET_TYPE = 'sld'

/** 槽位名是不是接线图的测点动态槽位(`pt.<pointId>`) */
export const isSldPointSlot = (slot: string): boolean => slot.startsWith(SLD_POINT_SLOT_PREFIX)

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T

/**
 * 把一个组件的 bindings 拆成「测点绑定(pt.*)」与「其余槽位」。不改输入,值沿用输入的引用(不深拷贝)。
 * 动态槽位只允许单个绑定(ADR-005 D5);万一是数组(手改 JSON),取第一条,空数组丢弃。
 */
export function splitSldBindings(bindings: Bindings | undefined): { points: Record<string, Binding>; rest: Bindings } {
  const points: Record<string, Binding> = {}
  const rest: Bindings = {}
  for (const [slot, b] of Object.entries(bindings ?? {})) {
    if (!isSldPointSlot(slot)) rest[slot] = b
    else if (!Array.isArray(b)) points[slot] = b
    else if (b[0]) points[slot] = b[0]
  }
  return { points, rest }
}

/**
 * 写回:原有的非 pt.* 槽位原样保留 + 接线图编辑器给的**全部** pt.* 项。
 * 原来有、编辑器里删掉了的 pt.* 不残留;`points` 里混进来的非 pt.* 键忽略(编辑器不该碰别的槽位)。
 */
export function mergeSldBindings(original: Bindings | undefined, points: Record<string, Binding>): Bindings {
  const out: Bindings = { ...splitSldBindings(original).rest }
  for (const [slot, b] of Object.entries(points)) if (isSldPointSlot(slot)) out[slot] = b
  return out
}

/** 组件上测点绑定的条数(属性 / 绑定面板的摘要用) */
export function countSldPoints(bindings: Bindings | undefined): number {
  let n = 0
  for (const slot of Object.keys(bindings ?? {})) if (isSldPointSlot(slot)) n += 1
  return n
}

/** 组件 propsSchema 里第一个接线图字段(`format: 'sld-doc'`)的键;没有返回 null */
export function sldDocKey(def: Pick<WidgetDefinition, 'propsSchema'> | undefined): string | null {
  for (const [k, s] of Object.entries(def?.propsSchema.properties ?? {}))
    if ((s as { format?: string }).format === 'sld-doc') return k
  return null
}

const looksLikeDoc = (v: unknown): v is SldDoc =>
  !!v && typeof v === 'object' && !Array.isArray(v) && Array.isArray((v as { nodes?: unknown }).nodes)

/**
 * 打开接线图编辑器时的内容:doc = props[key](没有 / 不像一张图则给空图)+ 该组件全部 pt.* 绑定。
 * 深拷贝——编辑器里怎么改都碰不到页面配置(页面配置是只读快照)。
 */
export function sldContentOf(widget: Pick<WidgetConfig, 'props' | 'bindings'>, key: string): SldEditorContent {
  const raw = (widget.props as Record<string, unknown> | undefined)?.[key]
  return {
    doc: looksLikeDoc(raw) ? clone(raw) : emptySldDoc(),
    bindings: clone(splitSldBindings(widget.bindings).points),
  }
}

/** 两份编辑内容是否相同(决定关闭时要不要 commit)。先比引用,再比序列化结果 */
export function sameSldContent(a: SldEditorContent, b: SldEditorContent): boolean {
  if (a === b) return true
  return JSON.stringify(a.doc) === JSON.stringify(b.doc) && JSON.stringify(a.bindings) === JSON.stringify(b.bindings)
}

/** 把编辑结果写进组件草稿(在 useEditorState.patchWidget 的回调里用;就地改传入的 widget) */
export function applySldContent(widget: WidgetConfig, key: string, content: SldEditorContent): void {
  widget.props = { ...(widget.props ?? {}), [key]: content.doc }
  widget.bindings = mergeSldBindings(widget.bindings, content.bindings)
}

/** 结构上够用的页面形状:PageConfig(渲染器)与 PagePayload(编译器)都满足 */
interface PageLike {
  widgets: { type: string; props?: Record<string, unknown> | undefined }[]
}

/**
 * 发布前剥离描摹底图(ADR-005 D10):每个 `sld` 组件 props 里「像一张图且带 background」的字段去掉 background。
 * 不改输入;只给动过的组件 / 页面建新对象(其余沿用引用);没有任何底图时**原样返回同一引用**。
 */
export function stripSldBackground<P extends PageLike>(page: P): P {
  let changed = false
  const widgets = page.widgets.map(w => {
    if (w.type !== SLD_WIDGET_TYPE || !w.props) return w
    let props: Record<string, unknown> | null = null
    for (const [k, v] of Object.entries(w.props)) {
      if (!looksLikeDoc(v) || (v as SldDoc).background === undefined) continue
      const { background: _drop, ...doc } = v as SldDoc
      props = { ...(props ?? w.props), [k]: doc }
    }
    if (!props) return w
    changed = true
    return { ...w, props }
  })
  return changed ? { ...page, widgets } : page
}
