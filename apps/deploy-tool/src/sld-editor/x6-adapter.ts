/**
 * SldDoc ⇄ X6(T5.5;ADR-005 D7:X6 被隔离在这里与画布组件内,图的真相始终是 SldDoc)。
 *
 * 两层:
 * 1. **纯函数层**:`docToCells()` 把文档翻成「X6 cell 描述」(plain JSON,能直接喂给 graph.addNode / addEdge),
 *    `cellsToDoc()` 反向;`diffGeometry()` 比较画布快照与文档、给出几何变化。无 X6 运行时依赖,可单测往返。
 * 2. **薄的 Graph 操作层**:`syncGraph()` 按 id 增量同步;`readNodeMove()` / `readBusResize()` / `readEdge()` /
 *    `readVertices()` 把用户在画布上的操作读回成对文档的修改(调用方再经 store.apply 提交)。
 *
 * 本文件对 X6 只有**类型**依赖(import type),不加载 X6 运行时。
 *
 * 关键语义:
 * - `SldNode.x / y` 是旋转 / 镜像之后画面上的包围盒左上角 → X6 节点**不用 angle**,宽高取 `nodeBox()`,
 *   内部 `<SldSymbolBox :rot :flip>` 自己画旋转;端口用 `portPosition()` 换算成 absolute 布局的 port。
 * - 母线 = 普通 SVG 节点(BUS_THICK 高的透明命中区 + 6px 粗线),中线落栅格;接点位置 `d` 存在连线终端的
 *   anchor 参数里(`{ name: 'sld-bus', args: { d } }`),自定义 anchor 调 `busPoint()` 取点。
 * - 标签的 (x, y) 是文字左端、垂直居中(与运行时 <text dominant-baseline="middle"> 一致)。
 */
import type { Cell, Edge, Graph, Node } from '@antv/x6'
import {
  SLD_BUS_WIDTH,
  SLD_GRID,
  busLength,
  busOffset,
  busPoint,
  lookupSldSymbol,
  nodeBox,
  portDirection,
  portPosition,
  unknownSldSymbol,
  type SldBus,
  type SldDoc,
  type SldFrame,
  type SldLabel,
  type SldNode,
  type SldPoint,
  type SldPortDir,
  type SldSelection,
  type SldSymbolLookup,
  type SldWire,
  type SldWireEnd,
} from '@grid/scada-renderer'
import { bestPort, busIsHorizontal, emptyPatch, snapGrid, type SldGeometryPatch } from './doc-ops'

export const SHAPE_NODE = 'sld-node'
export const SHAPE_BUS = 'sld-bus'
export const SHAPE_LABEL = 'sld-label'
export const SHAPE_FRAME = 'sld-frame'
export const SHAPE_WIRE = 'edge'
/** 自定义 anchor 的名字(母线任意点接线) */
export const BUS_ANCHOR = 'sld-bus'
/** 母线节点的命中盒厚度(可见粗线 6px)。取 2×栅格:X6 把节点左上角吸到栅格,中线也就落在栅格上 */
export const BUS_THICK = 2 * SLD_GRID
/** 母线线宽的缺省值:与运行时一致(SLD_BUS_WIDTH);单条母线可在属性面板里改(bus.width) */
export const BUS_LINE = SLD_BUS_WIDTH
export const PORT_GROUP = 'p'

/**
 * X6 的 zIndex。与运行时同一套规则(SldBus.z 的说明):先比 z,再按「母线 < 连线 < 图元」——
 * 所以每一级 z 占 1000,同级里母线 100 / 连线 200 / 图元 300;分组框恒在最底,标签恒在最上。
 */
export const Z = { frame: -1_000_000, bus: 100, wire: 200, node: 300, label: 1_000_000 } as const
const Z_STEP = 1000
export const stackZ = (base: number, z: number | undefined): number =>
  base + (typeof z === 'number' && Number.isFinite(z) ? Math.round(z) : 0) * Z_STEP

/* ───────────── cell 描述(plain JSON) ───────────── */

/** X6 的 attrs:selector → { 属性: 值 }(值只用到标量) */
export type SldCellAttrs = Record<string, Record<string, string | number | boolean | null>>

export interface SldNodeCell {
  id: string
  shape: typeof SHAPE_NODE
  x: number
  y: number
  width: number
  height: number
  zIndex: number
  data: { kind: 'node'; node: SldNode }
  ports: { items: Array<{ id: string; group: string; args: { x: number; y: number } }> }
}

export interface SldBusCell {
  id: string
  shape: typeof SHAPE_BUS
  x: number
  y: number
  width: number
  height: number
  zIndex: number
  /** reversed:文档里 (x1,y1) 不是左端 / 上端(不合约定,但不能因为过一遍画布就把 d 的含义改了) */
  data: { kind: 'bus'; bus: SldBus; horizontal: boolean; reversed: boolean }
  attrs: SldCellAttrs
}

export interface SldLabelCell {
  id: string
  shape: typeof SHAPE_LABEL
  x: number
  y: number
  width: number
  height: number
  zIndex: number
  data: { kind: 'label'; label: SldLabel }
  attrs: SldCellAttrs
}

export interface SldFrameCell {
  id: string
  shape: typeof SHAPE_FRAME
  x: number
  y: number
  width: number
  height: number
  zIndex: number
  data: { kind: 'frame'; frame: SldFrame }
  attrs: SldCellAttrs
}

export type SldTerminal =
  { cell: string; port: string } | { cell: string; anchor: { name: string; args: { d: number } } }

export interface SldWireCell {
  id: string
  shape: typeof SHAPE_WIRE
  source: SldTerminal
  target: SldTerminal
  vertices: Array<{ x: number; y: number }>
  zIndex: number
  data: { kind: 'wire' }
  router: { name: string }
  connector: { name: string; args: { radius: number } }
  attrs: SldCellAttrs
}

export type SldBoxCell = SldNodeCell | SldBusCell | SldLabelCell | SldFrameCell
export type SldCell = SldBoxCell | SldWireCell
export type SldCellKind = SldCell['data']['kind']

/**
 * 画布快照:从 X6 cell 上读回来的最小信息(形状与 cell 描述的子集一致,所以 cell 描述本身也是合法快照)。
 * 画布上不是本适配器建的 cell(拖线中的草稿线、Dnd 的影子节点…)没有 data.kind,一律忽略。
 */
export type SldBoxSnapshot = Pick<SldBoxCell, 'id' | 'shape' | 'x' | 'y' | 'width' | 'height' | 'data'>
export type SldWireSnapshot = Pick<SldWireCell, 'id' | 'shape' | 'source' | 'target' | 'vertices' | 'data'>
export type SldSnapshot = SldBoxSnapshot | SldWireSnapshot

/* ───────────── 纯函数层:doc → cells ───────────── */

const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T

export function nodeToCell(node: SldNode, symbols: SldSymbolLookup = lookupSldSymbol): SldNodeCell {
  const def = symbols(node.symbol)
  // 未知图元:占位框不旋转(与 <SldSymbol> 一致),没有端口
  const box = def ? nodeBox(node, def) : { w: unknownSldSymbol.w, h: unknownSldSymbol.h }
  const items = (def?.ports ?? []).map(p => {
    const at = portPosition(node, def!, p.id)!
    return { id: p.id, group: PORT_GROUP, args: { x: at.x - node.x, y: at.y - node.y } }
  })
  return {
    id: node.id,
    shape: SHAPE_NODE,
    x: node.x,
    y: node.y,
    width: box.w,
    height: box.h,
    zIndex: stackZ(Z.node, node.z),
    data: { kind: 'node', node: clone(node) },
    ports: { items },
  }
}

/**
 * 母线的 attrs。线体两头各多画半个线宽(refWidth2 / refHeight2 = 线宽,起点退半个线宽)——
 * 相当于运行时的 `stroke-linecap: square`:横竖两条母线端头对端头(L 形)时,拐角那一小块方角才是满的,
 * 否则会缺一个「线宽 / 2 见方」的口子(2026-09-20 YY 提的「横竖母线连接时有空缺」)。
 * setAttrs 是合并语义,所以颜色 / 线宽每次都显式给值,改回缺省时才复位得掉。
 */
export function busAttrs(
  horizontal: boolean,
  name?: string,
  width: number = BUS_LINE,
  color?: string
): SldBusCell['attrs'] {
  const line = width > 0 ? width : BUS_LINE
  const half = -line / 2
  const fill = color || 'currentColor'
  return {
    hit: { refWidth: '100%', refHeight: '100%', fill: 'transparent', stroke: 'none' },
    body: horizontal
      ? {
          refWidth: '100%',
          refWidth2: line,
          refHeight: null,
          refHeight2: null,
          width: null,
          height: line,
          refX: 0,
          refX2: half,
          refY: '50%',
          refY2: half,
          fill,
        }
      : {
          refHeight: '100%',
          refHeight2: line,
          refWidth: null,
          refWidth2: null,
          height: null,
          width: line,
          refY: 0,
          refY2: half,
          refX: '50%',
          refX2: half,
          fill,
        },
    label: { text: name ?? '' },
  }
}

export function busToCell(bus: SldBus): SldBusCell {
  const horizontal = busIsHorizontal(bus)
  const reversed = horizontal ? bus.x1 > bus.x2 : bus.y1 > bus.y2
  const len = horizontal ? Math.abs(bus.x2 - bus.x1) : Math.abs(bus.y2 - bus.y1)
  const half = BUS_THICK / 2
  return {
    id: bus.id,
    shape: SHAPE_BUS,
    x: horizontal ? Math.min(bus.x1, bus.x2) : bus.x1 - half,
    y: horizontal ? bus.y1 - half : Math.min(bus.y1, bus.y2),
    width: horizontal ? len : BUS_THICK,
    height: horizontal ? BUS_THICK : len,
    zIndex: stackZ(Z.bus, bus.z),
    data: { kind: 'bus', bus: clone(bus), horizontal, reversed },
    attrs: busAttrs(horizontal, bus.name, bus.width, bus.color),
  }
}

/** 编辑器里标签显示的文字:文字标签原样;数值标签没有实时值,用「--」占位(与运行时无数据时一致) */
export function labelDisplayText(l: SldLabel): string {
  if (l.kind === 'text') return l.text
  // 状态标签:编辑器里没有实时值,按「在线」的样子占位(与设计态 sampleData 一致)
  if (l.kind === 'status') return `● ${l.title ? l.title + ' ' : ''}在线`
  return `${l.title ? l.title + ' ' : ''}--${l.format?.unit ? ' ' + l.format.unit : ''}`
}

/** 相色约定:a 黄 / b 绿 / c 红;其它字符串当颜色值;缺省 undefined(随主题) */
export function labelColor(l: SldLabel): string | undefined {
  if (!l.color) return undefined
  return { a: '#facc15', b: '#22c55e', c: '#ef4444' }[l.color] ?? l.color
}

/** 估一个文字宽度(没有 DOM 量不了):CJK 按 1em,其它按 0.6em;只用来定标签节点的命中盒 */
export function estimateTextWidth(text: string, size: number): number {
  let em = 0
  for (const ch of text) em += ch.charCodeAt(0) > 0x2e7f ? 1 : 0.6
  return Math.max(SLD_GRID, Math.ceil(em * size))
}

/** 标签缺省字色(与 x6-graph 里注册的一致) */
export const LABEL_FILL = '#c9d8ee'
const l_bold = (l: SldLabel): boolean => !!l.bold

const labelHeight = (size: number): number => Math.max(1, Math.ceil((size * 1.4) / (2 * SLD_GRID))) * 2 * SLD_GRID

export function labelToCell(label: SldLabel): SldLabelCell {
  const size = label.size ?? 12
  const text = labelDisplayText(label)
  const height = labelHeight(size) // 偶数格:半高也是栅格整数倍,y 落栅格的标签其节点左上角也落栅格
  const color = labelColor(label)
  // 分了列的数值标签(colW,2026-09-22)实际占到「列宽 + 单位」那么远;画布上的盒子照这个给,
  // 不然选中框比字窄。列对齐的样子以预览 / 大屏为准,X6 的单行文本画不出三列。
  const colW = label.kind === 'value' && label.colW ? label.colW : 0
  const unit = label.kind === 'value' ? label.format?.unit : undefined
  const width = colW ? colW + (unit ? estimateTextWidth(' ' + unit, size) : 0) : estimateTextWidth(text, size)
  return {
    id: label.id,
    shape: SHAPE_LABEL,
    x: label.x,
    y: label.y - height / 2,
    width,
    height,
    zIndex: Z.label,
    data: { kind: 'label', label: clone(label) },
    attrs: {
      // setAttrs 是合并语义:颜色 / 粗细每次都给,清掉自定义值时才回得到缺省
      text: { text, fontSize: size, fill: color ?? LABEL_FILL, fontWeight: l_bold(label) ? 700 : 400 },
    },
  }
}

/** 分组框缺省边框(与 x6-graph 注册的一致;setAttrs 是合并语义,每次都显式给值才复位得掉) */
export const FRAME_STROKE = '#5b7aa8'
export const FRAME_WIDTH = 1
export const FRAME_DASH = '6 4'

export function frameToCell(frame: SldFrame): SldFrameCell {
  return {
    id: frame.id,
    shape: SHAPE_FRAME,
    x: frame.x,
    y: frame.y,
    width: frame.w,
    height: frame.h,
    zIndex: Z.frame,
    data: { kind: 'frame', frame: clone(frame) },
    attrs: {
      title: { text: frame.title ?? '' },
      body: {
        stroke: frame.color || FRAME_STROKE,
        strokeWidth: frame.width || FRAME_WIDTH,
        strokeDasharray: frame.solid ? 'none' : FRAME_DASH,
      },
    },
  }
}

export const terminalOf = (end: SldWireEnd): SldTerminal =>
  'bus' in end
    ? { cell: end.bus, anchor: { name: BUS_ANCHOR, args: { d: end.d } } }
    : { cell: end.node, port: end.port }

export function wireAttrs(): SldWireCell['attrs'] {
  return { line: { stroke: 'currentColor', strokeWidth: 2, sourceMarker: null, targetMarker: null } }
}

/** 连线的公共属性(不含两端);拖线时 connecting.createEdge 也用它 */
export const wireBase = () => ({
  shape: SHAPE_WIRE,
  zIndex: Z.wire,
  router: { name: 'sld' },
  connector: { name: 'rounded', args: { radius: 4 } },
  attrs: wireAttrs(),
})

export function wireToCell(wire: SldWire): SldWireCell {
  return {
    id: wire.id,
    ...wireBase(),
    shape: SHAPE_WIRE,
    source: terminalOf(wire.from),
    target: terminalOf(wire.to),
    vertices: (wire.vertices ?? []).map(([x, y]) => ({ x, y })),
    data: { kind: 'wire' },
  }
}

/** 文档 → cell 描述。顺序:分组框、母线、节点、标签(都是 X6 节点),最后连线——连线引用的节点必须先建 */
export function docToCells(doc: SldDoc, symbols: SldSymbolLookup = lookupSldSymbol): SldCell[] {
  return [
    ...(doc.frames ?? []).map(frameToCell),
    ...doc.buses.map(busToCell),
    ...doc.nodes.map(n => nodeToCell(n, symbols)),
    ...doc.labels.map(labelToCell),
    ...doc.wires.map(wireToCell),
  ]
}

/* ───────────── 纯函数层:cells → doc ───────────── */

const int = (v: number): number => Math.round(v)

/** 画布上的母线节点 → 母线线段(中线) */
export function busOfCell(cell: SldBoxSnapshot): SldBus | undefined {
  if (cell.data?.kind !== 'bus') return undefined
  const { bus, horizontal, reversed } = cell.data
  const half = BUS_THICK / 2
  const line = horizontal
    ? { x1: int(cell.x), y1: int(cell.y + half), x2: int(cell.x + cell.width), y2: int(cell.y + half) }
    : { x1: int(cell.x + half), y1: int(cell.y), x2: int(cell.x + half), y2: int(cell.y + cell.height) }
  const ends = reversed ? { x1: line.x2, y1: line.y2, x2: line.x1, y2: line.y1 } : line
  // 斜母线(不合约定,validateSldDoc 会报)画布上按主方向画;没被动过就原样还回去,不把它「掰直」
  const same = JSON.stringify(pickBox(busToCell(bus))) === JSON.stringify(pickBox(cell))
  return same ? clone(bus) : { ...clone(bus), ...ends }
}

const pickBox = (c: Pick<SldBoxSnapshot, 'x' | 'y' | 'width' | 'height'>) => [
  int(c.x),
  int(c.y),
  int(c.width),
  int(c.height),
]

export function nodeOfCell(cell: SldBoxSnapshot): SldNode | undefined {
  if (cell.data?.kind !== 'node') return undefined
  return { ...clone(cell.data.node), x: int(cell.x), y: int(cell.y) }
}

export function labelOfCell(cell: SldBoxSnapshot): SldLabel | undefined {
  if (cell.data?.kind !== 'label') return undefined
  return { ...clone(cell.data.label), x: int(cell.x), y: int(cell.y + cell.height / 2) }
}

export function frameOfCell(cell: SldBoxSnapshot): SldFrame | undefined {
  if (cell.data?.kind !== 'frame') return undefined
  return {
    ...clone(cell.data.frame),
    x: int(cell.x),
    y: int(cell.y),
    w: int(cell.width),
    h: int(cell.height),
  }
}

/** 端口出线朝向(按节点当前的旋转 / 镜像);router 用 */
export function portDirOfCell(
  cell: SldBoxSnapshot,
  portId: string,
  symbols: SldSymbolLookup = lookupSldSymbol
): SldPortDir | undefined {
  if (cell.data?.kind !== 'node') return undefined
  const def = symbols(cell.data.node.symbol)
  return def ? portDirection(cell.data.node, def, portId) : undefined
}

export function endOfTerminal(t: SldTerminal | undefined): SldWireEnd | undefined {
  if (!t || typeof t.cell !== 'string') return undefined
  if ('port' in t && typeof t.port === 'string') return { node: t.cell, port: t.port }
  if ('anchor' in t && typeof t.anchor?.args?.d === 'number') return { bus: t.cell, d: t.anchor.args.d }
  return undefined
}

export function wireOfCell(cell: SldWireSnapshot): SldWire | undefined {
  if (cell.data?.kind !== 'wire') return undefined
  const from = endOfTerminal(cell.source)
  const to = endOfTerminal(cell.target)
  if (!from || !to) return undefined
  const vertices = (cell.vertices ?? []).map((v): [number, number] => [int(v.x), int(v.y)])
  return { id: cell.id, from, to, ...(vertices.length ? { vertices } : {}) }
}

const isWireSnap = (c: SldSnapshot): c is SldWireSnapshot => c.data?.kind === 'wire'

/**
 * cell 描述 / 画布快照 → 文档。v / canvas / background 画布上没有,从 base 带过来;
 * `frames` 字段是可选的:base 里有、或画布上有分组框才输出(旧图没有这个字段,往返后也不多出来)。
 */
export function cellsToDoc(cells: ReadonlyArray<SldSnapshot>, base: SldDoc): SldDoc {
  const nodes: SldNode[] = []
  const buses: SldBus[] = []
  const wires: SldWire[] = []
  const labels: SldLabel[] = []
  const frames: SldFrame[] = []
  for (const c of cells) {
    if (isWireSnap(c)) {
      const w = wireOfCell(c)
      if (w) wires.push(w)
      continue
    }
    const n = nodeOfCell(c)
    const b = busOfCell(c)
    const l = labelOfCell(c)
    const f = frameOfCell(c)
    if (n) nodes.push(n)
    else if (b) buses.push(b)
    else if (l) labels.push(l)
    else if (f) frames.push(f)
  }
  return {
    v: base.v,
    canvas: { ...base.canvas },
    ...(base.background ? { background: clone(base.background) } : {}),
    nodes,
    buses,
    wires,
    labels,
    ...(base.frames || frames.length ? { frames } : {}),
  }
}

/* ───────────── 纯函数层:画布快照 vs 文档 ───────────── */

/**
 * 画布上哪些几何量和文档不一样了(用户拖动 / 拉伸 / 拖拐点之后)。
 * 没动过的元素逐字段相等,不进 patch(文档里本来就不落栅格的旧坐标不会被顺手「修」掉);
 * 动过的吸到栅格——Transform 拉伸后坐标会带浮点噪声(Spike A 实测 89.99999999999947)。
 */
export function diffGeometry(
  doc: SldDoc,
  cells: ReadonlyArray<SldSnapshot>,
  only?: ReadonlySet<string>
): SldGeometryPatch {
  const grid = doc.canvas.grid > 0 ? doc.canvas.grid : SLD_GRID
  const s = (v: number): number => snapGrid(v, grid)
  const patch = emptyPatch()
  const nodes = new Map(doc.nodes.map(x => [x.id, x]))
  const buses = new Map(doc.buses.map(x => [x.id, x]))
  const labels = new Map(doc.labels.map(x => [x.id, x]))
  const frames = new Map((doc.frames ?? []).map(x => [x.id, x]))
  const wires = new Map(doc.wires.map(x => [x.id, x]))
  for (const c of cells) {
    if (only && !only.has(c.id)) continue
    if (isWireSnap(c)) {
      const was = wires.get(c.id)
      if (!was) continue
      const now = (c.vertices ?? []).map((v): [number, number] => [int(v.x), int(v.y)])
      if (JSON.stringify(now) !== JSON.stringify(was.vertices ?? []))
        patch.wires.push({ id: c.id, vertices: now.map(([x, y]): [number, number] => [s(x), s(y)]) })
      continue
    }
    const n = nodes.get(c.id) && nodeOfCell(c)
    const b = buses.get(c.id) && busOfCell(c)
    const l = labels.get(c.id) && labelOfCell(c)
    const f = frames.get(c.id) && frameOfCell(c)
    if (n) {
      const was = nodes.get(c.id)!
      if (n.x !== was.x || n.y !== was.y) patch.nodes.push({ id: n.id, x: s(n.x), y: s(n.y) })
    } else if (b) {
      const was = buses.get(c.id)!
      if (b.x1 !== was.x1 || b.y1 !== was.y1 || b.x2 !== was.x2 || b.y2 !== was.y2)
        patch.buses.push({ id: b.id, x1: s(b.x1), y1: s(b.y1), x2: s(b.x2), y2: s(b.y2) })
    } else if (l) {
      const was = labels.get(c.id)!
      if (l.x !== was.x || l.y !== was.y) patch.labels.push({ id: l.id, x: s(l.x), y: s(l.y) })
    } else if (f) {
      const was = frames.get(c.id)!
      if (f.x !== was.x || f.y !== was.y || f.w !== was.w || f.h !== was.h) {
        const x = s(f.x)
        const y = s(f.y)
        patch.frames.push({
          id: f.id,
          x,
          y,
          w: Math.max(2 * grid, s(f.x + f.w) - x),
          h: Math.max(2 * grid, s(f.y + f.h) - y),
        })
      }
    }
  }
  return patch
}

/**
 * 拖线落到母线上时接点取哪:对端在母线的范围内、且离鼠标不远(≤ 3 格)→ 取对端的垂足,线是直的;
 * 否则取鼠标位置的垂足。都经 `busOffset()` 吸附栅格并夹到母线两端。
 */
export function pickBusD(bus: SldBus, mouse: SldPoint, other: SldPoint | undefined, grid: number = SLD_GRID): number {
  if (other) {
    const horizontal = busIsHorizontal(bus)
    const along = (p: SldPoint): number => (horizontal ? p.x : p.y)
    const lo = Math.min(along({ x: bus.x1, y: bus.y1 }), along({ x: bus.x2, y: bus.y2 }))
    const inside = along(other) >= lo && along(other) <= lo + busLength(bus)
    if (inside && Math.abs(along(other) - along(mouse)) <= 3 * grid) return busOffset(bus, other, grid)
  }
  return busOffset(bus, mouse, grid)
}

/** 画布选中的 cell → 选择集(按 data.kind 分桶;不是本适配器的 cell 忽略) */
export function selectionOfCells(cells: ReadonlyArray<{ id: string; data?: { kind?: string } }>): SldSelection {
  const sel: SldSelection = { nodes: [], buses: [], wires: [], labels: [], frames: [] }
  for (const c of cells) {
    const kind = c.data?.kind
    if (kind === 'node') sel.nodes.push(c.id)
    else if (kind === 'bus') sel.buses.push(c.id)
    else if (kind === 'wire') sel.wires.push(c.id)
    else if (kind === 'label') sel.labels.push(c.id)
    else if (kind === 'frame') sel.frames!.push(c.id)
  }
  return sel
}

export const selectionIds = (sel: SldSelection): string[] => [
  ...sel.nodes,
  ...sel.buses,
  ...sel.wires,
  ...sel.labels,
  ...(sel.frames ?? []),
]

/* ───────────── 薄的 Graph 操作层 ───────────── */

const kindOf = (cell: Cell): SldCellKind | undefined => (cell.getData() as { kind?: SldCellKind } | undefined)?.kind

/** 从 X6 cell 读快照;不是本适配器建的 cell 返回 undefined */
export function snapshotOf(cell: Node): SldBoxSnapshot
export function snapshotOf(cell: Cell): SldSnapshot | undefined
export function snapshotOf(cell: Cell): SldSnapshot | undefined {
  const data = cell.getData() as SldCell['data'] | undefined
  if (cell.isNode()) {
    const { x, y } = cell.getPosition()
    const { width, height } = cell.getSize()
    return { id: cell.id, shape: cell.shape, x, y, width, height, data } as SldBoxSnapshot
  }
  if (!cell.isEdge() || data?.kind !== 'wire') return undefined
  return {
    id: cell.id,
    shape: SHAPE_WIRE,
    source: cell.getSource() as SldTerminal,
    target: cell.getTarget() as SldTerminal,
    vertices: cell.getVertices().map(v => ({ x: v.x, y: v.y })),
    data,
  }
}

export function snapshotGraph(graph: Graph): SldSnapshot[] {
  const out: SldSnapshot[] = []
  for (const cell of graph.getCells()) {
    if (!kindOf(cell)) continue
    const s = snapshotOf(cell)
    if (s) out.push(s)
  }
  return out
}

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b)
const SYNC = { sld: 'sync' } as const

/**
 * 把文档增量同步到画布:按 id diff——画布上多出来的删掉、缺的补上、两边都有的只改不一样的字段
 * (位置 / 尺寸 / data / 端口 / 连线两端 / 拐点)。不做全量 fromJSON:选择集、视口、正在显示的工具都不受影响。
 * 也用来「回滚画布」:apply 被校验拦下时再同步一次,用户刚拖走的东西回到文档里的位置。
 */
export function syncGraph(graph: Graph, doc: SldDoc, symbols: SldSymbolLookup = lookupSldSymbol): void {
  const want = docToCells(doc, symbols)
  const wantIds = new Map(want.map(c => [c.id, c]))
  graph.startBatch('sld-sync')
  try {
    // 先删:先删线再删节点,免得 X6 连带删线时和我们撞车
    const stale = graph.getCells().filter(c => {
      if (!kindOf(c)) return false
      const w = wantIds.get(c.id)
      return !w || w.shape !== c.shape
    })
    graph.removeCells([...stale.filter(c => c.isEdge()), ...stale.filter(c => c.isNode())], SYNC)

    for (const desc of want) {
      const cell = graph.getCellById(desc.id)
      if (!cell) {
        if (desc.shape === SHAPE_WIRE) graph.addEdge(clone(desc), SYNC)
        else graph.addNode(clone(desc), SYNC)
        continue
      }
      if (desc.shape === SHAPE_WIRE) updateEdge(cell as Edge, desc)
      else updateNode(cell as Node, desc)
    }
  } finally {
    graph.stopBatch('sld-sync')
  }
}

function updateNode(cell: Node, desc: SldBoxCell): void {
  const { x, y } = cell.getPosition()
  if (x !== desc.x || y !== desc.y) cell.setPosition(desc.x, desc.y, SYNC)
  const { width, height } = cell.getSize()
  const resized = width !== desc.width || height !== desc.height
  if (resized) cell.resize(desc.width, desc.height, SYNC)
  if (cell.getZIndex() !== desc.zIndex) cell.setZIndex(desc.zIndex, SYNC)
  const dataChanged = !same(cell.getData(), desc.data)
  if (dataChanged) cell.replaceData(clone(desc.data), SYNC)
  if (!dataChanged && !resized) return
  if (desc.shape === SHAPE_NODE) {
    const items = cell.getPorts().map(p => ({ id: p.id, group: p.group, args: p.args }))
    if (!same(items, desc.ports.items)) cell.prop('ports/items', clone(desc.ports.items), { ...SYNC, rewrite: true })
  } else cell.setAttrs(clone(desc.attrs), SYNC)
}

function updateEdge(cell: Edge, desc: SldWireCell): void {
  if (!same(cell.getSource(), desc.source)) cell.setSource(clone(desc.source), SYNC)
  if (!same(cell.getTarget(), desc.target)) cell.setTarget(clone(desc.target), SYNC)
  const vertices = cell.getVertices().map(v => ({ x: v.x, y: v.y }))
  if (!same(vertices, desc.vertices)) cell.setVertices(clone(desc.vertices), SYNC)
}

/**
 * 节点 / 母线 / 标签 / 分组框被拖动之后:整张画布和文档比一遍(框选拖动时一起动的不止一个),
 * 连带被 Selection 插件平移过的手工拐点也读回来。
 */
export function readNodeMove(graph: Graph, doc: SldDoc): SldGeometryPatch {
  return diffGeometry(doc, snapshotGraph(graph))
}

/** 母线(或分组框)被 Transform 拉伸之后:只读这一个 cell。母线接点的 d 怎么补由 doc-ops.resizeBus 决定 */
export function readBusResize(graph: Graph, doc: SldDoc, cellId: string): SldGeometryPatch {
  return diffGeometry(doc, snapshotGraph(graph), new Set([cellId]))
}

/** 连线的手工拐点被拖 / 加 / 删之后 */
export function readVertices(graph: Graph, doc: SldDoc, edgeId: string): SldGeometryPatch {
  return diffGeometry(doc, snapshotGraph(graph), new Set([edgeId]))
}

/**
 * 用户拖出来(或改接)的一条线 → 文档里的两端。接在图元上必须落在端口上;接在母线上按落点取 d
 * (已有 d 的那一端——改接时没动的那头——原样保留)。任一端读不出来返回 undefined。
 * @param drop 刚落下的那一端是哪头、鼠标落点(画布坐标)
 */
export function readEdge(
  graph: Graph,
  edge: Edge,
  drop?: { type: 'source' | 'target'; at: SldPoint },
  symbols: SldSymbolLookup = lookupSldSymbol
): { from: SldWireEnd; to: SldWireEnd } | undefined {
  const pointOf = (type: 'source' | 'target'): SldPoint | undefined => {
    const term = edge.getTerminal(type) as Partial<{ cell: string; port: string }>
    const cell = term.cell ? graph.getCellById(term.cell) : null
    if (!cell?.isNode()) return undefined
    const snap = snapshotOf(cell)
    const node = nodeOfCell(snap)
    const def = node && symbols(node.symbol)
    if (node && def && term.port) return portPosition(node, def, term.port)
    const b = cell.getBBox().getCenter()
    return { x: b.x, y: b.y }
  }
  const read = (type: 'source' | 'target'): SldWireEnd | undefined => {
    const term = edge.getTerminal(type) as Partial<{ cell: string; port: string; anchor: { args?: { d?: number } } }>
    const cell = term.cell ? graph.getCellById(term.cell) : null
    if (!cell?.isNode()) return undefined
    const snap = snapshotOf(cell)
    const other = pointOf(type === 'source' ? 'target' : 'source')
    const node = nodeOfCell(snap)
    if (node) {
      const def = symbols(node.symbol)
      if (!def || !term.port) return undefined
      return { node: node.id, port: other ? bestPort(node, def, term.port, other) : term.port }
    }
    const bus = busOfCell(snap)
    if (!bus) return undefined
    if (typeof term.anchor?.args?.d === 'number') return { bus: bus.id, d: term.anchor.args.d }
    const mouse = drop?.type === type ? drop.at : (other ?? { x: bus.x1, y: bus.y1 })
    return { bus: bus.id, d: pickBusD(bus, mouse, other) }
  }
  const from = read('source')
  const to = read('target')
  return from && to ? { from, to } : undefined
}

/** 母线上一个接点在画面上的位置(拉伸开始时记下来) */
export interface SldBusTap {
  edgeId: string
  type: 'source' | 'target'
  p: SldPoint
}

/** 母线开始拉伸:记下线上每个接点此刻的画面位置 */
export function captureBusTaps(graph: Graph, busId: string): SldBusTap[] {
  const cell = graph.getCellById(busId)
  const bus = cell?.isNode() ? busOfCell(snapshotOf(cell)) : undefined
  if (!cell || !bus) return []
  const taps: SldBusTap[] = []
  for (const edge of graph.getConnectedEdges(cell))
    for (const type of ['source', 'target'] as const) {
      const end = endOfTerminal(edge.getTerminal(type) as SldTerminal)
      if (end && 'bus' in end && end.bus === busId) taps.push({ edgeId: edge.id, type, p: busPoint(bus, end.d) })
    }
  return taps
}

/**
 * 母线拉伸过程中:按当前的母线线段重算各接点的 d,让接点留在原来的画面位置(只动画布,不动文档——
 * 松手后文档那边由 doc-ops.resizeBus 算出同样的结果,再经 syncGraph 对齐)。
 */
export function repinBusTaps(graph: Graph, busId: string, taps: ReadonlyArray<SldBusTap>): void {
  const cell = graph.getCellById(busId)
  const bus = cell?.isNode() ? busOfCell(snapshotOf(cell)) : undefined
  if (!bus) return
  for (const tap of taps) {
    const edge = graph.getCellById(tap.edgeId)
    if (!edge?.isEdge()) continue
    const d = busOffset(bus, tap.p)
    const now = endOfTerminal(edge.getTerminal(tap.type) as SldTerminal)
    if (now && 'bus' in now && now.d !== d) edge.setTerminal(tap.type, terminalOf({ bus: busId, d }), SYNC)
  }
}
