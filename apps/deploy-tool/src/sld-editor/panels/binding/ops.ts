/**
 * 绑定面板对草稿的全部修改(T5.6):纯函数,在 ctx.apply 的 recipe 里调,直接改传进来的草稿。
 * 无 Vue、无 DOM、无 X6,可单测。查询类的(未绑定计数、设备树按名找实体)也放这里。
 *
 * 约定:
 * - 图里只存 pointId 的引用,绑定在 `bindings['pt.<id>']`(ADR-005 D2);两者必须在同一个 recipe 里一起改;
 * - 图里的实体只存 `{ type, name }`(D4);绑定里的实体带 id(编辑态从设备树选的)也带 name(发布时按名重解析);
 * - 一个 pt 可能被多处引用(复制 / 粘贴出来的元素与原件看同一个测点):改其中一处的绑定时**写时复制**——
 *   给这一处换一个新 pt,别处不受影响;删引用时只清理「已经没人引用」的绑定。
 */
import { isContextRef } from '@grid/scada-renderer'
import {
  collectPointRefs,
  nodeBox,
  sldPointSlot,
  nodeScaleXY,
  symbolPoint,
  type Binding,
  type SldDoc,
  type SldEntityName,
  type SldLabel,
  type SldLabelColor,
  type SldNode,
  type SldPoint,
  type SldPointRef,
  type SldSelection,
  type SldSymbolDefinition,
  type SldSymbolLookup,
  type SldValueFormat,
} from '@grid/scada-renderer'
import type { EntityRef } from '@grid/tb-client'
import type { MetaNode } from '../../../meta/MetaNode'
import { addNode } from '../../doc-ops'
import { DEFAULT_STATE_MAP, type DefaultPoints, type SldStateMap } from '../../device-defaults'
import type { SldEditorContent } from '../../ext'

export type SldValueLabel = Extract<SldLabel, { kind: 'value' }>

/** 标签顺延的行距 */
export const LABEL_ROW = 20
/** 图元没声明 labelSlots 时,第一个标签放在包围盒右侧这么远 */
export const LABEL_GAP = 10

const findNode = (doc: SldDoc, id: string): SldNode | undefined => doc.nodes.find(n => n.id === id)
const findValueLabel = (doc: SldDoc, id: string): SldValueLabel | undefined => {
  const l = doc.labels.find(x => x.id === id)
  return l?.kind === 'value' ? l : undefined
}

/* ───────────── 查询 ───────────── */

/** 这条绑定算不算「绑上了」:ts / attr 要有实体(id 或 name,改绑后的绑定只有 name)和 key;常量要有值 */
export function isPointBound(b: Binding | null | undefined): boolean {
  if (!b) return false
  if (b.mode === 'const') return b.value !== undefined && b.value !== ''
  if (b.mode === 'ts' || b.mode === 'attr') {
    const e = b.entity as { id?: string; name?: string; source?: string } | undefined
    return !!(e?.id || e?.name || e?.source === 'context') && !!b.key
  }
  return true
}

export const bindingOf = (content: SldEditorContent, pt: string): Binding | null =>
  content.bindings[sldPointSlot(pt)] ?? null

/** 图里没绑上的测点引用 */
export function unboundRefs(content: SldEditorContent): SldPointRef[] {
  return collectPointRefs(content.doc).filter(r => !isPointBound(bindingOf(content, r.pt)))
}

/** 一个节点名下的引用:自己的状态测点 / 在线灯 + 依附在它上面的数值标签 */
export function nodePointRefs(doc: SldDoc, nodeId: string): SldPointRef[] {
  const attached = new Set(doc.labels.filter(l => l.kind === 'value' && l.attach === nodeId).map(l => l.id))
  return collectPointRefs(doc).filter(r => (r.from === 'label' ? attached.has(r.owner) : r.owner === nodeId))
}

export type BindingTarget =
  { kind: 'node'; id: string } | { kind: 'label'; id: string } | { kind: 'status'; id: string } | { kind: 'none' }

/** 面板编辑的对象:恰好选中一个节点,或恰好选中一个数值标签;其余(没选 / 多选 / 选了别的)为 none */
export function bindingTarget(doc: SldDoc, sel: SldSelection): BindingTarget {
  const total = sel.nodes.length + sel.buses.length + sel.wires.length + sel.labels.length + (sel.frames?.length ?? 0)
  if (total !== 1) return { kind: 'none' }
  if (sel.nodes.length === 1 && findNode(doc, sel.nodes[0]!)) return { kind: 'node', id: sel.nodes[0]! }
  if (sel.labels.length === 1 && findValueLabel(doc, sel.labels[0]!)) return { kind: 'label', id: sel.labels[0]! }
  if (sel.labels.length === 1 && doc.labels.find(l => l.id === sel.labels[0])?.kind === 'status')
    return { kind: 'status', id: sel.labels[0]! }
  return { kind: 'none' }
}

/** 页签角标:选中节点(或选中的单个数值标签)名下没绑上的引用数 */
export function unboundCount(content: SldEditorContent, sel: SldSelection): number {
  const target = bindingTarget(content.doc, sel)
  if (target.kind === 'none') return 0
  const refs =
    target.kind === 'node'
      ? nodePointRefs(content.doc, target.id)
      : collectPointRefs(content.doc).filter(r => r.from === 'label' && r.owner === target.id)
  return refs.filter(r => !isPointBound(bindingOf(content, r.pt))).length
}

/** 引用 → 选择集(概览里点一条未绑的:状态测点选节点,标签选标签) */
export const selectionOfRef = (ref: SldPointRef): Partial<SldSelection> =>
  ref.from === 'label' ? { labels: [ref.owner] } : { nodes: [ref.owner] }

/** 设备树里按类型 + 名字找实体(图里只存名字,要 id 时回树上找) */
export function findEntityByName(
  tree: MetaNode | null | undefined,
  type: string,
  name: string
): (EntityRef & { profile?: string }) | undefined {
  if (!tree || !name) return undefined
  const stack: MetaNode[] = [tree]
  while (stack.length) {
    const n = stack.pop()!
    if (n.entity && n.entity.type === type && (n.entity.name || n.name) === name)
      return { ...n.entity, name, ...(n.profile ? { profile: n.profile } : {}) }
    stack.push(...n.children)
  }
  return undefined
}

/** 设备树里按节点 id 找节点 */
export function findMetaNode(tree: MetaNode | null | undefined, id: string): MetaNode | undefined {
  if (!tree) return undefined
  const stack: MetaNode[] = [tree]
  while (stack.length) {
    const n = stack.pop()!
    if (n.id === id) return n
    stack.push(...n.children)
  }
  return undefined
}

/**
 * 给 BindingRow 看的绑定:实体只有 name 没有 id(复制间隔改绑之后)时,回设备树按名补上 id,
 * 不然 BindingRow 认为没选实体、也拉不到 key。只影响显示;用户真改了才会写回。
 */
export function hydrateBinding(b: Binding | null, tree: MetaNode | null | undefined): Binding | null {
  // 接线图的测点绑定不走「跟随上下文」(图里的设备是画死的);万一手写了,原样放过
  if (!b || !('entity' in b) || !b.entity || isContextRef(b.entity) || b.entity.id || !b.entity.name) return b
  const hit = findEntityByName(tree, b.entity.type, b.entity.name)
  return hit ? ({ ...b, entity: { type: hit.type, id: hit.id, name: hit.name } } as Binding) : b
}

/**
 * BindingRow 刚选了 mode、实体还空着时,默认带出节点的设备(BindingRow 自己没有「初始实体」的入口,在外面补)。
 * 树上找得到就带 id;找不到只带名字(照样算绑了实体,发布时按名解析)。
 */
export function withDefaultEntity(
  b: Binding | null,
  entity: SldEntityName | undefined,
  tree: MetaNode | null | undefined
): Binding | null {
  if (!b || !entity || !('entity' in b) || isContextRef(b.entity) || b.entity?.id || b.entity?.name) return b
  const hit = findEntityByName(tree, entity.type, entity.name)
  return { ...b, entity: { type: entity.type, id: hit?.id ?? '', name: entity.name } } as Binding
}

/* ───────────── 绑定的增删 ───────────── */

/** pt 已经没人引用了就删掉它的绑定;还有人引用则保留 */
export function pruneBinding(draft: SldEditorContent, pt: string): boolean {
  if (collectPointRefs(draft.doc).some(r => r.pt === pt)) return false
  const slot = sldPointSlot(pt)
  if (!(slot in draft.bindings)) return false
  delete draft.bindings[slot]
  return true
}

/**
 * 写某一处引用的绑定。owner 当前的 pt 被别处共用时,先给 owner 换一个新 pt(写时复制)。
 * binding 为 null = 解绑(引用还在,只是没绑上);共用的 pt 解绑同样先分家。
 */
function writeBinding(
  draft: SldEditorContent,
  owner: { pt: string },
  binding: Binding | null,
  newPointId: () => string
): void {
  const shared = collectPointRefs(draft.doc).filter(r => r.pt === owner.pt).length > 1
  if (shared) owner.pt = newPointId()
  const slot = sldPointSlot(owner.pt)
  if (binding) draft.bindings[slot] = binding
  else delete draft.bindings[slot]
}

/* ───────────── 节点:设备 ───────────── */

export function setNodeEntity(draft: SldEditorContent, nodeId: string, entity: SldEntityName | null): void | false {
  const n = findNode(draft.doc, nodeId)
  if (!n) return false
  if (entity) n.entity = { type: entity.type, name: entity.name }
  else delete n.entity
}

/* ───────────── 节点:开关状态 ───────────── */

/** 设状态测点;节点还没有 state 时顺手建上(默认映射 1 合 / 0 分)。binding 为 null 只解绑,state 与映射表保留 */
export function setStateBinding(
  draft: SldEditorContent,
  nodeId: string,
  binding: Binding | null,
  newPointId: () => string
): void | false {
  const n = findNode(draft.doc, nodeId)
  if (!n) return false
  if (!n.state) {
    if (!binding) return false
    n.state = { pt: newPointId(), map: { ...DEFAULT_STATE_MAP } }
  }
  writeBinding(draft, n.state, binding, newPointId)
}

/** 去掉节点的状态来源(回到「没配 state 视为常合」),并清理没人引用的绑定 */
export function clearState(draft: SldEditorContent, nodeId: string): void | false {
  const n = findNode(draft.doc, nodeId)
  if (!n?.state) return false
  const pt = n.state.pt
  delete n.state
  pruneBinding(draft, pt)
}

export function setStateMap(draft: SldEditorContent, nodeId: string, map: SldStateMap): void | false {
  const n = findNode(draft.doc, nodeId)
  if (!n?.state) return false
  n.state.map = { ...map }
}

/** 取反:合 ↔ 分(现场常见「1 = 分」的接法) */
export const invertStateMap = (map: SldStateMap): SldStateMap =>
  Object.fromEntries(Object.entries(map).map(([k, v]) => [k, v === 'closed' ? 'open' : 'closed']))

/* ───────────── 键值表(状态映射 / 枚举文字共用) ───────────── */

/** 加一行:键取下一个没用过的非负整数 */
export function mapAddRow<V extends string>(map: Record<string, V>, value: V): Record<string, V> {
  let i = 0
  while (Object.prototype.hasOwnProperty.call(map, String(i))) i += 1
  return { ...map, [String(i)]: value }
}

/** 改键;新键为空或已存在则原样返回(不许两行同键,也不许悄悄覆盖另一行) */
export function mapRenameKey<V extends string>(map: Record<string, V>, from: string, to: string): Record<string, V> {
  const key = to.trim()
  if (!key || key === from || !Object.prototype.hasOwnProperty.call(map, from)) return map
  if (Object.prototype.hasOwnProperty.call(map, key)) return map
  return Object.fromEntries(Object.entries(map).map(([k, v]) => [k === from ? key : k, v])) as Record<string, V>
}

export const mapSetValue = <V extends string>(map: Record<string, V>, key: string, value: V): Record<string, V> =>
  Object.prototype.hasOwnProperty.call(map, key) ? { ...map, [key]: value } : map

export function mapRemoveRow<V extends string>(map: Record<string, V>, key: string): Record<string, V> {
  const next = { ...map }
  delete next[key]
  return next
}

/* ───────────── 在线状态(2026-09-20) ───────────── */

/** TB 给每台设备维护的在线标志:服务端属性 `active`(true / false),只在上下线时更新 */
export const ONLINE_ATTR_KEY = 'active'

/** 某个实体的「在线」绑定:服务端属性 active。实体 id 此刻不知道就留空,发布时按名解析(ADR-002) */
export function onlineBindingOf(entity: SldEntityName, tree: MetaNode | null | undefined): Binding {
  const hit = findEntityByName(tree, entity.type, entity.name)
  return {
    mode: 'attr',
    entity: { type: entity.type, id: hit?.id ?? '', name: entity.name },
    scope: 'SERVER_SCOPE',
    key: ONLINE_ATTR_KEY,
  }
}

/**
 * 给节点开 / 关在线灯。开的时候节点有设备就**自动绑好**它的 active,不用人再去选测点;
 * 没设备也能开(灯先是灰的,在下面的绑定行里自己选)。关掉时清理没人引用的绑定。
 */
export function setNodeOnline(
  draft: SldEditorContent,
  nodeId: string,
  on: boolean,
  tree: MetaNode | null | undefined,
  newPointId: () => string
): void | false {
  const n = findNode(draft.doc, nodeId)
  if (!n) return false
  if (!on) {
    if (!n.online) return false
    const pt = n.online.pt
    delete n.online
    pruneBinding(draft, pt)
    return
  }
  if (n.online) return false
  n.online = { pt: newPointId() }
  if (n.entity) draft.bindings[sldPointSlot(n.online.pt)] = onlineBindingOf(n.entity, tree)
}

export function setOnlineBinding(
  draft: SldEditorContent,
  nodeId: string,
  binding: Binding | null,
  newPointId: () => string
): void | false {
  const n = findNode(draft.doc, nodeId)
  if (!n?.online) return false
  writeBinding(draft, n.online, binding, newPointId)
}

export function setOnlineCorner(draft: SldEditorContent, nodeId: string, at: 'tl' | 'tr' | 'bl' | 'br'): void | false {
  const n = findNode(draft.doc, nodeId)
  if (!n?.online) return false
  if (at === 'tr') delete n.online.at
  else n.online.at = at
}

/**
 * 选中的节点里,**有设备、还没有在线灯**的一次全开(一张图几十台设备,逐个勾太累)。返回开了几个。
 */
export function enableOnlineForNodes(
  draft: SldEditorContent,
  nodeIds: readonly string[],
  tree: MetaNode | null | undefined,
  newPointId: () => string
): number {
  let n = 0
  for (const id of nodeIds) {
    const node = findNode(draft.doc, id)
    if (!node?.entity || node.online) continue
    setNodeOnline(draft, id, true, tree, newPointId)
    n++
  }
  return n
}

/** 状态标签(灯 + 文字)的绑定 */
export function setStatusLabelBinding(
  draft: SldEditorContent,
  labelId: string,
  binding: Binding | null,
  newPointId: () => string
): void | false {
  const l = draft.doc.labels.find(x => x.id === labelId)
  if (l?.kind !== 'status') return false
  writeBinding(draft, l, binding, newPointId)
}

/* ───────────── 数值标签 ───────────── */

export const attachedValueLabels = (doc: SldDoc, nodeId: string): SldValueLabel[] =>
  doc.labels.filter((l): l is SldValueLabel => l.kind === 'value' && l.attach === nodeId)

/**
 * 节点的下一个标签位(画布坐标)。图元的 labelSlots 经 symbolPoint 换算(与端口同一套镜像 / 旋转规则),
 * 依次找第一个没被本节点的标签占着的;都占了就从最后一个位往下每 20 顺延。图元没声明 labelSlots 时从包围盒右侧起。
 */
export function nextLabelPosition(doc: SldDoc, node: SldNode, def: SldSymbolDefinition | undefined): SldPoint {
  const taken = new Set(doc.labels.filter(l => l.attach === node.id).map(l => `${l.x},${l.y}`))
  const free = (p: SldPoint): boolean => !taken.has(`${p.x},${p.y}`)
  const slots: SldPoint[] = (def?.labelSlots ?? []).map(s => {
    // 缩放与端口同一套(等比倍数,或设备框的自由宽高)
    const { kx, ky } = nodeScaleXY(node, def)
    const q = symbolPoint(def!, node.rot, !!node.flip, s.dx, s.dy, kx, ky)
    return { x: node.x + q.x, y: node.y + q.y }
  })
  const hit = slots.find(free)
  if (hit) return hit
  const last = slots[slots.length - 1]
  const p: SldPoint = last
    ? { x: last.x, y: last.y + LABEL_ROW }
    : { x: node.x + (def ? nodeBox(node, def).w : 40) + LABEL_GAP, y: node.y }
  while (!free(p)) p.y += LABEL_ROW
  return p
}

export interface NewValueLabel {
  title?: string
  format?: SldValueFormat
  color?: SldLabelColor
  binding?: Binding
}

/** 给节点加一个数值标签(依附节点、放到下一个标签位);给了 binding 就一起写上 */
export function addValueLabel(
  draft: SldEditorContent,
  nodeId: string,
  ids: { label: string; pt: string },
  symbols: SldSymbolLookup,
  init: NewValueLabel = {}
): SldValueLabel | false {
  const n = findNode(draft.doc, nodeId)
  if (!n) return false
  const at = nextLabelPosition(draft.doc, n, symbols(n.symbol))
  const label: SldValueLabel = {
    id: ids.label,
    x: at.x,
    y: at.y,
    attach: nodeId,
    kind: 'value',
    pt: ids.pt,
    ...(init.title ? { title: init.title } : {}),
    ...(init.format && Object.keys(init.format).length ? { format: init.format } : {}),
    ...(init.color ? { color: init.color } : {}),
  }
  draft.doc.labels.push(label)
  if (init.binding) draft.bindings[sldPointSlot(ids.pt)] = init.binding
  return label
}

export function setLabelBinding(
  draft: SldEditorContent,
  labelId: string,
  binding: Binding | null,
  newPointId: () => string
): void | false {
  const l = findValueLabel(draft.doc, labelId)
  if (!l) return false
  writeBinding(draft, l, binding, newPointId)
}

export interface ValueLabelPatch {
  title?: string | null
  color?: SldLabelColor | null
  digits?: number | null
  unit?: string | null
  scale?: number | null
  map?: Record<string, string> | null
}

/** 改标签的显示格式;值为 null / 空串 / NaN = 清掉这一项;format 清空后整个字段删掉 */
export function updateValueLabel(draft: SldEditorContent, labelId: string, patch: ValueLabelPatch): void | false {
  const l = findValueLabel(draft.doc, labelId)
  if (!l) return false
  if ('title' in patch) {
    if (patch.title) l.title = patch.title
    else delete l.title
  }
  if ('color' in patch) {
    if (patch.color) l.color = patch.color
    else delete l.color
  }
  const format: SldValueFormat = { ...(l.format ?? {}) }
  if ('digits' in patch) {
    const d = patch.digits
    if (typeof d === 'number' && Number.isFinite(d)) format.digits = Math.min(6, Math.max(0, Math.round(d)))
    else delete format.digits
  }
  if ('unit' in patch) {
    if (patch.unit) format.unit = patch.unit
    else delete format.unit
  }
  if ('scale' in patch) {
    const s = patch.scale
    if (typeof s === 'number' && Number.isFinite(s) && s !== 0 && s !== 1) format.scale = s
    else delete format.scale
  }
  if ('map' in patch) {
    if (patch.map && Object.keys(patch.map).length) format.map = { ...patch.map }
    else delete format.map
  }
  if (Object.keys(format).length) l.format = format
  else delete l.format
}

/** 删数值标签;它的 pt 没别人引用了就连绑定一起删,还有人引用则保留 */
export function removeValueLabel(draft: SldEditorContent, labelId: string): void | false {
  const l = findValueLabel(draft.doc, labelId)
  if (!l) return false
  draft.doc.labels = draft.doc.labels.filter(x => x.id !== labelId)
  pruneBinding(draft, l.pt)
}

/* ───────────── 从设备树拖设备进画布 ───────────── */

export interface DropEntityInput {
  /** 图里存的实体(只有类型与名字) */
  entity: SldEntityName
  /** 绑定里用的实体(带 id);设备树上找不到时缺省,绑定只带名字 */
  ref?: EntityRef
  /** 显示名;缺省用实体名 */
  displayName?: string
  symbol: SldSymbolDefinition
  /** 落点(画布坐标,已吸栅格)= 节点包围盒左上角,与从图元面板拖图元一致 */
  at: SldPoint
  points?: DefaultPoints
}

/** 落点处建节点,写 entity / name,按默认规则加状态测点与数值标签。返回新节点 id */
export function dropEntity(
  draft: SldEditorContent,
  input: DropEntityInput,
  newId: (kind: 'n' | 'l' | 'p') => string,
  symbols: SldSymbolLookup
): string {
  const { entity, symbol, at, points } = input
  const node = addNode(draft.doc, newId('n'), symbol, at.x, at.y)
  node.entity = { type: entity.type, name: entity.name }
  node.name = input.displayName || entity.name
  const ref: EntityRef = input.ref ?? { type: entity.type, id: '', name: entity.name }
  const ts = (key: string): Binding => ({ mode: 'ts', entity: { type: ref.type, id: ref.id, name: ref.name }, key })
  if (points?.state && symbol.stateBody) {
    const pt = newId('p')
    node.state = { pt, map: { ...points.state.map } }
    draft.bindings[sldPointSlot(pt)] = ts(points.state.key)
  }
  // 拖进来的是设备:顺手把在线状态灯开好、绑上它的 active(2026-09-20;不想要在「绑定」页签里勾掉)
  if (entity.type === 'DEVICE') {
    node.online = { pt: newId('p') }
    draft.bindings[sldPointSlot(node.online.pt)] = {
      mode: 'attr',
      entity: { type: ref.type, id: ref.id, name: ref.name },
      scope: 'SERVER_SCOPE',
      key: ONLINE_ATTR_KEY,
    }
  }
  for (const l of points?.labels ?? []) {
    const format: SldValueFormat = {
      ...(l.digits !== undefined ? { digits: l.digits } : {}),
      ...(l.unit ? { unit: l.unit } : {}),
    }
    addValueLabel(draft, node.id, { label: newId('l'), pt: newId('p') }, symbols, {
      title: l.title,
      format,
      color: l.color,
      binding: ts(l.key),
    })
  }
  return node.id
}
