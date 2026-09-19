/**
 * T5.7 各工具共用的几何小件(纯函数;没有 index.ts,不会被骨架当成扩展发现)。
 */
import { SLD_GRID, nodeBox, type SldDoc, type SldSelection, type SldSymbolLookup } from '@grid/scada-renderer'

export interface Box {
  x: number
  y: number
  w: number
  h: number
}

export const snap = (v: number, grid: number = SLD_GRID): number => Math.round(v / grid) * grid
/** 向上取到栅格(间距用:宁可多留一格也不要叠上) */
export const snapUp = (v: number, grid: number = SLD_GRID): number => Math.ceil(v / grid) * grid

export function unionBox(boxes: Box[]): Box | undefined {
  if (!boxes.length) return undefined
  const x1 = Math.min(...boxes.map(b => b.x))
  const y1 = Math.min(...boxes.map(b => b.y))
  const x2 = Math.max(...boxes.map(b => b.x + b.w))
  const y2 = Math.max(...boxes.map(b => b.y + b.h))
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 }
}

/** 图元没注册(unknown-symbol)时的兜底尺寸:按 4 × 4 格算,别让工具直接不能用 */
const FALLBACK_SIZE = 4 * SLD_GRID

/** 选择集里每个元素的包围盒;标签没有可靠的尺寸,按一个点算 */
export function selectionBoxes(doc: SldDoc, sel: SldSelection, symbols: SldSymbolLookup): Box[] {
  const boxes: Box[] = []
  for (const n of doc.nodes) {
    if (!sel.nodes.includes(n.id)) continue
    const def = symbols(n.symbol)
    boxes.push(def ? nodeBox(n, def) : { x: n.x, y: n.y, w: FALLBACK_SIZE, h: FALLBACK_SIZE })
  }
  for (const b of doc.buses)
    if (sel.buses.includes(b.id))
      boxes.push({
        x: Math.min(b.x1, b.x2),
        y: Math.min(b.y1, b.y2),
        w: Math.abs(b.x2 - b.x1),
        h: Math.abs(b.y2 - b.y1),
      })
  for (const f of doc.frames ?? []) if ((sel.frames ?? []).includes(f.id)) boxes.push({ x: f.x, y: f.y, w: f.w, h: f.h })
  for (const l of doc.labels) if (sel.labels.includes(l.id)) boxes.push({ x: l.x, y: l.y, w: 0, h: 0 })
  return boxes
}

export const countSelection = (sel: SldSelection): number =>
  sel.nodes.length + sel.buses.length + sel.wires.length + sel.labels.length + (sel.frames?.length ?? 0)
