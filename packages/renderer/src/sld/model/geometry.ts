/**
 * 几何:端口坐标、母线取点、连线折线(T5.0 实现;运行时与编辑器共用)。
 *
 * 变换约定(portPosition / portDirection / nodeBox / symbolTransform 四处必须一致):
 * 1. 先按 flip 在图元局部坐标里水平镜像:x → w − x,朝向 e ↔ w;
 * 2. 再绕包围盒中心顺时针旋转 rot(屏幕坐标,y 轴向下):朝向 n → e → s → w;
 * 3. 旋转 90 / 270 时包围盒宽高互换,并把旋转后的包围盒**左上角对回局部原点**;
 * 4. 最后平移到 (node.x, node.y)。
 * 5.(2026-09-20)node.scale:上面 1–3 步得到的局部坐标整体乘 k(以旋转后包围盒左上角为原点等比放大),再做第 4 步。
 *    所以端口 = node + k × transformLocal(...),包围盒 = k × symbolBoxSize(...);<SldSymbol :scale> 就是最外层套一个 scale(k)。
 * 第 3 步让「节点落栅格」不受旋转影响:w、h、端口坐标都是栅格整数倍时,结果一定还是栅格整数点
 * (真按中心旋转会多出 (w − h) / 2 的偏移,40×60 的图元转 90° 就偏 10,栅格取 20 时落不上)。
 */
import type {
  SldBus,
  SldDoc,
  SldNode,
  SldPoint,
  SldPortDir,
  SldRotation,
  SldSymbolDefinition,
  SldSymbolLookup,
  SldWire,
  SldWireEnd,
} from './types'

/** 顺时针旋转 90° 后的朝向 */
const DIR_CW: Record<SldPortDir, SldPortDir> = { n: 'e', e: 's', s: 'w', w: 'n' }
const DIR_FLIP: Record<SldPortDir, SldPortDir> = { n: 'n', e: 'w', s: 's', w: 'e' }
const DIR_VEC: Record<SldPortDir, [number, number]> = { n: [0, -1], e: [1, 0], s: [0, 1], w: [-1, 0] }
/** doc.canvas.grid 不合法时的兜底栅格 */
const FALLBACK_GRID = 10

/** 图元局部坐标 → 镜像 + 旋转之后的局部坐标(原点 = 旋转后包围盒左上角) */
function transformLocal(def: SldSymbolDefinition, rot: SldRotation, flip: boolean, x: number, y: number): SldPoint {
  const fx = flip ? def.w - x : x
  switch (rot) {
    case 90:
      return { x: def.h - y, y: fx }
    case 180:
      return { x: def.w - fx, y: def.h - y }
    case 270:
      return { x: y, y: def.w - fx }
    default:
      return { x: fx, y }
  }
}

function transformDir(dir: SldPortDir, rot: SldRotation, flip: boolean): SldPortDir {
  let d = flip ? DIR_FLIP[dir] : dir
  for (let r = 0; r < rot; r += 90) d = DIR_CW[d]
  return d
}

/**
 * 图元局部坐标里的一个点 → 镜像 + 旋转之后的局部坐标(与端口同一套规则)。
 * 图元文字(texts)、数值标签默认落点(labelSlots)用它定位:位置跟着转,文字本身不转。
 */
export function symbolPoint(def: SldSymbolDefinition, rot: SldRotation, flip: boolean, x: number, y: number): SldPoint {
  return transformLocal(def, rot, flip, x, y)
}

/** 节点的放大倍数:缺省 / 非法值都当 1 */
export function nodeScale(node: { scale?: number }): number {
  const k = node.scale
  return typeof k === 'number' && Number.isFinite(k) && k > 0 ? k : 1
}

/** 编辑器里供选的放大倍数 */
export const SLD_NODE_SCALES: readonly number[] = [0.5, 1, 1.5, 2, 2.5, 3, 4]

/**
 * 这个图元能用哪些放大倍数:放大后包围盒与**全部端口**仍是栅格整数倍的才行——端口离了栅格,连线就对不齐了。
 * 例:端口在 x = 20 的图元能用 0.5 / 1.5;端口在 x = 10 的只能用整数倍。1 永远可用。
 */
export function validNodeScales(def: SldSymbolDefinition, grid: number = FALLBACK_GRID): number[] {
  const g = grid > 0 ? grid : FALLBACK_GRID
  const coords = [def.w, def.h, ...def.ports.flatMap(p => [p.x, p.y])]
  const onGrid = (v: number): boolean => Math.abs(v / g - Math.round(v / g)) < 1e-9
  return SLD_NODE_SCALES.filter(k => k === 1 || coords.every(c => onGrid(c * k)))
}

/** 图元旋转后的包围盒尺寸(90 / 270 宽高互换),再乘放大倍数 */
export function symbolBoxSize(def: SldSymbolDefinition, rot: SldRotation = 0, scale = 1): { w: number; h: number } {
  const box = rot === 90 || rot === 270 ? { w: def.h, h: def.w } : { w: def.w, h: def.h }
  return scale === 1 ? box : { w: box.w * scale, h: box.h * scale }
}

/**
 * 与 portPosition 同一套规则的 SVG transform 串(<SldSymbol> 用);不需要变换时返回 undefined。
 * SVG 的 transform 列表右边的先作用,所以镜像写在最右。
 */
export function symbolTransform(def: SldSymbolDefinition, rot: SldRotation = 0, flip = false): string | undefined {
  // 放大不在这里做:<SldSymbol> 在最外层统一套 scale(k),图形和图元文字一起放大
  const parts: string[] = []
  if (rot === 90) parts.push(`translate(${def.h} 0) rotate(90)`)
  else if (rot === 180) parts.push(`translate(${def.w} ${def.h}) rotate(180)`)
  else if (rot === 270) parts.push(`translate(0 ${def.w}) rotate(270)`)
  if (flip) parts.push(`translate(${def.w} 0) scale(-1 1)`)
  return parts.length ? parts.join(' ') : undefined
}

/** 端口在画布上的坐标:先按 node.flip 水平镜像,再绕包围盒中心旋转 node.rot(顺时针),再平移到 node.x / node.y。 */
export function portPosition(node: SldNode, def: SldSymbolDefinition, portId: string): SldPoint | undefined {
  const port = def.ports.find(p => p.id === portId)
  if (!port) return undefined
  const p = transformLocal(def, node.rot, !!node.flip, port.x, port.y)
  const k = nodeScale(node)
  return { x: node.x + p.x * k, y: node.y + p.y * k }
}

/** 端口出线朝向(镜像 + 旋转之后) */
export function portDirection(node: SldNode, def: SldSymbolDefinition, portId: string): SldPortDir | undefined {
  const port = def.ports.find(p => p.id === portId)
  return port ? transformDir(port.dir, node.rot, !!node.flip) : undefined
}

/**
 * 节点旋转后的包围盒(画布坐标)。
 * 约定:不论 rot / flip,旋转后包围盒的**左上角始终是 (node.x, node.y)**;rot = 90 / 270 时 w、h 互换。
 * 也就是说 node.x / node.y 记的是「画面上看到的包围盒左上角」,旋转不会让节点离开栅格。
 */
export function nodeBox(node: SldNode, def: SldSymbolDefinition): { x: number; y: number; w: number; h: number } {
  return { x: node.x, y: node.y, ...symbolBoxSize(def, node.rot, nodeScale(node)) }
}

/** 母线长度(像素);母线约定水平或垂直,斜的(validateSldDoc 会报)按欧氏长度算 */
export function busLength(bus: SldBus): number {
  return Math.round(Math.hypot(bus.x2 - bus.x1, bus.y2 - bus.y1))
}

const clampD = (d: number, len: number): number => (d > len ? len : d > 0 ? d : 0) // NaN → 0

/** 母线上距 (x1,y1) 为 d 像素处的点(d 越界夹到两端;结果取整像素,免得浮点误差让共线判断落空) */
export function busPoint(bus: SldBus, d: number): SldPoint {
  const len = busLength(bus)
  if (len === 0) return { x: bus.x1, y: bus.y1 }
  const k = clampD(d, len) / len
  return { x: Math.round(bus.x1 + (bus.x2 - bus.x1) * k), y: Math.round(bus.y1 + (bus.y2 - bus.y1) * k) }
}

/** 离 p 最近的母线位置 d(距 (x1,y1) 的像素数,夹到 [0, 母线长],并吸附到栅格 grid;grid ≤ 0 不吸附) */
export function busOffset(bus: SldBus, p: SldPoint, grid = 10): number {
  const len = busLength(bus)
  if (len === 0) return 0
  const raw = ((p.x - bus.x1) * (bus.x2 - bus.x1) + (p.y - bus.y1) * (bus.y2 - bus.y1)) / len
  const snapped = grid > 0 ? Math.round(raw / grid) * grid : raw
  return clampD(snapped, len)
}

/** 连线端点解析结果:坐标 + 出线朝向(母线端的朝向要等知道另一端在哪才能定) */
interface ResolvedEnd {
  p: SldPoint
  dir?: SldPortDir
  bus?: SldBus
}

function resolveEnd(doc: SldDoc, end: SldWireEnd, symbols: SldSymbolLookup): ResolvedEnd | undefined {
  if ('bus' in end) {
    const bus = doc.buses.find(b => b.id === end.bus)
    return bus ? { p: busPoint(bus, end.d), bus } : undefined
  }
  const node = doc.nodes.find(n => n.id === end.node)
  const def = node && symbols(node.symbol)
  if (!node || !def) return undefined
  const p = portPosition(node, def, end.port)
  return p ? { p, dir: portDirection(node, def, end.port) } : undefined
}

/** 母线端的出线朝向:垂直于母线、指向 other 所在一侧;other 正好落在母线所在直线上则没有朝向(不出短线) */
export function busDirection(bus: SldBus, at: SldPoint, other: SldPoint): SldPortDir | undefined {
  // 斜母线(validateSldDoc 会报)按主方向当水平 / 垂直处理
  const horizontal = Math.abs(bus.x2 - bus.x1) >= Math.abs(bus.y2 - bus.y1)
  if (horizontal) return other.y > at.y ? 's' : other.y < at.y ? 'n' : undefined
  return other.x > at.x ? 'e' : other.x < at.x ? 'w' : undefined
}

const isVertical = (d: SldPortDir): boolean => d === 'n' || d === 's'

/** 两个同轴朝向之间的折返位置:同向取更靠外的一边,对向 / 背向取中点(落栅格) */
function midCoord(a: number, b: number, da: SldPortDir, db: SldPortDir, grid: number): number {
  if (da === db) return da === 'n' || da === 'w' ? Math.min(a, b) : Math.max(a, b)
  return Math.round((a + b) / 2 / grid) * grid
}

/** 去掉重复点、合并共线的中间点(含原路折返),直到稳定;输入每段都正交,输出也是 */
function simplify(points: SldPoint[]): SldPoint[] {
  let out = points
  for (;;) {
    const next: SldPoint[] = []
    for (const p of out) {
      const b = next[next.length - 1]
      const a = next[next.length - 2]
      if (b && b.x === p.x && b.y === p.y) continue
      // a、b、p 三点共线:b 是多余的中间点(或折返点),用 p 顶掉
      if (a && b && ((a.x === b.x && b.x === p.x) || (a.y === b.y && b.y === p.y))) next.pop()
      next.push(p)
    }
    if (next.length === out.length) return next
    out = next
  }
}

/**
 * 连线的完整折线点列(含两端)。有 vertices 用 vertices;没有则按端口朝向给一条正交折线(L 形或 Z 形)。
 * 端点引用的节点 / 端口 / 母线不存在时返回 undefined(悬空线,由 validateSldDoc 报)。
 *
 * 自动折线的规则:两端同 x 或同 y → 直线;否则两端各沿朝向走出 1 个栅格,
 * 两端朝向互相垂直 → L 形(一个拐点),同轴 → Z 形(在 midCoord 处折返)。
 * 每一段都水平或垂直,不含零长度段与相邻重复点;两端重合时只返回一个点。
 * 这只是「没人摆过拐点」时的缺省走线,不绕障;要精确走线由编辑器写 vertices。
 */
export function wirePoints(doc: SldDoc, wire: SldWire, symbols: SldSymbolLookup): SldPoint[] | undefined {
  const from = resolveEnd(doc, wire.from, symbols)
  const to = resolveEnd(doc, wire.to, symbols)
  if (!from || !to) return undefined
  const a = from.p
  const b = to.p
  if (wire.vertices?.length) return [a, ...wire.vertices.map(([x, y]) => ({ x, y })), b]
  const da = from.bus ? busDirection(from.bus, a, b) : from.dir
  const db = to.bus ? busDirection(to.bus, b, a) : to.dir
  return routeOrthogonal(a, da, b, db, doc.canvas.grid)
}

/**
 * 缺省正交走线的纯函数:两端坐标 + 出线朝向 → 完整折线(含两端)。
 * 单独导出是为了让编辑器的 X6 自定义 router 调**同一个**函数——编辑器里看到的线必须和发布后运行时画的一样
 * (Spike A 结论,ADR-005)。朝向给 undefined 表示该端没有出线方向(落在母线所在直线上的特殊情况)。
 */
export function routeOrthogonal(
  a: SldPoint,
  da: SldPortDir | undefined,
  b: SldPoint,
  db: SldPortDir | undefined,
  gridSize: number = FALLBACK_GRID
): SldPoint[] {
  if (a.x === b.x || a.y === b.y) return simplify([a, b])
  const grid = gridSize > 0 ? gridSize : FALLBACK_GRID
  const step = (p: SldPoint, d: SldPortDir | undefined): SldPoint =>
    d ? { x: p.x + DIR_VEC[d][0] * grid, y: p.y + DIR_VEC[d][1] * grid } : p
  const a1 = step(a, da)
  const b1 = step(b, db)
  // 没有朝向的一端(斜母线上的特殊情况)按「与另一端垂直」处理,走 L 形
  const va = da ? isVertical(da) : db ? !isVertical(db) : false
  const vb = db ? isVertical(db) : !va

  let middle: SldPoint[]
  if (va && vb) {
    const y = midCoord(a1.y, b1.y, da ?? 's', db ?? 'n', grid)
    middle = [
      { x: a1.x, y },
      { x: b1.x, y },
    ]
  } else if (!va && !vb) {
    const x = midCoord(a1.x, b1.x, da ?? 'e', db ?? 'w', grid)
    middle = [
      { x, y: a1.y },
      { x, y: b1.y },
    ]
  } else if (va) middle = [{ x: a1.x, y: b1.y }]
  else middle = [{ x: b1.x, y: a1.y }]
  return simplify([a, a1, ...middle, b1, b])
}
