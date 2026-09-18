import type { SldSymbolDefinition } from '../model/types'
import { circle, line, polygon } from './svg'

/**
 * 双绕组变压器(国标画法示意):上下两个相交的圆,上圆高压侧(端口 hv)、下圆低压侧(端口 lv);圆里的 △ / Y 是常见的 Dyn11 接线组别示意。
 * conduct = 'transformer':带电能传过去,电压等级换成 node.portKv[对侧端口]。
 */
export const transformer2wSymbol: SldSymbolDefinition = {
  id: 'transformer-2w',
  name: '双绕组变压器',
  category: 'transformer',
  w: 40,
  h: 80,
  ports: [
    { id: 'hv', x: 20, y: 0, dir: 'n' },
    { id: 'lv', x: 20, y: 80, dir: 's' },
  ],
  conduct: 'transformer',
  body:
    line(20, 0, 20, 12) +
    circle(20, 28, 16) +
    circle(20, 52, 16) +
    line(20, 68, 20, 80) +
    polygon([
      [20, 18],
      [14, 28],
      [26, 28],
    ]) +
    line(20, 56, 20, 63) +
    line(20, 56, 14, 50) +
    line(20, 56, 26, 50),
  labelSlots: [
    { dx: 50, dy: 20 },
    { dx: 50, dy: 40 },
    { dx: 50, dy: 60 },
  ],
}
