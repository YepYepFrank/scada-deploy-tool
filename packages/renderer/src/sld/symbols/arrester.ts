import type { SldSymbolDefinition } from '../model/types'
import { ground, line, polygon, rect } from './svg'

/** 避雷器(国标画法示意,终端):单端口,竖长矩形里一个朝下的实心箭头,矩形下面接地。 */
export const arresterSymbol: SldSymbolDefinition = {
  id: 'arrester',
  name: '避雷器',
  category: 'protect',
  w: 40,
  h: 60,
  ports: [{ id: 'a', x: 20, y: 0, dir: 'n' }],
  conduct: 'none',
  body:
    line(20, 0, 20, 22) +
    rect(14, 10, 12, 30) +
    polygon(
      [
        [16, 22],
        [24, 22],
        [20, 30],
      ],
      { filled: true }
    ) +
    line(20, 40, 20, 46) +
    ground(20, 46),
  labelSlots: [
    { dx: 50, dy: 10 },
    { dx: 50, dy: 30 },
  ],
}
