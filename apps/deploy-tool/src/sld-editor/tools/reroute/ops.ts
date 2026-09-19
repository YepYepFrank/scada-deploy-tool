/**
 * 重置走线 / 拉直(T5.7)的纯逻辑。
 * - 重置:删掉手工拐点(vertices),回到 model 的缺省正交走线(routeOrthogonal,编辑器与运行时同一个函数);
 * - 拉直:拐点吸附栅格,再把每一段斜线改成「先水平、后垂直」两段,合并共线点;拐点全消掉时等同重置。
 */
import {
  SLD_GRID,
  wirePoints,
  type SldDoc,
  type SldPoint,
  type SldSelection,
  type SldSymbolLookup,
  type SldWireEnd,
} from '@grid/scada-renderer'
import { snap } from '../_shared/geometry'

/** 要处理的连线:选中了连线就是这些;否则是连在选中节点上的连线 */
export function targetWires(doc: SldDoc, sel: SldSelection): string[] {
  if (sel.wires.length) return doc.wires.filter(w => sel.wires.includes(w.id)).map(w => w.id)
  const nodes = new Set(sel.nodes)
  const touches = (e: SldWireEnd): boolean => 'node' in e && nodes.has(e.node)
  return doc.wires.filter(w => touches(w.from) || touches(w.to)).map(w => w.id)
}

/** 目标连线里带手工拐点的(两个工具的 enabled 用) */
export function wiresWithVertices(doc: SldDoc, sel: SldSelection): string[] {
  const ids = new Set(targetWires(doc, sel))
  return doc.wires.filter(w => ids.has(w.id) && w.vertices?.length).map(w => w.id)
}

/** 清掉手工拐点;返回改了几条 */
export function resetRoutes(doc: SldDoc, ids: string[]): number {
  let n = 0
  for (const w of doc.wires)
    if (ids.includes(w.id) && w.vertices) {
      delete w.vertices
      n += 1
    }
  return n
}

const same = (a: SldPoint, b: SldPoint): boolean => a.x === b.x && a.y === b.y

/** 合并重复点与共线的中间点(端点不动) */
export function simplifyPath(points: SldPoint[]): SldPoint[] {
  let out = points
  for (;;) {
    const next: SldPoint[] = []
    for (const p of out) {
      const b = next[next.length - 1]
      const a = next[next.length - 2]
      if (b && same(b, p)) continue
      if (a && b && ((a.x === b.x && b.x === p.x) || (a.y === b.y && b.y === p.y))) next.pop()
      next.push(p)
    }
    if (next.length === out.length) return next
    out = next
  }
}

/**
 * 一条折线的拉直结果(含两端):中间点吸附栅格,斜段拆成先水平后垂直,再合并共线点。
 * 端点(端口 / 母线接点)本来就在栅格上,原样保留。
 */
export function straightenPath(points: SldPoint[], grid: number = SLD_GRID): SldPoint[] {
  if (points.length < 2) return points
  const snapped = points.map((p, i) =>
    i === 0 || i === points.length - 1 ? p : { x: snap(p.x, grid), y: snap(p.y, grid) }
  )
  const ortho: SldPoint[] = [snapped[0]!]
  for (let i = 1; i < snapped.length; i++) {
    const p = ortho[ortho.length - 1]!
    const q = snapped[i]!
    if (p.x !== q.x && p.y !== q.y) ortho.push({ x: q.x, y: p.y })
    ortho.push(q)
  }
  return simplifyPath(ortho)
}

/** 拉直:改了几条。端点解析不了的悬空线跳过 */
export function straightenWires(doc: SldDoc, ids: string[], symbols: SldSymbolLookup): number {
  let n = 0
  for (const w of doc.wires) {
    if (!ids.includes(w.id) || !w.vertices?.length) continue
    const pts = wirePoints(doc, w, symbols)
    if (!pts) continue
    const inner = straightenPath(pts).slice(1, -1)
    const before = JSON.stringify(w.vertices)
    if (inner.length) w.vertices = inner.map(p => [p.x, p.y] as [number, number])
    else delete w.vertices
    if (JSON.stringify(w.vertices) !== before) n += 1
  }
  return n
}
