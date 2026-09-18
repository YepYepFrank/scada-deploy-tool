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
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" ${STROKE} fill="none"${opts.dashed ? DASH : ''}></rect>`
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
