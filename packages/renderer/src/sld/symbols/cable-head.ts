import type { SldSymbolDefinition } from '../model/types'
import { line, polygon } from './svg'

/** 电缆头(国标画法示意,常通):尖朝下的空心三角形,上引线接三角形底边中点,下引线从尖端引出。 */
export const cableHeadSymbol: SldSymbolDefinition = {
  id: 'cable-head',
  name: '电缆头',
  category: 'connect',
  w: 40,
  h: 40,
  ports: [
    { id: 'a', x: 20, y: 0, dir: 'n' },
    { id: 'b', x: 20, y: 40, dir: 's' },
  ],
  conduct: 'always',
  body:
    line(20, 0, 20, 10) +
    polygon([
      [10, 10],
      [30, 10],
      [20, 30],
    ]) +
    line(20, 30, 20, 40),
  labelSlots: [
    { dx: 50, dy: 10 },
    { dx: 50, dy: 30 },
  ],
}
