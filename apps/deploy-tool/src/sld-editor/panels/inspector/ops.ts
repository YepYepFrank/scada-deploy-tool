/**
 * 属性面板里「电气参数」的草稿修改(纯函数,可单测):电源点与其电压等级、母线电压等级、变压器各侧电压等级。
 * 带电着色按这些 kv 取色(ADR-005 D11);不填也能算带电,只是颜色退回主题强调色。
 * kv 传 undefined / 非正数 = 清掉该字段。
 */
import {
  SLD_BUS_WIDTH,
  SLD_GRID,
  nodeBox,
  validNodeScales,
  type SldDoc,
  type SldSymbolLookup,
} from '@grid/scada-renderer'

const validKv = (kv: number | undefined): kv is number => typeof kv === 'number' && Number.isFinite(kv) && kv > 0

/** 设 / 取消电源点;on 为 true 时 kv 可选 */
export function setNodeSource(doc: SldDoc, nodeId: string, on: boolean, kv?: number): boolean {
  const n = doc.nodes.find(x => x.id === nodeId)
  if (!n) return false
  if (!on) {
    if (!n.source) return false
    delete n.source
    return true
  }
  n.source = validKv(kv) ? { kv } : {}
  return true
}

/** 母线电压等级 */
export function setBusKv(doc: SldDoc, busId: string, kv: number | undefined): boolean {
  const b = doc.buses.find(x => x.id === busId)
  if (!b) return false
  if (validKv(kv)) b.kv = kv
  else if ('kv' in b) delete b.kv
  else return false
  return true
}

/** 变压器某一侧(端口)的电压等级;两侧都清空时去掉 portKv 字段 */
export function setPortKv(doc: SldDoc, nodeId: string, port: string, kv: number | undefined): boolean {
  const n = doc.nodes.find(x => x.id === nodeId)
  if (!n) return false
  const next = { ...(n.portKv ?? {}) }
  if (validKv(kv)) next[port] = kv
  else if (port in next) delete next[port]
  else return false
  if (Object.keys(next).length) n.portKv = next
  else delete n.portKv
  return true
}

/* ───────────── 外观(2026-09-20):节点大小、母线粗细 / 颜色、文字大小 / 粗细 / 颜色 ─────────────
   缺省值一律不落进 JSON(scale 1、线宽 4、字号 12、不加粗、随主题色都是「删掉字段」)。 */

/**
 * 节点放大倍数。只收 validNodeScales 给得出的值——端口离了栅格连线就对不齐。
 * **以包围盒中心为准放大**(再吸回栅格):一路出线上的开关 / 电表,端口都在中轴线上,
 * 按中心放大它们还在同一条竖线上;要是按左上角放大,端口会横着挪走,原本笔直的出线就拐弯了。
 */
export function setNodeScale(doc: SldDoc, nodeId: string, scale: number, symbols: SldSymbolLookup): boolean {
  const n = doc.nodes.find(x => x.id === nodeId)
  const def = n && symbols(n.symbol)
  if (!n || !def || !validNodeScales(def).includes(scale)) return false
  if ((n.scale ?? 1) === scale) return false
  const before = nodeBox(n, def)
  if (scale === 1) delete n.scale
  else n.scale = scale
  const after = nodeBox(n, def)
  const grid = doc.canvas.grid > 0 ? doc.canvas.grid : SLD_GRID
  const snap = (v: number): number => Math.round(v / grid) * grid
  n.x = snap(before.x + (before.w - after.w) / 2)
  n.y = snap(before.y + (before.h - after.h) / 2)
  return true
}

/** 母线线宽可选范围(像素) */
export const BUS_WIDTH_MIN = 2
export const BUS_WIDTH_MAX = 16

export function setBusWidth(doc: SldDoc, busId: string, width: number | undefined): boolean {
  const b = doc.buses.find(x => x.id === busId)
  if (!b) return false
  const w = width === undefined || !Number.isFinite(width) ? undefined : Math.round(width)
  if (w !== undefined && (w < BUS_WIDTH_MIN || w > BUS_WIDTH_MAX)) return false
  if (w === undefined || w === SLD_BUS_WIDTH) {
    if (b.width === undefined) return false
    delete b.width
  } else {
    if (b.width === w) return false
    b.width = w
  }
  return true
}

/** 颜色值:空 = 清掉。只认 #rgb / #rrggbb,别把任意字符串写进页面 JSON */
const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i

export function setBusColor(doc: SldDoc, busId: string, color: string | undefined): boolean {
  const b = doc.buses.find(x => x.id === busId)
  if (!b) return false
  if (!color) {
    if (b.color === undefined) return false
    delete b.color
    return true
  }
  if (!HEX.test(color) || b.color === color) return false
  b.color = color
  return true
}

export const LABEL_SIZE_MIN = 8
export const LABEL_SIZE_MAX = 72
export const LABEL_SIZE_DEFAULT = 12

export interface LabelStylePatch {
  size?: number
  /** '' = 随主题;'a' / 'b' / 'c' = 相色;其余须是 #hex */
  color?: string
  bold?: boolean
}

export function setLabelStyle(doc: SldDoc, labelId: string, patch: LabelStylePatch): boolean {
  const l = doc.labels.find(x => x.id === labelId)
  if (!l) return false
  const before = JSON.stringify([l.size, l.color, l.bold])
  if (patch.size !== undefined) {
    const s = Math.round(patch.size)
    if (!Number.isFinite(s) || s < LABEL_SIZE_MIN || s > LABEL_SIZE_MAX) return false
    if (s === LABEL_SIZE_DEFAULT) delete l.size
    else l.size = s
  }
  if (patch.color !== undefined) {
    if (patch.color === '') delete l.color
    else if (['a', 'b', 'c'].includes(patch.color) || HEX.test(patch.color)) l.color = patch.color
    else return false
  }
  if (patch.bold !== undefined) {
    if (patch.bold) l.bold = true
    else delete l.bold
  }
  return JSON.stringify([l.size, l.color, l.bold]) !== before
}

/** 输入框文本 → kv(空串 / 非法 → undefined) */
export function parseKv(text: string): number | undefined {
  const v = Number(text.trim())
  return text.trim() && Number.isFinite(v) && v > 0 ? v : undefined
}
