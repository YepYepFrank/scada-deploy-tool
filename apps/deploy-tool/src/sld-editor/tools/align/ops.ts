/**
 * 对齐 / 分布(T5.7)的纯逻辑。参与者 = 选中的节点、母线、分组框(各用自己的包围盒);
 * 结果吸附栅格 10;依附在节点上的标签跟着节点走;两端随同一位移移动的连线,手工拐点一起平移。
 */
import { nodeBox, type SldDoc, type SldSelection, type SldSymbolLookup } from '@grid/scada-renderer'
import { moveSelection } from '../../doc-ops'
import { snap, type Box } from '../_shared/geometry'

export type AlignOp = 'left' | 'right' | 'top' | 'bottom' | 'hcenter' | 'vcenter' | 'hspace' | 'vspace'

export const ALIGN_OPS: Array<{ op: AlignOp; title: string; min: number }> = [
  { op: 'left', title: '左对齐', min: 2 },
  { op: 'hcenter', title: '水平居中', min: 2 },
  { op: 'right', title: '右对齐', min: 2 },
  { op: 'top', title: '顶对齐', min: 2 },
  { op: 'vcenter', title: '垂直居中', min: 2 },
  { op: 'bottom', title: '底对齐', min: 2 },
  { op: 'hspace', title: '水平等距', min: 3 },
  { op: 'vspace', title: '垂直等距', min: 3 },
]

export interface AlignItem {
  kind: 'nodes' | 'buses' | 'frames'
  id: string
  box: Box
}

/** 图元没注册时按 4 × 4 格兜底 */
const FALLBACK = 40

export function alignItems(doc: SldDoc, sel: SldSelection, symbols: SldSymbolLookup): AlignItem[] {
  const items: AlignItem[] = []
  for (const n of doc.nodes) {
    if (!sel.nodes.includes(n.id)) continue
    const def = symbols(n.symbol)
    items.push({ kind: 'nodes', id: n.id, box: def ? nodeBox(n, def) : { x: n.x, y: n.y, w: FALLBACK, h: FALLBACK } })
  }
  for (const b of doc.buses)
    if (sel.buses.includes(b.id))
      items.push({
        kind: 'buses',
        id: b.id,
        box: { x: Math.min(b.x1, b.x2), y: Math.min(b.y1, b.y2), w: Math.abs(b.x2 - b.x1), h: Math.abs(b.y2 - b.y1) },
      })
  for (const f of doc.frames ?? [])
    if ((sel.frames ?? []).includes(f.id))
      items.push({ kind: 'frames', id: f.id, box: { x: f.x, y: f.y, w: f.w, h: f.h } })
  return items
}

/** 参与对齐的元素个数(工具的 enabled 用) */
export const alignCount = (sel: SldSelection): number => sel.nodes.length + sel.buses.length + (sel.frames?.length ?? 0)

/** 每个参与者的目标位移(已按「新位置落栅格」换算);不动的不出现在结果里 */
export function alignDeltas(items: AlignItem[], op: AlignOp): Map<string, { dx: number; dy: number }> {
  const out = new Map<string, { dx: number; dy: number }>()
  const min = ALIGN_OPS.find(o => o.op === op)?.min ?? 2
  if (items.length < min) return out
  const left = Math.min(...items.map(i => i.box.x))
  const top = Math.min(...items.map(i => i.box.y))
  const right = Math.max(...items.map(i => i.box.x + i.box.w))
  const bottom = Math.max(...items.map(i => i.box.y + i.box.h))
  const put = (it: AlignItem, x: number, y: number): void => {
    const dx = snap(x) - it.box.x
    const dy = snap(y) - it.box.y
    if (dx || dy) out.set(`${it.kind}/${it.id}`, { dx, dy })
  }
  switch (op) {
    case 'left':
      items.forEach(it => put(it, left, it.box.y))
      break
    case 'right':
      items.forEach(it => put(it, right - it.box.w, it.box.y))
      break
    case 'hcenter':
      items.forEach(it => put(it, (left + right) / 2 - it.box.w / 2, it.box.y))
      break
    case 'top':
      items.forEach(it => put(it, it.box.x, top))
      break
    case 'bottom':
      items.forEach(it => put(it, it.box.x, bottom - it.box.h))
      break
    case 'vcenter':
      items.forEach(it => put(it, it.box.x, (top + bottom) / 2 - it.box.h / 2))
      break
    case 'hspace':
    case 'vspace': {
      // 首尾不动,中间的按「间隙相等」排:gap = (总跨度 − 各自尺寸之和) / (n − 1)
      const h = op === 'hspace'
      const pos = (b: Box): number => (h ? b.x : b.y)
      const size = (b: Box): number => (h ? b.w : b.h)
      const sorted = [...items].sort((a, b) => pos(a.box) + size(a.box) / 2 - (pos(b.box) + size(b.box) / 2))
      const first = sorted[0]!
      const last = sorted[sorted.length - 1]!
      const span = pos(last.box) + size(last.box) - pos(first.box)
      const gap = (span - sorted.reduce((s, it) => s + size(it.box), 0)) / (sorted.length - 1)
      let cursor = pos(first.box)
      sorted.forEach((it, i) => {
        if (i > 0 && i < sorted.length - 1) put(it, h ? cursor : it.box.x, h ? it.box.y : cursor)
        cursor += size(it.box) + gap
      })
      break
    }
  }
  return out
}

/**
 * 在草稿上执行对齐 / 分布;返回有没有东西动了。
 * 位移相同的参与者分成一组走 doc-ops 的 moveSelection:依附标签跟随、组内连线的拐点整体平移。
 */
export function applyAlign(doc: SldDoc, sel: SldSelection, op: AlignOp, symbols: SldSymbolLookup): boolean {
  const deltas = alignDeltas(alignItems(doc, sel, symbols), op)
  if (!deltas.size) return false
  const groups = new Map<string, SldSelection>()
  for (const [key, d] of deltas) {
    const [kind, id] = key.split('/') as ['nodes' | 'buses' | 'frames', string]
    const gk = `${d.dx},${d.dy}`
    const g = groups.get(gk) ?? { nodes: [], buses: [], wires: [], labels: [], frames: [] }
    g[kind]!.push(id)
    groups.set(gk, g)
  }
  for (const [gk, g] of groups) {
    const [dx, dy] = gk.split(',').map(Number) as [number, number]
    moveSelection(doc, g, dx, dy)
  }
  return true
}
