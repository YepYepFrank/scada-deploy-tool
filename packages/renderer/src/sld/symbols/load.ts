import type { SldSymbolDefinition } from '../model/types'
import { line, polygon } from './svg'

/** 负荷(示意,终端):单端口,引线末端一个朝下的大实心箭头。 */
export const loadSymbol: SldSymbolDefinition = {
  id: 'load',
  name: '负荷',
  category: 'load',
  w: 40,
  h: 40,
  ports: [{ id: 'a', x: 20, y: 0, dir: 'n' }],
  conduct: 'none',
  body:
    line(20, 0, 20, 20) +
    polygon(
      [
        [10, 20],
        [30, 20],
        [20, 38],
      ],
      { filled: true }
    ),
  labelSlots: [
    { dx: 50, dy: 10 },
    { dx: 50, dy: 30 },
  ],
}
