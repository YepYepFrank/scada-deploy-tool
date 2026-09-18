/**
 * 对 SldDoc 草稿的纯操作(在 store.apply 的 recipe 里调;直接改传进来的草稿)。
 * 无 X6、无 Vue、无 DOM——画布上的每种交互最后都落成这里的一个函数,可单测。
 */
import {
  SLD_GRID,
  busLength,
  nodeBox,
  portDirection,
  portPosition,
  type SldBus,
  type SldDoc,
  type SldFrame,
  type SldLabel,
  type SldNode,
  type SldPoint,
  type SldPortDir,
  type SldRotation,
  type SldSelection,
  type SldSymbolDefinition,
  type SldSymbolLookup,
  type SldWire,
  type SldWireEnd,
} from '@grid/scada-renderer'

export const snapGrid = (v: number, grid: number = SLD_GRID): number => Math.round(v / grid) * grid

const DIR_VEC: Record<SldPortDir, [number, number]> = { n: [0, -1], e: [1, 0], s: [0, 1], w: [-1, 0] }

/** 母线是否水平(斜的按主方向算,与 model 的 busDirection 一致) */
export const busIsHorizontal = (b: Pick<SldBus, 'x1' | 'y1' | 'x2' | 'y2'>): boolean =>
  Math.abs(b.x2 - b.x1) >= Math.abs(b.y2 - b.y1)

/* ───────────── 画布读回来的几何变化 ───────────── */

/** 画布上一次拖动 / 拉伸之后,与文档不一致的几何量(由 x6-adapter 的 diffGeometry 给出) */
export interface SldGeometryPatch {
  nodes: Array<{ id: string; x: number; y: number }>
  buses: Array<{ id: string; x1: number; y1: number; x2: number; y2: number }>
  labels: Array<{ id: string; x: number; y: number }>
  frames: Array<{ id: string; x: number; y: number; w: number; h: number }>
  wires: Array<{ id: string; vertices: Array<[number, number]> }>
}

export const emptyPatch = (): SldGeometryPatch => ({ nodes: [], buses: [], labels: [], frames: [], wires: [] })
export const patchSize = (p: SldGeometryPatch): number =>
  p.nodes.length + p.buses.length + p.labels.length + p.frames.length + p.wires.length

/**
 * 把几何变化写进草稿。依附在节点上的标签(label.attach)跟着节点走——除非这个标签自己也在 patch 里
 * (一起被框选拖动,画布已经移过它了)。母线按「整体平移 or 拉伸」分别处理:拉伸走 resizeBus 保持接点画面位置。
 */
export function applyGeometry(doc: SldDoc, patch: SldGeometryPatch): void {
  const movedLabels = new Set(patch.labels.map(l => l.id))
  for (const c of patch.nodes) {
    const n = doc.nodes.find(x => x.id === c.id)
    if (!n) continue
    const dx = c.x - n.x
    const dy = c.y - n.y
    n.x = c.x
    n.y = c.y
    for (const l of doc.labels)
      if (l.attach === n.id && !movedLabels.has(l.id)) {
        l.x += dx
        l.y += dy
      }
  }
  for (const c of patch.buses) resizeBus(doc, c.id, c)
  for (const c of patch.labels) {
    const l = doc.labels.find(x => x.id === c.id)
    if (l) {
      l.x = c.x
      l.y = c.y
    }
  }
  for (const c of patch.frames) {
    const f = doc.frames?.find(x => x.id === c.id)
    if (f) Object.assign(f, { x: c.x, y: c.y, w: c.w, h: c.h })
  }
  for (const c of patch.wires) {
    const w = doc.wires.find(x => x.id === c.id)
    if (!w) continue
    if (c.vertices.length) w.vertices = c.vertices
    else delete w.vertices
  }
}

/**
 * 母线换成新的端点。(x1,y1) 端沿母线方向挪了多少,线上所有接点的 d 就反向补多少(夹到 [0, 新长度])
 * ——接点在画面上不动(ADR-005 Spike A「拉伸时保持绝对位置」)。整体平移时两端同向同距,d 不变。
 */
export function resizeBus(doc: SldDoc, busId: string, line: Pick<SldBus, 'x1' | 'y1' | 'x2' | 'y2'>): void {
  const bus = doc.buses.find(b => b.id === busId)
  if (!bus) return
  const oldLen = busLength(bus)
  const d1 = { x: line.x1 - bus.x1, y: line.y1 - bus.y1 }
  const d2 = { x: line.x2 - bus.x2, y: line.y2 - bus.y2 }
  const translated = d1.x === d2.x && d1.y === d2.y
  // 起点位移在**旧**母线方向上的投影(> 0 = 起点朝 (x2,y2) 缩进去了)
  const shift = translated || oldLen === 0 ? 0 : (d1.x * (bus.x2 - bus.x1) + d1.y * (bus.y2 - bus.y1)) / oldLen
  Object.assign(bus, { x1: line.x1, y1: line.y1, x2: line.x2, y2: line.y2 })
  if (translated) return
  const len = busLength(bus)
  for (const w of doc.wires)
    for (const end of [w.from, w.to])
      if ('bus' in end && end.bus === busId) end.d = Math.min(len, Math.max(0, Math.round(end.d - shift)))
}

/* ───────────── 选择集操作 ───────────── */

/** 方向键微移:选中的元素整体平移;两端都跟着动了的连线,手工拐点也一起平移(形状不变) */
export function moveSelection(doc: SldDoc, sel: SldSelection, dx: number, dy: number): void {
  const nodes = new Set(sel.nodes)
  const buses = new Set(sel.buses)
  const labels = new Set(sel.labels)
  const frames = new Set(sel.frames ?? [])
  for (const n of doc.nodes)
    if (nodes.has(n.id)) {
      n.x += dx
      n.y += dy
    }
  for (const b of doc.buses)
    if (buses.has(b.id)) {
      b.x1 += dx
      b.x2 += dx
      b.y1 += dy
      b.y2 += dy
    }
  for (const l of doc.labels)
    if (labels.has(l.id) || (l.attach && nodes.has(l.attach))) {
      l.x += dx
      l.y += dy
    }
  for (const f of doc.frames ?? [])
    if (frames.has(f.id)) {
      f.x += dx
      f.y += dy
    }
  const endMoved = (e: SldWireEnd): boolean => ('bus' in e ? buses.has(e.bus) : nodes.has(e.node))
  for (const w of doc.wires)
    if (w.vertices?.length && endMoved(w.from) && endMoved(w.to))
      w.vertices = w.vertices.map(([x, y]) => [x + dx, y + dy])
}

/** 删除选中元素;连在被删节点 / 母线上的线、依附在被删节点上的标签一并删。绑定不动(没人引用的 pt.* 由问题清单提示) */
export function deleteSelection(doc: SldDoc, sel: SldSelection): void {
  const nodes = new Set(sel.nodes)
  const buses = new Set(sel.buses)
  const wires = new Set(sel.wires)
  const labels = new Set(sel.labels)
  const frames = new Set(sel.frames ?? [])
  const endGone = (e: SldWireEnd): boolean => ('bus' in e ? buses.has(e.bus) : nodes.has(e.node))
  doc.nodes = doc.nodes.filter(n => !nodes.has(n.id))
  doc.buses = doc.buses.filter(b => !buses.has(b.id))
  doc.wires = doc.wires.filter(w => !wires.has(w.id) && !endGone(w.from) && !endGone(w.to))
  doc.labels = doc.labels.filter(l => !labels.has(l.id) && !(l.attach && nodes.has(l.attach)))
  if (doc.frames) doc.frames = doc.frames.filter(f => !frames.has(f.id))
}

/**
 * 选中的节点各自绕包围盒中心顺时针转 90°(中心吸回栅格,保证左上角仍落栅格);
 * 选中的母线绕中点横竖互换(接点的 d 不变)。
 */
export function rotateSelection(doc: SldDoc, sel: SldSelection, symbols: SldSymbolLookup): void {
  const grid = doc.canvas.grid > 0 ? doc.canvas.grid : SLD_GRID
  for (const n of doc.nodes) {
    if (!sel.nodes.includes(n.id)) continue
    const def = symbols(n.symbol)
    const next = ((n.rot + 90) % 360) as SldRotation
    if (def) {
      const box = nodeBox(n, def)
      const cx = box.x + box.w / 2
      const cy = box.y + box.h / 2
      // 旋转后宽高互换:新盒子的 w = 旧 h
      n.x = snapGrid(cx - box.h / 2, grid)
      n.y = snapGrid(cy - box.w / 2, grid)
    }
    n.rot = next
  }
  for (const b of doc.buses) {
    if (!sel.buses.includes(b.id)) continue
    const len = busLength(b)
    const cx = snapGrid((b.x1 + b.x2) / 2, grid)
    const cy = snapGrid((b.y1 + b.y2) / 2, grid)
    const half = snapGrid(len / 2, grid)
    if (busIsHorizontal(b)) Object.assign(b, { x1: cx, y1: cy - half, x2: cx, y2: cy - half + len })
    else Object.assign(b, { x1: cx - half, y1: cy, x2: cx - half + len, y2: cy })
  }
}

/** 选中的节点水平镜像(false 时删掉字段,免得文档里到处是 flip: false) */
export function flipSelection(doc: SldDoc, sel: SldSelection): void {
  for (const n of doc.nodes) {
    if (!sel.nodes.includes(n.id)) continue
    if (n.flip) delete n.flip
    else n.flip = true
  }
}

/* ───────────── 复制 / 粘贴 ───────────── */

export interface SldFragment {
  nodes: SldNode[]
  buses: SldBus[]
  wires: SldWire[]
  labels: SldLabel[]
  frames: SldFrame[]
}

const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T

/**
 * 选择集 → 可粘贴的片段(深拷贝)。连线只带「两端都在片段里」的(选没选中都带,免得复制一个间隔还得把线一根根点上);
 * 依附在选中节点上的标签自动带上。
 */
export function copyFragment(doc: SldDoc, sel: SldSelection): SldFragment {
  const nodes = new Set(sel.nodes)
  const buses = new Set(sel.buses)
  const inside = (e: SldWireEnd): boolean => ('bus' in e ? buses.has(e.bus) : nodes.has(e.node))
  return clone({
    nodes: doc.nodes.filter(n => nodes.has(n.id)),
    buses: doc.buses.filter(b => buses.has(b.id)),
    wires: doc.wires.filter(w => inside(w.from) && inside(w.to)),
    labels: doc.labels.filter(l => sel.labels.includes(l.id) || (!!l.attach && nodes.has(l.attach))),
    frames: (doc.frames ?? []).filter(f => (sel.frames ?? []).includes(f.id)),
  })
}

export const fragmentSize = (f: SldFragment): number =>
  f.nodes.length + f.buses.length + f.wires.length + f.labels.length + f.frames.length

/**
 * 把片段贴进草稿:id 全部重编、位置偏移 offset;返回新元素的选择集。
 * 测点引用(state.pt / 数值标签的 pt)原样保留——贴出来的元素与原件看同一个测点;
 * 要「复制并改绑」用 T5.7 的复制间隔(duplicateBay)。
 */
export function pasteFragment(
  doc: SldDoc,
  frag: SldFragment,
  newId: (kind: 'n' | 'b' | 'w' | 'l' | 'f') => string,
  offset: number = 2 * SLD_GRID
): SldSelection {
  const f = clone(frag)
  const map = new Map<string, string>()
  const sel: SldSelection = { nodes: [], buses: [], wires: [], labels: [], frames: [] }
  for (const n of f.nodes) {
    const id = newId('n')
    map.set(n.id, id)
    doc.nodes.push({ ...n, id, x: n.x + offset, y: n.y + offset })
    sel.nodes.push(id)
  }
  for (const b of f.buses) {
    const id = newId('b')
    map.set(b.id, id)
    doc.buses.push({ ...b, id, x1: b.x1 + offset, y1: b.y1 + offset, x2: b.x2 + offset, y2: b.y2 + offset })
    sel.buses.push(id)
  }
  const remapEnd = (e: SldWireEnd): SldWireEnd =>
    'bus' in e ? { bus: map.get(e.bus) ?? e.bus, d: e.d } : { node: map.get(e.node) ?? e.node, port: e.port }
  for (const w of f.wires) {
    const id = newId('w')
    doc.wires.push({
      id,
      from: remapEnd(w.from),
      to: remapEnd(w.to),
      ...(w.vertices?.length
        ? { vertices: w.vertices.map(([x, y]): [number, number] => [x + offset, y + offset]) }
        : {}),
    })
    sel.wires.push(id)
  }
  for (const l of f.labels) {
    const id = newId('l')
    const next: SldLabel = { ...l, id, x: l.x + offset, y: l.y + offset }
    // 依附的节点不在片段里:贴出来的标签不再依附(不然会跟着原节点跑)
    if (l.attach) {
      const to = map.get(l.attach)
      if (to) next.attach = to
      else delete next.attach
    }
    doc.labels.push(next)
    sel.labels.push(id)
  }
  if (f.frames.length) {
    doc.frames ??= []
    for (const fr of f.frames) {
      const id = newId('f')
      doc.frames.push({ ...fr, id, x: fr.x + offset, y: fr.y + offset })
      sel.frames!.push(id)
    }
  }
  return sel
}

/* ───────────── 新增元素 ───────────── */

/** 从图元面板拖进来的新节点;图元声明了 defaultSource 的直接标成电源点 */
export function addNode(doc: SldDoc, id: string, def: SldSymbolDefinition, x: number, y: number): SldNode {
  const node: SldNode = { id, symbol: def.id, x, y, rot: 0, ...(def.defaultSource ? { source: {} } : {}) }
  doc.nodes.push(node)
  return node
}

/**
 * 「画母线」拖出来的线段 → 水平 / 垂直母线(哪个方向拖得远算哪个),(x1,y1) 归一成左端 / 上端。
 * 太短(< 2 格)返回 undefined,不建。
 */
export function busFromDrag(a: SldPoint, b: SldPoint, grid: number = SLD_GRID): Omit<SldBus, 'id'> | undefined {
  const horizontal = Math.abs(b.x - a.x) >= Math.abs(b.y - a.y)
  const ax = snapGrid(a.x, grid)
  const ay = snapGrid(a.y, grid)
  if (horizontal) {
    const bx = snapGrid(b.x, grid)
    if (Math.abs(bx - ax) < 2 * grid) return undefined
    return { x1: Math.min(ax, bx), y1: ay, x2: Math.max(ax, bx), y2: ay }
  }
  const by = snapGrid(b.y, grid)
  if (Math.abs(by - ay) < 2 * grid) return undefined
  return { x1: ax, y1: Math.min(ay, by), x2: ax, y2: Math.max(ay, by) }
}

/** 「加分组框」拖出来的矩形;太小(任一边 < 2 格)返回 undefined */
export function frameFromDrag(a: SldPoint, b: SldPoint, grid: number = SLD_GRID): Omit<SldFrame, 'id'> | undefined {
  const x1 = snapGrid(Math.min(a.x, b.x), grid)
  const y1 = snapGrid(Math.min(a.y, b.y), grid)
  const x2 = snapGrid(Math.max(a.x, b.x), grid)
  const y2 = snapGrid(Math.max(a.y, b.y), grid)
  if (x2 - x1 < 2 * grid || y2 - y1 < 2 * grid) return undefined
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 }
}

/* ───────────── 连线 ───────────── */

/**
 * 同一位置叠了几个端口时(连接点 junction 的四个端口都在圆心,只是朝向不同),鼠标只点得到最上面那个。
 * 按「朝向最指向对端」在同位置的端口里重新挑一个;没有同位置的兄弟端口就原样返回。
 */
export function bestPort(node: SldNode, def: SldSymbolDefinition, portId: string, toward: SldPoint): string {
  const port = def.ports.find(p => p.id === portId)
  if (!port) return portId
  const siblings = def.ports.filter(p => p.x === port.x && p.y === port.y)
  if (siblings.length < 2) return portId
  const at = portPosition(node, def, portId)
  if (!at) return portId
  let best = portId
  let bestScore = -Infinity
  for (const p of siblings) {
    const dir = portDirection(node, def, p.id)
    if (!dir) continue
    const [vx, vy] = DIR_VEC[dir]
    const score = vx * (toward.x - at.x) + vy * (toward.y - at.y)
    if (score > bestScore) {
      bestScore = score
      best = p.id
    }
  }
  return best
}

const sameEnd = (a: SldWireEnd, b: SldWireEnd): boolean =>
  'bus' in a ? 'bus' in b && a.bus === b.bus && a.d === b.d : 'node' in b && a.node === b.node && a.port === b.port

/** 新连线进草稿;两端相同、或已有一模一样的线(不分方向)则不加,返回 false */
export function addWire(doc: SldDoc, id: string, from: SldWireEnd, to: SldWireEnd): boolean {
  if (sameEnd(from, to)) return false
  if ('bus' in from && 'bus' in to) return false
  const dup = doc.wires.some(
    w => (sameEnd(w.from, from) && sameEnd(w.to, to)) || (sameEnd(w.from, to) && sameEnd(w.to, from))
  )
  if (dup) return false
  doc.wires.push({ id, from, to })
  return true
}
