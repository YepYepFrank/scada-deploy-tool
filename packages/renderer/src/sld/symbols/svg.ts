/**
 * 图元 SVG 片段的小积木。图元文件只通过这里拼片段,硬约定(ADR-005 约定 3)就不会写岔:
 * - 只出现 stroke="currentColor" / fill="currentColor" / fill="none",不写任何具体颜色——颜色由运行时按带电 / 电压等级 / 告警决定;
 * - stroke-width 统一 2;
 * - 坐标一律整数(传了小数直接抛错,注册前就能发现);
 * - 标签一律显式闭合(`<line …></line>`,不写 `<line …/>`):片段经 v-html / innerHTML 塞进去,
 *   宿主元素万一不在 SVG 命名空间里,HTML 解析器不认自闭合,后面的元素会被套成前一个的子元素。
 */
const STROKE = 'stroke="currentColor" stroke-width="2"'
/** unknown 态 / 占位用的虚线样式 */
const DASH = ' stroke-dasharray="4 3"'

function int(...nums: number[]): void {
  for (const n of nums) if (!Number.isInteger(n)) throw new Error(`图元坐标必须是整数,收到 ${n}`)
}

export interface SvgStrokeOptions {
  /** 虚线(unknown 态) */
  dashed?: boolean
  /** 线宽(只有设备框这类可调线宽的图元用;缺省 2) */
  width?: number
}

export function line(x1: number, y1: number, x2: number, y2: number, opts: SvgStrokeOptions = {}): string {
  int(x1, y1, x2, y2)
  return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" ${STROKE} fill="none"${opts.dashed ? DASH : ''}></line>`
}

/** 空心圆 */
export function circle(cx: number, cy: number, r: number, opts: SvgStrokeOptions = {}): string {
  int(cx, cy, r)
  return `<circle cx="${cx}" cy="${cy}" r="${r}" ${STROKE} fill="none"${opts.dashed ? DASH : ''}></circle>`
}

/** 实心圆点(连接点、触头) */
export function dot(cx: number, cy: number, r: number): string {
  int(cx, cy, r)
  return `<circle cx="${cx}" cy="${cy}" r="${r}" ${STROKE} fill="currentColor"></circle>`
}

/** 空心矩形 */
export function rect(x: number, y: number, w: number, h: number, opts: SvgStrokeOptions = {}): string {
  int(x, y, w, h)
  const stroke = opts.width && opts.width !== 2 ? `stroke="currentColor" stroke-width="${opts.width}"` : STROKE
  // 线宽大了虚线段也跟着拉长,不然粗线上的 4-3 虚线看着像一串点
  const dash = opts.dashed
    ? opts.width && opts.width > 2
      ? ` stroke-dasharray="${opts.width * 3} ${opts.width * 2}"`
      : DASH
    : ''
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" ${stroke} fill="none"${dash}></rect>`
}

/** 实心矩形(简化开关的合位) */
export function block(x: number, y: number, w: number, h: number): string {
  int(x, y, w, h)
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" ${STROKE} fill="currentColor"></rect>`
}

export interface SvgShapeOptions extends SvgStrokeOptions {
  /** 填实(箭头头部等);缺省空心 */
  filled?: boolean
}

function pointList(points: Array<[number, number]>): string {
  for (const [x, y] of points) int(x, y)
  return points.map(([x, y]) => `${x},${y}`).join(' ')
}

/** 折线(不闭合):手车插头的 ∧ / ∨、开口箭头 */
export function polyline(points: Array<[number, number]>, opts: SvgStrokeOptions = {}): string {
  return `<polyline points="${pointList(points)}" ${STROKE} fill="none"${opts.dashed ? DASH : ''}></polyline>`
}

/** 多边形(闭合):三角形、箭头头部;filled 填 currentColor */
export function polygon(points: Array<[number, number]>, opts: SvgShapeOptions = {}): string {
  const fill = opts.filled ? 'currentColor' : 'none'
  return `<polygon points="${pointList(points)}" ${STROKE} fill="${fill}"${opts.dashed ? DASH : ''}></polygon>`
}

/** 任意路径(不填充);d 里只许整数——弧线、正弦波这类 line / circle 拼不出来的形状用 */
export function path(d: string, opts: SvgStrokeOptions = {}): string {
  if (/\d\.\d/.test(d) || /[^MLHVQCAZ\d\s-]/i.test(d))
    throw new Error(`图元路径只许整数坐标与 M/L/H/V/Q/C/A/Z,收到 "${d}"`)
  return `<path d="${d}" ${STROKE} fill="none"${opts.dashed ? DASH : ''}></path>`
}

/** 圆弧:从 (x1, y1) 沿半径 r 的圆画到 (x2, y2);large = 走大弧,sweep = 顺时针 */
export function arc(
  x1: number,
  y1: number,
  r: number,
  x2: number,
  y2: number,
  opts: SvgStrokeOptions & { large?: boolean; sweep?: boolean } = {}
): string {
  int(x1, y1, r, x2, y2)
  return path(`M${x1} ${y1} A${r} ${r} 0 ${opts.large ? 1 : 0} ${opts.sweep ? 1 : 0} ${x2} ${y2}`, opts)
}

/** 接地符号:以 (cx, y) 为顶边中点的三条渐短横线,占高 10(接地开关、避雷器、带电显示器) */
export function ground(cx: number, y: number): string {
  return line(cx - 12, y, cx + 12, y) + line(cx - 8, y + 5, cx + 8, y + 5) + line(cx - 4, y + 10, cx + 4, y + 10)
}

/** 以 (cx, cy) 为中心、半边长 r 的叉(断路器的灭弧标记) */
export function cross(cx: number, cy: number, r: number): string {
  return line(cx - r, cy - r, cx + r, cy + r) + line(cx + r, cy - r, cx - r, cy + r)
}

/** 居中文字(不描边,只填 currentColor);注意文字会跟着图元一起旋转 / 镜像 */
export function text(x: number, y: number, content: string, size = 12): string {
  int(x, y, size)
  const esc = content.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  return `<text x="${x}" y="${y}" font-size="${size}" text-anchor="middle" dominant-baseline="central" fill="currentColor">${esc}</text>`
}
