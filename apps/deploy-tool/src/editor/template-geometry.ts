/**
 * 模板槽位几何:把 TemplateDefinition 的槽位换算成 0–1 归一化矩形,供缩略图 / 示意图绘制。
 * scaled 模板按设计稿像素;grid 模板按 areas 矩阵(每格等宽等高)。
 */
import type { TemplateDefinition } from '@grid/scada-renderer'

export interface SlotRect {
  name: string
  title: string
  x: number
  y: number
  w: number
  h: number
  fixed: boolean
  required: boolean
}

export function slotRects(tpl: TemplateDefinition): SlotRect[] {
  if (tpl.kind === 'scaled' && tpl.design) {
    const { w: W, h: H } = tpl.design
    return tpl.slots.map(s => {
      const a = typeof s.area === 'string' ? { x: 0, y: 0, w: W, h: H } : s.area
      return {
        name: s.name,
        title: s.title ?? s.name,
        x: a.x / W,
        y: a.y / H,
        w: a.w / W,
        h: a.h / H,
        fixed: !!s.fixed,
        required: !!s.required,
      }
    })
  }
  const rows = (tpl.areas ?? []).map(r => r.trim().split(/\s+/))
  const nRows = rows.length || 1
  const nCols = Math.max(1, ...rows.map(r => r.length))
  return tpl.slots.map(s => {
    const area = typeof s.area === 'string' ? s.area : s.name
    let minR = Infinity,
      maxR = -1,
      minC = Infinity,
      maxC = -1
    rows.forEach((r, ri) =>
      r.forEach((c, ci) => {
        if (c === area) {
          minR = Math.min(minR, ri)
          maxR = Math.max(maxR, ri)
          minC = Math.min(minC, ci)
          maxC = Math.max(maxC, ci)
        }
      })
    )
    if (maxR < 0) {
      minR = 0
      maxR = 0
      minC = 0
      maxC = 0
    }
    return {
      name: s.name,
      title: s.title ?? s.name,
      x: minC / nCols,
      y: minR / nRows,
      w: (maxC - minC + 1) / nCols,
      h: (maxR - minR + 1) / nRows,
      fixed: !!s.fixed,
      required: !!s.required,
    }
  })
}

/** 缩略图宽高比(scaled 用设计稿,grid 按 16:9) */
export function aspectRatio(tpl: TemplateDefinition): number {
  return tpl.kind === 'scaled' && tpl.design ? tpl.design.w / tpl.design.h : 16 / 9
}
