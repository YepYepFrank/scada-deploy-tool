/**
 * 属性面板的草稿修改(纯函数,可单测)。
 * - 电气参数:电源点与其电压等级、母线电压等级、变压器各侧电压等级——带电着色按这些 kv 取色(ADR-005 D11);
 *   不填也能算带电,只是颜色退回主题强调色。kv 传 undefined / 非正数 = 清掉该字段。
 * - 外观:节点大小 / 颜色、母线粗细 / 颜色、文字字号 / 粗细 / 颜色 / 数值列、分组框边框、叠放层次。
 *
 * **外观这一类一律收一组 id**(2026-09-22 现场反馈「母线、文字的颜色粗细至少同类能批量改」):
 * 传一个 id 的数组就是批量,数组里只有一个就是单选。任何一个元素变了就返回 true。
 * 缺省值一律不落进 JSON(scale 1、线宽 4、字号 12、不加粗、随主题色都是「删掉字段」)。
 */
import {
  SLD_BUS_WIDTH,
  SLD_GRID,
  freeSizeStep,
  METER_CELLS_MAX,
  METER_CELLS_MIN,
  isFreeSizeSymbol,
  meterNaturalColW,
  nodeBox,
  nodeBoxSize,
  snapFreeSize,
  symbolBoxSize,
  validNodeScales,
  type SldDoc,
  type SldFrame,
  type SldLabel,
  type SldNode,
  type SldSwitchState,
  type SldSymbolLookup,
} from '@grid/scada-renderer'
import { estimateTextWidth, isMeterLabel } from '../../x6-adapter'

const validKv = (kv: number | undefined): kv is number => typeof kv === 'number' && Number.isFinite(kv) && kv > 0

/** 颜色值:空 = 清掉。只认 #rgb / #rrggbb,别把任意字符串写进页面 JSON */
const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i

/** 按 id 取一组元素(保持文档顺序,忽略找不到的 id) */
const pick = <T extends { id: string }>(list: readonly T[], ids: readonly string[]): T[] =>
  list.filter(x => ids.includes(x.id))

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

/* ───────────── 图元大小(2026-09-20 等比;2026-09-22 设备框可自由改宽高) ───────────── */

/** 放大 / 改宽高后把节点吸回栅格,并让包围盒中心尽量不动 */
function recenter(
  doc: SldDoc,
  n: SldNode,
  before: { x: number; y: number; w: number; h: number },
  after: { w: number; h: number }
): void {
  const grid = doc.canvas.grid > 0 ? doc.canvas.grid : SLD_GRID
  const snap = (v: number): number => Math.round(v / grid) * grid
  n.x = snap(before.x + (before.w - after.w) / 2)
  n.y = snap(before.y + (before.h - after.h) / 2)
}

/**
 * 节点放大倍数。只收 validNodeScales 给得出的值——端口离了栅格连线就对不齐。
 * **以包围盒中心为准放大**(再吸回栅格):一路出线上的开关 / 电表,端口都在中轴线上,
 * 按中心放大它们还在同一条竖线上;要是按左上角放大,端口会横着挪走,原本笔直的出线就拐弯了。
 */
export function setNodeScale(doc: SldDoc, ids: readonly string[], scale: number, symbols: SldSymbolLookup): boolean {
  let changed = false
  for (const n of pick(doc.nodes, ids)) {
    const def = symbols(n.symbol)
    if (!def || !validNodeScales(def).includes(scale)) continue
    if ((n.scale ?? 1) === scale && !n.size) continue
    const before = nodeBox(n, def)
    if (scale === 1) delete n.scale
    else n.scale = scale
    // 等比倍数与自由宽高互斥:选了倍数就把自由宽高去掉
    delete n.size
    recenter(doc, n, before, nodeBoxSize(n, def))
    changed = true
  }
  return changed
}

/**
 * 设备框这类图元的自由宽高(2026-09-22)。`size` 是图元局部坐标(未旋转)的宽高,
 * 会吸附到 freeSizeStep 的整数倍——端口必须落栅格。只给 w 或只给 h 时另一边不动。
 */
export function setNodeSize(
  doc: SldDoc,
  ids: readonly string[],
  size: { w?: number; h?: number },
  symbols: SldSymbolLookup
): boolean {
  let changed = false
  for (const n of pick(doc.nodes, ids)) {
    const def = symbols(n.symbol)
    if (!def || !isFreeSizeSymbol(def)) continue
    const cur = n.size ?? { w: def.w * (n.scale ?? 1), h: def.h * (n.scale ?? 1) }
    const want = { w: size.w ?? cur.w, h: size.h ?? cur.h }
    if (!Number.isFinite(want.w) || !Number.isFinite(want.h)) continue
    const next = snapFreeSize(def, want.w, want.h, doc.canvas.grid)
    if (n.size && n.size.w === next.w && n.size.h === next.h) continue
    const before = nodeBox(n, def)
    if (next.w === def.w && next.h === def.h && !n.scale) {
      if (!n.size) continue
      delete n.size
    } else {
      n.size = next
      delete n.scale
    }
    recenter(doc, n, before, nodeBoxSize(n, def))
    changed = true
  }
  return changed
}

/**
 * 用鼠标拖拉手柄改图元大小(2026-09-21 YY:拖拉比选倍数顺手)。`dragged` 是松手时画布上那个盒子。
 * - 设备框这类 freeBody 图元:宽高各自吸附到合法步长,长宽比不锁(2026-09-22)。
 * - 其余图元:倍数取离拖出来的大小**最近的合法档**(validNodeScales:放大后端口仍落栅格)。
 * - **拖哪个角,对角就不动**:看拖完的盒子哪一侧还贴着原来的边,那一侧就是锚。原盒子在栅格上、
 *   新尺寸是栅格整数倍,所以这样算出来的左上角一定还在栅格上。
 * 没变(吸回了原来那一档)返回 false,调用方据此把画布弹回去。
 */
export function resizeNodeByBox(
  doc: SldDoc,
  nodeId: string,
  dragged: { x: number; y: number; width: number; height: number },
  symbols: SldSymbolLookup
): boolean {
  const n = doc.nodes.find(x => x.id === nodeId)
  const def = n && symbols(n.symbol)
  if (!n || !def) return false
  const old = nodeBox(n, def)
  const turned = n.rot === 90 || n.rot === 270
  let w: number
  let h: number
  let apply: () => void
  if (isFreeSizeSymbol(def)) {
    // 画布上的宽高 → 图元局部宽高(转了 90 / 270 就换个个儿)
    const local = snapFreeSize(
      def,
      turned ? dragged.height : dragged.width,
      turned ? dragged.width : dragged.height,
      doc.canvas.grid
    )
    if (n.size && n.size.w === local.w && n.size.h === local.h) return false
    ;[w, h] = turned ? [local.h, local.w] : [local.w, local.h]
    apply = () => {
      n.size = local
      delete n.scale
    }
  } else {
    const base = symbolBoxSize(def, n.rot, 1)
    const raw = Math.max(dragged.width / base.w, dragged.height / base.h)
    const scale = validNodeScales(def).reduce((best, k) => (Math.abs(k - raw) < Math.abs(best - raw) ? k : best), 1)
    w = base.w * scale
    h = base.h * scale
    apply = () => {
      if (scale === 1) delete n.scale
      else n.scale = scale
    }
  }
  const leftFixed = Math.abs(dragged.x - old.x) <= Math.abs(dragged.x + dragged.width - (old.x + old.w))
  const topFixed = Math.abs(dragged.y - old.y) <= Math.abs(dragged.y + dragged.height - (old.y + old.h))
  const x = leftFixed ? old.x : old.x + old.w - w
  const y = topFixed ? old.y : old.y + old.h - h
  if (old.w === w && old.h === h && n.x === x && n.y === y) return false
  apply()
  n.x = x
  n.y = y
  return true
}

/** 设备框边框线宽范围(2026-09-23);缺省 2 不落进 JSON */
export const NODE_LINE_MIN = 1
export const NODE_LINE_MAX = 8
export const NODE_LINE_DEFAULT = 2

/**
 * 设备框这类图元的边框线宽 / 虚线(2026-09-23 现场反馈「设备框线条粗细无法修改,最好支持虚线」)。
 * 只对 freeBody 图元生效(它们按参数重画,线宽不会被 scale 放大);其余图元跳过。
 */
export function setNodeLine(
  doc: SldDoc,
  ids: readonly string[],
  patch: { width?: number; dashed?: boolean },
  symbols: SldSymbolLookup
): boolean {
  if (patch.width !== undefined) {
    const w = Math.round(patch.width)
    if (!Number.isFinite(w) || w < NODE_LINE_MIN || w > NODE_LINE_MAX) return false
  }
  let changed = false
  for (const n of pick(doc.nodes, ids)) {
    if (!isFreeSizeSymbol(symbols(n.symbol))) continue
    const before = JSON.stringify([n.lineWidth, n.dashed])
    if (patch.width !== undefined) {
      const w = Math.round(patch.width)
      if (w === NODE_LINE_DEFAULT) delete n.lineWidth
      else n.lineWidth = w
    }
    if (patch.dashed !== undefined) {
      if (patch.dashed) n.dashed = true
      else delete n.dashed
    }
    if (JSON.stringify([n.lineWidth, n.dashed]) !== before) changed = true
  }
  return changed
}

/** 这个图元能不能自由改宽高,以及宽高的步长(检视面板用) */
export function freeSizeOf(
  doc: SldDoc,
  node: SldNode | undefined,
  symbols: SldSymbolLookup
): { w: number; h: number; step: { w: number; h: number } } | undefined {
  const def = node && symbols(node.symbol)
  if (!node || !def || !isFreeSizeSymbol(def)) return undefined
  const k = node.scale ?? 1
  return { ...(node.size ?? { w: def.w * k, h: def.h * k }), step: freeSizeStep(def, doc.canvas.grid) }
}

/* ───────────── 叠放层次(2026-09-21) ───────────── */

export type StackMove = 'front' | 'back' | 'reset'

/**
 * 改选中图元 / 母线的叠放层次。置顶 = 比**其余**图元、母线里最高的还高一级,置底 = 比最低的还低一级,
 * 复位 = 删掉 z(回到缺省:图元压连线、连线压母线)。一起选中的拿到同一个 z,它们之间原来谁压谁不变。
 * z 为 0 时不落进 JSON。什么都没变返回 false。
 */
export function setStacking(
  doc: SldDoc,
  sel: { nodes: readonly string[]; buses: readonly string[] },
  move: StackMove
): boolean {
  const picked = [
    ...doc.nodes.filter(n => sel.nodes.includes(n.id)),
    ...doc.buses.filter(b => sel.buses.includes(b.id)),
  ] as Array<{ z?: number }>
  if (!picked.length) return false
  const others = [...doc.nodes, ...doc.buses].filter(x => !picked.includes(x)).map(x => x.z ?? 0)
  const target = move === 'reset' ? 0 : move === 'front' ? Math.max(0, ...others) + 1 : Math.min(0, ...others) - 1
  let changed = false
  for (const x of picked) {
    if ((x.z ?? 0) === target) continue
    if (target === 0) delete x.z
    else x.z = target
    changed = true
  }
  return changed
}

/* ───────────── 颜色(节点 / 母线 / 分组框共用一套规矩) ───────────── */

/** 自定义颜色:盖过电压等级色,但失电照样变灰。'' / undefined = 清掉,回到按电压等级 */
function paint(target: { color?: string }, color: string | undefined): boolean {
  if (!color) {
    if (target.color === undefined) return false
    delete target.color
    return true
  }
  if (!HEX.test(color) || target.color === color) return false
  target.color = color
  return true
}

/** 图元描边色(2026-09-22:电流互感器这类图元原来只能跟着带电色走) */
export function setNodeColor(doc: SldDoc, ids: readonly string[], color: string | undefined): boolean {
  return pick(doc.nodes, ids).reduce((changed, n) => paint(n, color) || changed, false)
}

/* ───────────── 母线 ───────────── */

/** 母线线宽可选范围(像素) */
export const BUS_WIDTH_MIN = 2
export const BUS_WIDTH_MAX = 16

export function setBusWidth(doc: SldDoc, ids: readonly string[], width: number | undefined): boolean {
  const w = width === undefined || !Number.isFinite(width) ? undefined : Math.round(width)
  if (w !== undefined && (w < BUS_WIDTH_MIN || w > BUS_WIDTH_MAX)) return false
  let changed = false
  for (const b of pick(doc.buses, ids)) {
    if (w === undefined || w === SLD_BUS_WIDTH) {
      if (b.width === undefined) continue
      delete b.width
    } else {
      if (b.width === w) continue
      b.width = w
    }
    changed = true
  }
  return changed
}

export function setBusColor(doc: SldDoc, ids: readonly string[], color: string | undefined): boolean {
  return pick(doc.buses, ids).reduce((changed, b) => paint(b, color) || changed, false)
}

/* ───────────── 文字 ───────────── */

export const LABEL_SIZE_MIN = 8
export const LABEL_SIZE_MAX = 72
export const LABEL_SIZE_DEFAULT = 12

export interface LabelStylePatch {
  size?: number
  /** '' = 随主题;'a' / 'b' / 'c' = 相色;其余须是 #hex */
  color?: string
  bold?: boolean
  /** 数值列起点(仅数值标签);0 / undefined = 不分列,照旧直接拼接 */
  colW?: number
  /** 显示样式(仅数值标签,2026-09-23):'' = 随组件设置(缺省数码框) */
  look?: '' | 'meter' | 'plain'
  /** 数码框位数(仅数值标签);0 = 恢复缺省(4 位) */
  cells?: number
}

const labelStyleOf = (l: SldLabel): string =>
  JSON.stringify([l.size, l.color, l.bold, ...(l.kind === 'value' ? [l.colW, l.look, l.cells] : [])])

export function setLabelStyle(doc: SldDoc, ids: readonly string[], patch: LabelStylePatch): boolean {
  // 先校验,免得一组标签只改了一半
  if (patch.size !== undefined) {
    const s = Math.round(patch.size)
    if (!Number.isFinite(s) || s < LABEL_SIZE_MIN || s > LABEL_SIZE_MAX) return false
  }
  if (
    patch.color !== undefined &&
    patch.color !== '' &&
    !['a', 'b', 'c'].includes(patch.color) &&
    !HEX.test(patch.color)
  )
    return false
  if (patch.look !== undefined && !['', 'meter', 'plain'].includes(patch.look)) return false
  if (patch.cells !== undefined && patch.cells !== 0) {
    const c = Math.round(patch.cells)
    if (!Number.isFinite(c) || c < METER_CELLS_MIN || c > METER_CELLS_MAX) return false
  }
  let changed = false
  for (const l of pick(doc.labels, ids)) {
    const before = labelStyleOf(l)
    if (patch.size !== undefined) {
      const s = Math.round(patch.size)
      if (s === LABEL_SIZE_DEFAULT) delete l.size
      else l.size = s
    }
    if (patch.color !== undefined) {
      if (patch.color === '') delete l.color
      else l.color = patch.color
    }
    if (patch.bold !== undefined) {
      if (patch.bold) l.bold = true
      else delete l.bold
    }
    if (patch.colW !== undefined && l.kind === 'value') {
      const c = Math.round(patch.colW)
      if (!Number.isFinite(c) || c <= 0) delete l.colW
      else l.colW = c
    }
    if (patch.look !== undefined && l.kind === 'value') {
      if (patch.look === '') delete l.look
      else l.look = patch.look
    }
    if (patch.cells !== undefined && l.kind === 'value') {
      if (!patch.cells) delete l.cells
      else l.cells = Math.round(patch.cells)
    }
    if (labelStyleOf(l) !== before) changed = true
  }
  return changed
}

/** 估一个「数值 + 小数点」的宽度:数字按 0.6em 算,给足位数 */
const numberWidth = (size: number, digits: number): number => Math.ceil(size * 0.6 * (digits + 1))

/**
 * 把选中的数值标签对齐成一列(2026-09-22 现场反馈「数据没有对齐」):
 * 取这一组里最宽的前缀,加上数值列的宽度,作为所有标签共同的 `colW`——
 * 于是「Uab 388.7 V」与「P 0.4 kW」的数字右对齐、单位也对齐。数值标签少于 2 个时不做。
 * 数码框(2026-09-23)按框宽算:colW 就是框的右边界,位数相同的数值小数点落在一条线上。
 */
export function alignLabelColumns(doc: SldDoc, ids: readonly string[], digits = 5): boolean {
  const labels = pick(doc.labels, ids).filter(l => l.kind === 'value')
  if (labels.length < 2) return false
  const titleW = Math.max(...labels.map(l => (l.title ? estimateTextWidth(l.title, l.size ?? LABEL_SIZE_DEFAULT) : 0)))
  const colW = Math.round(
    Math.max(
      ...labels.map(l => {
        const size = l.size ?? LABEL_SIZE_DEFAULT
        return l.kind === 'value' && isMeterLabel(l)
          ? meterNaturalColW({ size, title: l.title, cells: l.cells })
          : titleW + numberWidth(size, digits)
      })
    )
  )
  return setLabelStyle(
    doc,
    labels.map(l => l.id),
    { colW }
  )
}

/* ───────────── 分组框 ───────────── */

export const FRAME_WIDTH_MIN = 1
export const FRAME_WIDTH_MAX = 8
export const FRAME_WIDTH_DEFAULT = 1

export interface FrameStylePatch {
  color?: string
  width?: number
  solid?: boolean
}

const frameStyleOf = (f: SldFrame): string => JSON.stringify([f.color, f.width, f.solid])

export function setFrameStyle(doc: SldDoc, ids: readonly string[], patch: FrameStylePatch): boolean {
  if (patch.width !== undefined) {
    const w = Math.round(patch.width)
    if (!Number.isFinite(w) || w < FRAME_WIDTH_MIN || w > FRAME_WIDTH_MAX) return false
  }
  if (patch.color !== undefined && patch.color !== '' && !HEX.test(patch.color)) return false
  let changed = false
  for (const f of pick(doc.frames ?? [], ids)) {
    const before = frameStyleOf(f)
    if (patch.color !== undefined) paint(f, patch.color)
    if (patch.width !== undefined) {
      const w = Math.round(patch.width)
      if (w === FRAME_WIDTH_DEFAULT) delete f.width
      else f.width = w
    }
    if (patch.solid !== undefined) {
      if (patch.solid) f.solid = true
      else delete f.solid
    }
    if (frameStyleOf(f) !== before) changed = true
  }
  return changed
}

/* ───────────── 开关:没数据时按什么画(2026-09-22) ───────────── */

/**
 * 现场反馈「开关图元没有显示闭合」:回路只有电流、没有位置信号时,状态测点一直没值,
 * 图元就一直是虚线的「未知」,带电色也传不过去。这里让工程人员显式选:未知(缺省)/ 按合闸 / 按分闸。
 * 只对**配了状态测点**的节点有意义;没配状态测点的开关本来就按常合画。
 */
export function setStateFallback(doc: SldDoc, ids: readonly string[], fallback: SldSwitchState | undefined): boolean {
  let changed = false
  for (const n of pick(doc.nodes, ids)) {
    if (!n.state) continue
    const before = n.state.fallback
    if (!fallback || fallback === 'unknown') delete n.state.fallback
    else n.state.fallback = fallback
    if (n.state.fallback !== before) changed = true
  }
  return changed
}

/** 输入框文本 → kv(空串 / 非法 → undefined) */
export function parseKv(text: string): number | undefined {
  const v = Number(text.trim())
  return text.trim() && Number.isFinite(v) && v > 0 ? v : undefined
}
