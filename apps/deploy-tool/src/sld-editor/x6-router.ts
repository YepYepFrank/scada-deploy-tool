/**
 * X6 自定义 router `sld`(ADR-005 Spike A):编辑器里的线必须和发布后运行时画的一样,
 * 所以这里**不自己算走线**——有手工拐点原样用;没有就取两端坐标与出线朝向,调 model 的 `routeOrthogonal()`
 * (运行时 `wirePoints()` 用的同一个函数),去掉首尾两点,把中间拐点交给 X6。connector 用 rounded(半径 4)。
 *
 * 分两层:`routeMiddle()` 是纯函数(单测拿它和 wirePoints 对账);`registerSldRouter()` 只做 X6 适配(取锚点、取朝向)。
 * 本文件对 X6 只有类型依赖,Graph 类由调用方传进来——单测里不用加载 X6。
 */
import type { EdgeView, Graph, Node } from '@antv/x6'
import {
  SLD_GRID,
  busDirection,
  routeOrthogonal,
  type SldBus,
  type SldPoint,
  type SldPortDir,
} from '@grid/scada-renderer'
import { SHAPE_BUS, SHAPE_NODE, busOfCell, portDirOfCell, snapshotOf } from './x6-adapter'

export const SLD_ROUTER = 'sld'
export const SLD_CONNECTOR = { name: 'rounded', args: { radius: 4 } } as const

/** 连线一端:节点端口(朝向已按旋转 / 镜像变换)、母线上一点、或悬空(正在拖的那头) */
export type SldRouteEnd =
  | { kind: 'port'; p: SldPoint; dir: SldPortDir | undefined }
  | { kind: 'bus'; p: SldPoint; bus: Pick<SldBus, 'x1' | 'y1' | 'x2' | 'y2'> }
  | { kind: 'free'; p: SldPoint }

const dirOf = (end: SldRouteEnd, other: SldPoint): SldPortDir | undefined =>
  end.kind === 'port' ? end.dir : end.kind === 'bus' ? busDirection(end.bus as SldBus, end.p, other) : undefined

/** 纯函数:两端 + 手工拐点 → 中间拐点(不含两端)。与 `wirePoints(doc, wire).slice(1, -1)` 必须逐点相等 */
export function routeMiddle(
  from: SldRouteEnd,
  to: SldRouteEnd,
  vertices: ReadonlyArray<SldPoint> = [],
  grid: number = SLD_GRID
): SldPoint[] {
  if (vertices.length) return vertices.map(v => ({ x: v.x, y: v.y }))
  return routeOrthogonal(from.p, dirOf(from, to.p), to.p, dirOf(to, from.p), grid).slice(1, -1)
}

function endOfView(view: EdgeView, type: 'source' | 'target', p: SldPoint): SldRouteEnd {
  const edge = view.cell
  const cell = type === 'source' ? edge.getSourceCell() : edge.getTargetCell()
  if (cell?.isNode()) {
    const snap = snapshotOf(cell as Node)
    if (cell.shape === SHAPE_BUS) {
      const bus = busOfCell(snap)
      if (bus) return { kind: 'bus', p, bus }
    }
    if (cell.shape === SHAPE_NODE) {
      const portId = type === 'source' ? edge.getSourcePortId() : edge.getTargetPortId()
      return { kind: 'port', p, dir: portId ? portDirOfCell(snap, portId) : undefined }
    }
  }
  return { kind: 'free', p }
}

let registered = false
/** 注册 router(幂等)。GraphCtor 传 `Graph` 类本身 */
export function registerSldRouter(GraphCtor: typeof Graph): void {
  if (registered) return
  registered = true
  GraphCtor.registerRouter(
    SLD_ROUTER,
    function (this: EdgeView, vertices, _args, view: EdgeView) {
      const s = view.sourceAnchor
      const t = view.targetAnchor
      if (!s || !t) return vertices
      const a = { x: Math.round(s.x), y: Math.round(s.y) }
      const b = { x: Math.round(t.x), y: Math.round(t.y) }
      return routeMiddle(endOfView(view, 'source', a), endOfView(view, 'target', b), vertices)
    },
    true
  )
}
