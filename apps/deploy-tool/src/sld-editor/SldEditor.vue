<script setup lang="ts">
/**
 * 一次接线图编辑器骨架(T5.5,ADR-005)。
 *
 * 数据流:`props.content` → store(文档状态机,撤销 / 重做)→ `syncGraph` 增量同步到 X6 画布;
 * 用户在画布上的操作(拖动、拉伸、拖线、拖拐点)由 x6-adapter 的 read* 读回成对文档的修改,经 store.apply 提交,
 * 再同步回画布——图的真相始终是 SldDoc,X6 只是画布。每次文档变化 emit `update:content`。
 *
 * 扩展点(ext.ts):本组件实现 SldEditorContext 并 provide;面板 / 工具 / 拖放 / 图层由 discover.ts 自动发现。
 */
import { computed, nextTick, onBeforeUnmount, onMounted, provide, reactive, ref, shallowRef, watch } from 'vue'
import { getTeleport } from '@antv/x6-vue-shape'
import {
  SLD_GRID,
  SldSymbolBox,
  listSldSymbols,
  lookupSldSymbol,
  registerBuiltinSldSymbols,
  type SldPoint,
  type SldSelection,
  type SldSymbolCategory,
  type SldSymbolDefinition,
} from '@grid/scada-renderer'
import { SLD_EDITOR_CTX, type SldEditorContent, type SldEditorHost, type SldRecipe, type SldToolExt } from './ext'
import type { SldEditorContextEx } from './context'
import { discoverExtensions } from './discover'
import { buildKeymap, comboOfEvent, dispatchDrop, findDrop, groupTools, isTypingTarget } from './extensions'
import { createSldStore, selectionSize } from './store'
import {
  addNode,
  addWire,
  applyGeometry,
  busFromDrag,
  copyFragment,
  deleteSelection,
  flipSelection,
  fragmentSize,
  frameFromDrag,
  moveSelection,
  pasteFragment,
  patchSize,
  rotateSelection,
  snapGrid,
  type SldFragment,
  type SldGeometryPatch,
} from './doc-ops'
import { readEdge, readNodeMove, selectionIds, selectionOfCells, syncGraph } from './x6-adapter'
import { createSldCanvas, kindOfCell, type SldCanvas } from './x6-graph'

const props = defineProps<{
  /** 图 + pt.* 绑定 */
  content: SldEditorContent
  host?: SldEditorHost
  /** 只读(预览实时值时):禁用一切会改文档的操作 */
  readonly?: boolean
}>()
const emit = defineEmits<{
  /** 每次文档变化(apply / 撤销 / 重做) */
  'update:content': [content: SldEditorContent]
  close: []
}>()

// 所有图元节点组件经 Teleport 挂在本组件这一个 app 下(共享 provide)。必须在任何 vue 节点渲染之前调
const TeleportContainer = getTeleport()
if (!listSldSymbols().length) registerBuiltinSldSymbols()

/* ───────────── 文档状态 ───────────── */

const store = createSldStore(props.content)
const isReadonly = computed(() => !!props.readonly)
const doc = computed(() => store.content.value.doc)
/** 我们自己 emit 出去的那个对象:宿主把它原样传回来时不算「换了一份内容」 */
let lastEmitted: SldEditorContent | null = null

watch(
  () => props.content,
  next => {
    if (next === lastEmitted || next === store.content.value) return
    store.reset(next)
  }
)

const canvas = shallowRef<SldCanvas>()
const graph = () => canvas.value?.graph

store.onChange((content, reason) => {
  const g = graph()
  if (g) syncGraph(g, content.doc)
  if (reason === 'reset') return
  lastEmitted = content
  emit('update:content', content)
})

const notice = ref('')
let noticeTimer: ReturnType<typeof setTimeout> | undefined
function flash(msg: string): void {
  notice.value = msg
  clearTimeout(noticeTimer)
  if (msg) noticeTimer = setTimeout(() => (notice.value = ''), 4000)
}
watch(store.notice, msg => msg && flash(msg))

/** 改文档的唯一入口。只读时拒绝;校验回滚时把画布也同步回文档(用户刚拖走的东西回到原位) */
function apply(recipe: SldRecipe, label?: string): boolean {
  if (isReadonly.value) {
    flash('只读模式,不能修改')
    return false
  }
  const ok = store.apply(recipe, label)
  const g = graph()
  if (!ok && g) syncGraph(g, store.content.value.doc)
  return ok
}

/* ───────────── 扩展点上下文 ───────────── */

const zoom = ref(1)
const view = reactive({ tx: 0, ty: 0, s: 1 })

function toCanvas(client: { x: number; y: number }, snap = true): SldPoint {
  const g = graph()
  if (!g) return { x: 0, y: 0 }
  const p = g.clientToLocal(client.x, client.y)
  return snap ? { x: snapGrid(p.x), y: snapGrid(p.y) } : { x: p.x, y: p.y }
}

function select(sel: Partial<SldSelection>, opts?: { center?: boolean }): void {
  store.select(sel)
  const g = graph()
  if (!opts?.center || !g) return
  const cells = selectionIds(store.selection.value).flatMap(id => g.getCellById(id) ?? [])
  const box = cells.length ? g.getCellsBBox(cells) : null
  if (box) g.centerPoint(box.x + box.width / 2, box.y + box.height / 2)
}

const ctx: SldEditorContextEx = {
  content: store.content,
  selection: store.selection,
  readonly: isReadonly,
  apply: (recipe, label) => void apply(recipe, label),
  select,
  newId: kind => store.newId(kind),
  toCanvas,
  get host() {
    return props.host ?? {}
  },
  view: {
    zoom,
    fit: () => graph()?.zoomToFit({ padding: 40, maxScale: 1 }),
    zoomBy: factor => {
      const g = graph()
      if (g) g.zoomTo(Math.min(4, Math.max(0.1, g.zoom() * factor)))
    },
    resetZoom: () => graph()?.zoomTo(1),
  },
}
provide(SLD_EDITOR_CTX, ctx)

const ext = discoverExtensions()
const activePanel = ref(ext.panels[0]?.id ?? '')
const currentPanel = computed(() => ext.panels.find(p => p.id === activePanel.value))
const underLayers = ext.layers.filter(l => l.z === 'under')
const overLayers = ext.layers.filter(l => l.z === 'over')

/* ───────────── 内置操作 ───────────── */

type Mode = 'select' | 'bus' | 'label' | 'frame'
const mode = ref<Mode>('select')
const MODE_HINT: Record<Mode, string> = {
  select: '',
  bus: '画母线:按下拖出一条水平 / 垂直母线(Esc 取消)',
  label: '加文字:点一下放置(Esc 取消)',
  frame: '加分组框:按下拖出一个矩形(Esc 取消)',
}
function setMode(next: Mode): void {
  mode.value = isReadonly.value || mode.value === next ? 'select' : next
  draft.value = null
}

/** 剪贴板放在模块外也行,但两个编辑器实例之间互贴没有意义(id / 测点各管各的),所以跟实例走 */
let clipboard: SldFragment | null = null
const hasClipboard = ref(false)

const hasSelection = computed(() => selectionSize(store.selection.value) > 0)
const canRotate = computed(() => store.selection.value.nodes.length + store.selection.value.buses.length > 0)

function removeSelected(): void {
  const sel = store.selection.value
  if (selectionSize(sel)) apply(d => deleteSelection(d.doc, sel), '删除')
}
function copySelected(): boolean {
  const frag = copyFragment(doc.value, store.selection.value)
  if (!fragmentSize(frag)) return false
  clipboard = frag
  hasClipboard.value = true
  return true
}
function paste(): void {
  if (!clipboard) return
  const frag = clipboard
  let pasted: SldSelection | undefined
  const ok = apply(d => {
    pasted = pasteFragment(d.doc, frag, kind => store.newId(kind), 2 * SLD_GRID)
  }, '粘贴')
  if (!ok || !pasted) return
  store.select(pasted)
  // 下一次粘贴以这次贴出来的为基准,连按几次 Ctrl+V 会一路错开
  clipboard = copyFragment(doc.value, pasted)
}
function cutSelected(): void {
  if (copySelected()) removeSelected()
}
function rotateSelected(): void {
  const sel = store.selection.value
  if (canRotate.value) apply(d => rotateSelection(d.doc, sel, lookupSldSymbol), '旋转 90°')
}
function flipSelected(): void {
  const sel = store.selection.value
  if (sel.nodes.length) apply(d => flipSelection(d.doc, sel), '镜像')
}
function nudge(dx: number, dy: number): void {
  const sel = store.selection.value
  if (selectionSize(sel)) apply(d => moveSelection(d.doc, sel, dx, dy), '微移')
}
function selectAll(): void {
  const d = doc.value
  store.select({
    nodes: d.nodes.map(x => x.id),
    buses: d.buses.map(x => x.id),
    wires: d.wires.map(x => x.id),
    labels: d.labels.map(x => x.id),
    frames: (d.frames ?? []).map(x => x.id),
  })
}
function undo(): void {
  if (!isReadonly.value) store.undo()
}
function redo(): void {
  if (!isReadonly.value) store.redo()
}
function escape(): void {
  if (mode.value !== 'select') setMode('select')
  else store.select({})
}

/** 内置工具也按 SldToolExt 的形状写,和扩展工具一起排进工具栏;active / keys 是骨架内部的附加字段 */
interface BuiltinTool extends SldToolExt {
  keys?: string[]
  active?: () => boolean
  hint?: () => string | undefined
}
const editable = (): boolean => !isReadonly.value
const builtinTools: BuiltinTool[] = [
  {
    id: 'undo',
    title: '撤销',
    group: 'edit',
    order: 1,
    keys: ['ctrl+z'],
    enabled: () => editable() && store.canUndo.value,
    hint: () => store.undoLabel.value && `撤销:${store.undoLabel.value}`,
    run: undo,
  },
  {
    id: 'redo',
    title: '重做',
    group: 'edit',
    order: 2,
    keys: ['ctrl+y', 'ctrl+shift+z'],
    enabled: () => editable() && store.canRedo.value,
    hint: () => store.redoLabel.value && `重做:${store.redoLabel.value}`,
    run: redo,
  },
  {
    id: 'copy',
    title: '复制',
    group: 'edit',
    order: 10,
    keys: ['ctrl+c'],
    enabled: () => hasSelection.value,
    run: () => void copySelected(),
  },
  {
    id: 'paste',
    title: '粘贴',
    group: 'edit',
    order: 11,
    keys: ['ctrl+v'],
    enabled: () => editable() && hasClipboard.value,
    run: paste,
  },
  {
    id: 'delete',
    title: '删除',
    group: 'edit',
    order: 12,
    keys: ['delete', 'backspace'],
    enabled: () => editable() && hasSelection.value,
    run: removeSelected,
  },
  {
    id: 'rotate',
    title: '旋转 90°',
    group: 'arrange',
    order: 1,
    keys: ['r'],
    enabled: () => editable() && canRotate.value,
    run: rotateSelected,
  },
  {
    id: 'flip',
    title: '镜像',
    group: 'arrange',
    order: 2,
    keys: ['f'],
    enabled: () => editable() && store.selection.value.nodes.length > 0,
    run: flipSelected,
  },
  {
    id: 'mode-bus',
    title: '画母线',
    group: 'arrange',
    order: 10,
    keys: ['b'],
    enabled: editable,
    active: () => mode.value === 'bus',
    run: () => setMode('bus'),
  },
  {
    id: 'mode-label',
    title: '加文字',
    group: 'arrange',
    order: 11,
    keys: ['t'],
    enabled: editable,
    active: () => mode.value === 'label',
    run: () => setMode('label'),
  },
  {
    id: 'mode-frame',
    title: '加分组框',
    group: 'arrange',
    order: 12,
    keys: ['g'],
    enabled: editable,
    active: () => mode.value === 'frame',
    run: () => setMode('frame'),
  },
  { id: 'zoom-out', title: '缩小', group: 'view', order: 10, keys: ['ctrl+-'], run: () => ctx.view.zoomBy(1 / 1.2) },
  { id: 'zoom-reset', title: '100%', group: 'view', order: 11, run: () => ctx.view.resetZoom() },
  { id: 'zoom-in', title: '放大', group: 'view', order: 12, keys: ['ctrl+='], run: () => ctx.view.zoomBy(1.2) },
]
const toolbar = groupTools<BuiltinTool>([...builtinTools, ...ext.tools])

function runTool(tool: SldToolExt): void {
  if (tool.enabled && !tool.enabled(ctx)) return
  try {
    void Promise.resolve(tool.run(ctx)).catch(err => flash(`「${tool.title}」出错:${String(err)}`))
  } catch (err) {
    flash(`「${tool.title}」出错:${String(err)}`)
  }
}
const toolTitle = (t: BuiltinTool): string => {
  const keys = t.keys?.[0] ?? t.shortcut
  return `${t.hint?.() || t.title}${keys ? `(${keys.toUpperCase()})` : ''}`
}

/* ───────────── 键盘 ───────────── */

const keymap = buildKeymap(
  [
    ...builtinTools.map(t => ({ id: t.id, combos: t.keys ?? [], run: () => runTool(t) })),
    { id: 'cut', combos: ['ctrl+x'], run: cutSelected },
    { id: 'select-all', combos: ['ctrl+a'], run: selectAll },
    { id: 'escape', combos: ['escape'], run: escape },
    { id: 'left', combos: ['left'], run: () => nudge(-SLD_GRID, 0) },
    { id: 'right', combos: ['right'], run: () => nudge(SLD_GRID, 0) },
    { id: 'up', combos: ['up'], run: () => nudge(0, -SLD_GRID) },
    { id: 'down', combos: ['down'], run: () => nudge(0, SLD_GRID) },
  ],
  ext.tools,
  runTool
)

const rootEl = ref<HTMLElement>()
/** 键盘只在「最近一次按下鼠标是在编辑器里」时接管——编辑器嵌在别的页面里时,不抢宿主其它区域的按键 */
let active = true
function onDocPointerDown(e: PointerEvent): void {
  active = !!rootEl.value && rootEl.value.contains(e.target as Node | null)
}
function onKeyDown(e: KeyboardEvent): void {
  if (!active || isTypingTarget(e.target)) return
  const hit = keymap.get(comboOfEvent(e))
  if (!hit) return
  e.preventDefault()
  hit.run()
}

/* ───────────── 画布 ───────────── */

const canvasEl = ref<HTMLElement>()
const minimapEl = ref<HTMLElement>()

function onDropSymbol(symbolId: string, at: SldPoint): void {
  const def = lookupSldSymbol(symbolId)
  if (!def) return
  const id = store.newId('n')
  if (apply(d => void addNode(d.doc, id, def, at.x, at.y), `放置${def.name}`)) store.select({ nodes: [id] })
}

function geometryLabel(p: SldGeometryPatch): string {
  if (p.buses.length === 1 && patchSize(p) === 1) return '调整母线'
  if (p.frames.length === 1 && patchSize(p) === 1) return '调整分组框'
  if (p.wires.length && patchSize(p) === p.wires.length) return '调整拐点'
  return '移动'
}

/** 一次鼠标操作结束后:画布和文档比一遍,不一样的几何量(位置 / 母线端点 / 框尺寸 / 拐点)读回文档 */
function commitGeometry(): void {
  const g = graph()
  if (!g || isReadonly.value) return
  const patch = readNodeMove(g, doc.value)
  if (patchSize(patch)) apply(d => applyGeometry(d.doc, patch), geometryLabel(patch))
}
let pointerDown = false
let commitTimer: ReturnType<typeof setTimeout> | undefined
function scheduleCommit(): void {
  clearTimeout(commitTimer)
  commitTimer = setTimeout(commitGeometry, 0)
}
function onDocMouseDown(): void {
  pointerDown = true
}
function onDocMouseUp(): void {
  pointerDown = false
  scheduleCommit()
}

/** store 的选择集 → 画布(ctx.select、粘贴后选中新元素、删除后剔除…) */
let syncingSelection = false
function pushSelection(): void {
  const g = graph()
  if (!g) return
  const want = selectionIds(store.selection.value).filter(id => g.hasCell(id))
  const have = g
    .getSelectedCells()
    .filter(c => kindOfCell(c))
    .map(c => c.id)
  if (want.length === have.length && want.every(id => have.includes(id))) return
  syncingSelection = true
  try {
    g.resetSelection(want)
  } finally {
    syncingSelection = false
  }
}
watch(store.selection, pushSelection)

function refreshView(): void {
  const g = graph()
  if (!g) return
  const t = g.translate()
  const s = g.scale()
  Object.assign(view, { tx: t.tx, ty: t.ty, s: s.sx })
  zoom.value = s.sx
}

onMounted(async () => {
  await nextTick()
  if (!canvasEl.value || !minimapEl.value) return
  const c = createSldCanvas(canvasEl.value, minimapEl.value, { isReadonly: () => isReadonly.value, onDropSymbol })
  canvas.value = c
  const g = c.graph

  g.on('translate', refreshView)
  g.on('scale', refreshView)

  g.on('selection:changed', ({ selected }) => {
    if (syncingSelection) return
    store.select(selectionOfCells(selected.map(cell => ({ id: cell.id, data: cell.getData() as { kind?: string } }))))
  })

  // 拖线落定:草稿线读成 SldWire 进文档,草稿随即删掉;正式的线由 syncGraph 按文档建
  g.on('edge:connected', ({ edge, type, e }) => {
    if (kindOfCell(edge) !== 'draft') return
    const at = g.clientToLocal(e.clientX, e.clientY)
    const ends = readEdge(g, edge, { type, at: { x: at.x, y: at.y } })
    g.removeCell(edge)
    if (!ends) return
    const id = store.newId('w')
    if (apply(d => (addWire(d.doc, id, ends.from, ends.to) ? undefined : false), '连线')) store.select({ wires: [id] })
  })

  // 选中连线 → 拐点 / 线段手柄(拐点吸附栅格由 X6 的 snapToGrid 保证;双击拐点删除是 vertices 工具自带的)
  g.on('edge:selected', ({ edge }) => {
    if (isReadonly.value || kindOfCell(edge) !== 'wire') return
    edge.addTools([
      { name: 'vertices', args: { snapRadius: SLD_GRID, attrs: { r: 5, fill: '#19b7ff', stroke: '#061024' } } },
      { name: 'segments', args: { snapRadius: SLD_GRID, attrs: { fill: '#19b7ff', stroke: '#061024' } } },
    ])
  })
  g.on('edge:unselected', ({ edge }) => edge.removeTools())
  // 双击删拐点不经过 mouseup 之后的那次比对(dblclick 在第二次 mouseup 之后才触发),单独接一下
  g.on('edge:change:vertices', ({ options }) => {
    if ((options as { sld?: string }).sld !== 'sync' && !pointerDown) scheduleCommit()
  })

  syncGraph(g, doc.value)
  pushSelection()
  g.zoomToFit({ padding: 40, maxScale: 1 })
  refreshView()

  document.addEventListener('pointerdown', onDocPointerDown, true)
  document.addEventListener('mousedown', onDocMouseDown, true)
  document.addEventListener('mouseup', onDocMouseUp)
  window.addEventListener('keydown', onKeyDown)
})

watch(isReadonly, ro => {
  if (ro) setMode('select')
  // 只读时收起连线手柄;回到可编辑时要重新选一次才出现
  for (const e of graph()?.getEdges() ?? []) e.removeTools()
})

onBeforeUnmount(() => {
  clearTimeout(commitTimer)
  clearTimeout(noticeTimer)
  document.removeEventListener('pointerdown', onDocPointerDown, true)
  document.removeEventListener('mousedown', onDocMouseDown, true)
  document.removeEventListener('mouseup', onDocMouseUp)
  window.removeEventListener('keydown', onKeyDown)
  canvas.value?.dispose()
})

/* ───────────── 画母线 / 加文字 / 加分组框:盖在画布上的一层接鼠标 ───────────── */

const draft = ref<{ a: SldPoint; b: SldPoint } | null>(null)
const draftBus = computed(() =>
  mode.value === 'bus' && draft.value ? busFromDrag(draft.value.a, draft.value.b) : undefined
)
const draftFrame = computed(() =>
  mode.value === 'frame' && draft.value ? frameFromDrag(draft.value.a, draft.value.b) : undefined
)

function onDrawDown(e: PointerEvent): void {
  if (e.button !== 0) return
  const at = toCanvas({ x: e.clientX, y: e.clientY })
  if (mode.value === 'label') {
    const id = store.newId('l')
    if (apply(d => void d.doc.labels.push({ id, x: at.x, y: at.y, kind: 'text', text: '文字' }), '加文字'))
      store.select({ labels: [id] })
    mode.value = 'select'
    return
  }
  ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  draft.value = { a: at, b: at }
}
function onDrawMove(e: PointerEvent): void {
  if (draft.value) draft.value = { a: draft.value.a, b: toCanvas({ x: e.clientX, y: e.clientY }) }
}
function onDrawUp(): void {
  const bus = draftBus.value
  const frame = draftFrame.value
  const was = mode.value
  draft.value = null
  if (was === 'bus' && bus) {
    const id = store.newId('b')
    if (apply(d => void d.doc.buses.push({ id, ...bus }), '画母线')) store.select({ buses: [id] })
    mode.value = 'select'
  } else if (was === 'frame' && frame) {
    const id = store.newId('f')
    const ok = apply(d => {
      d.doc.frames ??= []
      d.doc.frames.push({ id, ...frame, title: '分组' })
    }, '加分组框')
    if (ok) store.select({ frames: [id] })
    mode.value = 'select'
  }
  // 拖得太短:不建,留在当前模式让用户重来
}

/* ───────────── 从画布外拖东西进来(扩展的 drops) ───────────── */

function onDragOver(e: DragEvent): void {
  if (isReadonly.value || !e.dataTransfer || !findDrop(ext.drops, [...e.dataTransfer.types])) return
  e.preventDefault()
  e.dataTransfer.dropEffect = 'copy'
}
function onDrop(e: DragEvent): void {
  if (isReadonly.value || !e.dataTransfer) return
  if (dispatchDrop(ext.drops, ctx, e.dataTransfer, toCanvas({ x: e.clientX, y: e.clientY }))) e.preventDefault()
}

/* ───────────── 图元面板 ───────────── */

const CATEGORY_NAME: Record<SldSymbolCategory, string> = {
  switch: '开关',
  transformer: '变压器',
  measure: '测量',
  source: '电源',
  load: '负荷',
  storage: '储能',
  protect: '保护',
  connect: '连接',
}
const palette = computed(() => {
  const groups = new Map<SldSymbolCategory, SldSymbolDefinition[]>()
  for (const s of listSldSymbols()) groups.set(s.category, [...(groups.get(s.category) ?? []), s])
  return (Object.keys(CATEGORY_NAME) as SldSymbolCategory[])
    .filter(c => groups.has(c))
    .map(c => ({ category: c, name: CATEGORY_NAME[c], symbols: groups.get(c)! }))
})
function startDrag(symbolId: string, e: MouseEvent): void {
  if (e.button === 0) canvas.value?.startSymbolDrag(symbolId, e)
}

const layerStyle = computed(() => ({
  width: `${doc.value.canvas.w}px`,
  height: `${doc.value.canvas.h}px`,
  transform: `translate(${view.tx}px, ${view.ty}px) scale(${view.s})`,
}))
const status = computed(() => {
  const d = doc.value
  return `${d.nodes.length} 图元 · ${d.buses.length} 母线 · ${d.wires.length} 连线 · ${d.labels.length} 标签`
})

defineExpose({ ctx, store })
</script>

<template>
  <div ref="rootEl" class="sld-ed" :class="{ 'sld-ed-readonly': isReadonly }">
    <header class="sld-ed-toolbar">
      <template v-for="(grp, gi) in toolbar" :key="grp.group">
        <span v-if="gi > 0" class="sld-ed-sep" />
        <button
          v-for="t in grp.tools"
          :key="t.id"
          type="button"
          class="sld-ed-btn"
          :class="{ 'sld-ed-btn-on': t.active?.() }"
          :data-tool="t.id"
          :disabled="t.enabled ? !t.enabled(ctx) : false"
          :title="toolTitle(t)"
          @click="runTool(t)"
        >
          {{ t.title }}
        </button>
      </template>
      <span class="sld-ed-grow" />
      <span class="sld-ed-status">{{ status }} · {{ Math.round(zoom * 100) }}%</span>
      <span v-if="isReadonly" class="sld-ed-badge">只读</span>
      <button type="button" class="sld-ed-btn" data-tool="close" title="关闭编辑器" @click="emit('close')">关闭</button>
    </header>

    <aside class="sld-ed-palette">
      <section v-for="grp in palette" :key="grp.category">
        <h4>{{ grp.name }}</h4>
        <div class="sld-ed-symbols">
          <div
            v-for="s in grp.symbols"
            :key="s.id"
            class="sld-ed-symbol"
            :class="{ 'sld-ed-symbol-off': isReadonly }"
            :data-symbol="s.id"
            :title="`${s.name}(拖入画布)`"
            @mousedown="startDrag(s.id, $event)"
          >
            <div class="sld-ed-thumb"><SldSymbolBox :symbol="s.id" /></div>
            <span>{{ s.name }}</span>
          </div>
        </div>
      </section>
      <p class="sld-ed-tips">
        从端口拖线到端口 / 母线任意位置;点连线出拐点手柄,双击拐点删除;滚轮缩放,空格 + 左键或右键拖动平移。
      </p>
    </aside>

    <main class="sld-ed-stage" @dragover="onDragOver" @drop="onDrop">
      <div class="sld-ed-layer sld-ed-layer-under" :style="layerStyle">
        <div class="sld-ed-page" />
        <component :is="l.component" v-for="l in underLayers" :key="l.id" />
      </div>
      <div class="sld-ed-x6"><div ref="canvasEl" /></div>
      <div class="sld-ed-layer sld-ed-layer-over" :style="layerStyle">
        <component :is="l.component" v-for="l in overLayers" :key="l.id" />
        <svg class="sld-ed-draft" width="100%" height="100%">
          <line
            v-if="draftBus"
            :x1="draftBus.x1"
            :y1="draftBus.y1"
            :x2="draftBus.x2"
            :y2="draftBus.y2"
            stroke="currentColor"
            stroke-width="6"
            stroke-linecap="square"
            opacity="0.6"
          />
          <rect
            v-if="draftFrame"
            :x="draftFrame.x"
            :y="draftFrame.y"
            :width="draftFrame.w"
            :height="draftFrame.h"
            fill="none"
            stroke="currentColor"
            stroke-dasharray="6 4"
          />
        </svg>
      </div>
      <div
        v-if="mode !== 'select'"
        class="sld-ed-draw"
        @pointerdown="onDrawDown"
        @pointermove="onDrawMove"
        @pointerup="onDrawUp"
        @pointercancel="draft = null"
      />
      <div v-if="MODE_HINT[mode]" class="sld-ed-hint">{{ MODE_HINT[mode] }}</div>
      <div v-if="notice" class="sld-ed-notice" @click="notice = ''">{{ notice }}</div>
      <div ref="minimapEl" class="sld-ed-minimap" />
    </main>

    <aside class="sld-ed-side">
      <template v-if="ext.panels.length">
        <nav class="sld-ed-tabs">
          <button
            v-for="p in ext.panels"
            :key="p.id"
            type="button"
            :class="{ 'sld-ed-tab-on': p.id === activePanel }"
            :data-panel="p.id"
            @click="activePanel = p.id"
          >
            {{ p.title }}
            <i v-if="p.badge?.(ctx)" class="sld-ed-tab-badge">{{ p.badge(ctx) }}</i>
          </button>
        </nav>
        <div class="sld-ed-panel">
          <component :is="currentPanel.component" v-if="currentPanel" :key="currentPanel.id" />
        </div>
      </template>
      <template v-else>
        <nav class="sld-ed-tabs"><button type="button" class="sld-ed-tab-on">属性</button></nav>
        <div class="sld-ed-panel sld-ed-panel-empty">属性面板(暂无扩展面板)</div>
      </template>
    </aside>

    <component :is="TeleportContainer" v-if="TeleportContainer" />
  </div>
</template>

<style>
/* 深色主题:沿用部署工具编辑器(EditorApp.vue)的 --ed-* 变量,独立使用时走兜底值 */
.sld-ed {
  --sld-bg-0: var(--ed-bg-0, #061024);
  --sld-bg-1: var(--ed-bg-1, #0b1a33);
  --sld-line: var(--ed-line, rgba(83, 196, 255, 0.2));
  --sld-accent: var(--ed-accent, #19b7ff);
  display: grid;
  grid-template: 'bar bar bar' auto 'pal stage side' minmax(0, 1fr) / 168px minmax(0, 1fr) 300px;
  width: 100%;
  height: 100%;
  min-height: 360px;
  color: #dbeaff;
  background: var(--sld-bg-0);
  font:
    13px/1.5 system-ui,
    'PingFang SC',
    'Microsoft YaHei',
    sans-serif;
  box-sizing: border-box;
  user-select: none;
}
.sld-ed *,
.sld-ed *::before,
.sld-ed *::after {
  box-sizing: border-box;
}
.sld-ed-toolbar {
  grid-area: bar;
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 4px;
  padding: 6px 10px;
  background: var(--sld-bg-1);
  border-bottom: 1px solid var(--sld-line);
}
.sld-ed-btn {
  padding: 3px 10px;
  color: inherit;
  font: inherit;
  font-size: 12px;
  background: transparent;
  border: 1px solid var(--sld-line);
  border-radius: 4px;
  cursor: pointer;
}
.sld-ed-btn:hover:not(:disabled) {
  border-color: var(--sld-accent);
}
.sld-ed-btn:disabled {
  opacity: 0.35;
  cursor: default;
}
.sld-ed-btn-on {
  color: #061024;
  background: var(--sld-accent);
  border-color: var(--sld-accent);
}
.sld-ed-sep {
  width: 1px;
  height: 18px;
  margin: 0 4px;
  background: var(--sld-line);
}
.sld-ed-grow {
  flex: 1;
}
.sld-ed-status {
  font-size: 12px;
  opacity: 0.6;
  font-variant-numeric: tabular-nums;
}
.sld-ed-badge {
  padding: 1px 8px;
  font-size: 12px;
  color: #061024;
  background: #f59e0b;
  border-radius: 10px;
}
.sld-ed-palette {
  grid-area: pal;
  padding: 8px;
  overflow: auto;
  background: var(--sld-bg-1);
  border-right: 1px solid var(--sld-line);
}
.sld-ed-palette h4 {
  margin: 6px 0 4px;
  font-size: 12px;
  font-weight: 500;
  opacity: 0.6;
}
.sld-ed-symbols {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 6px;
}
.sld-ed-symbol {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  padding: 6px 2px 4px;
  font-size: 11px;
  border: 1px solid var(--sld-line);
  border-radius: 4px;
  cursor: grab;
}
.sld-ed-symbol:hover {
  border-color: var(--sld-accent);
}
.sld-ed-symbol-off {
  opacity: 0.4;
  cursor: not-allowed;
}
.sld-ed-thumb {
  width: 40px;
  height: 40px;
  color: var(--sld-accent);
}
.sld-ed-tips {
  margin: 12px 2px 0;
  font-size: 11px;
  line-height: 1.6;
  opacity: 0.5;
}
.sld-ed-stage {
  grid-area: stage;
  position: relative;
  overflow: hidden;
  min-width: 0;
  color: var(--sld-accent);
  background: var(--sld-bg-0);
}
.sld-ed-x6 {
  position: absolute;
  inset: 0;
}
.sld-ed-layer {
  position: absolute;
  top: 0;
  left: 0;
  transform-origin: 0 0;
  pointer-events: none;
}
.sld-ed-page {
  position: absolute;
  inset: 0;
  border: 1px dashed var(--sld-line);
  background: rgba(255, 255, 255, 0.015);
}
.sld-ed-draft {
  position: absolute;
  inset: 0;
  overflow: visible;
}
.sld-ed-draw {
  position: absolute;
  inset: 0;
  cursor: crosshair;
  touch-action: none;
}
.sld-ed-hint,
.sld-ed-notice {
  position: absolute;
  left: 50%;
  transform: translateX(-50%);
  padding: 4px 12px;
  font-size: 12px;
  color: #dbeaff;
  background: rgba(11, 26, 51, 0.92);
  border: 1px solid var(--sld-line);
  border-radius: 4px;
  pointer-events: none;
}
.sld-ed-hint {
  top: 10px;
}
.sld-ed-notice {
  bottom: 14px;
  max-width: 70%;
  border-color: #f59e0b;
  pointer-events: auto;
  cursor: pointer;
}
.sld-ed-minimap {
  position: absolute;
  right: 10px;
  bottom: 10px;
  width: 200px;
  height: 130px;
  overflow: hidden;
  border: 1px solid var(--sld-line);
  border-radius: 4px;
  background: var(--sld-bg-1);
}
.sld-ed-minimap .x6-widget-minimap {
  background: transparent;
}
.sld-ed-minimap .x6-widget-minimap .x6-graph {
  box-shadow: none;
  background: transparent;
}
.sld-ed-minimap .x6-widget-minimap-viewport {
  border-color: var(--sld-accent);
}
.sld-ed-side {
  grid-area: side;
  display: flex;
  flex-direction: column;
  min-height: 0;
  background: var(--sld-bg-1);
  border-left: 1px solid var(--sld-line);
}
.sld-ed-tabs {
  display: flex;
  flex: none;
  border-bottom: 1px solid var(--sld-line);
}
.sld-ed-tabs button {
  padding: 7px 14px;
  color: inherit;
  font: inherit;
  font-size: 12px;
  background: transparent;
  border: 0;
  border-bottom: 2px solid transparent;
  opacity: 0.6;
  cursor: pointer;
}
.sld-ed-tabs .sld-ed-tab-on {
  opacity: 1;
  border-bottom-color: var(--sld-accent);
}
.sld-ed-tab-badge {
  margin-left: 4px;
  padding: 0 5px;
  font-style: normal;
  font-size: 11px;
  color: #061024;
  background: #f59e0b;
  border-radius: 8px;
}
.sld-ed-panel {
  flex: 1;
  min-height: 0;
  overflow: auto;
  user-select: text;
}
.sld-ed-panel-empty {
  padding: 16px;
  font-size: 12px;
  opacity: 0.5;
}
/* X6 画布里的东西 */
.sld-ed-x6 .sld-node-view {
  width: 100%;
  height: 100%;
  color: var(--sld-accent);
}
.sld-ed-x6 .sld-node-source {
  color: #f87171;
}
.sld-ed-x6 .sld-port {
  opacity: 0.25;
  transition: opacity 0.1s;
}
.sld-ed-x6 .x6-node:hover .sld-port,
.sld-ed-x6 .x6-port-body[magnet='true'].available .sld-port,
.sld-ed-x6 .sld-port:hover {
  opacity: 1;
}
.sld-ed-readonly .sld-ed-x6 .sld-port {
  display: none;
}
.sld-ed-x6 .sld-pannable {
  cursor: grab;
}
.sld-ed-x6 .sld-panning {
  cursor: grabbing;
}
.sld-ed .x6-widget-selection-box {
  border: 1px dashed var(--sld-accent);
  box-shadow: none;
}
.sld-ed .x6-widget-selection-inner {
  border: 0;
  box-shadow: none;
}
.sld-ed .x6-widget-transform {
  border-color: var(--sld-accent);
}
</style>
