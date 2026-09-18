import type { SldSymbolDefinition } from '../model/types'
import { arc, line } from './svg'

/** 电抗器(国标画法示意,常通):四分之三个圆——上引线伸到圆心再向左拐到圆周,缺的是左上那四分之一弧;下引线从圆底引出。 */
export const reactorSymbol: SldSymbolDefinition = {
  id: 'reactor',
  name: '电抗器',
  category: 'connect',
  w: 40,
  h: 60,
  ports: [
    { id: 'a', x: 20, y: 0, dir: 'n' },
    { id: 'b', x: 20, y: 60, dir: 's' },
  ],
  conduct: 'always',
  body:
    line(20, 0, 20, 30) +
    line(20, 30, 6, 30) +
    arc(20, 16, 14, 6, 30, { large: true, sweep: true }) +
    line(20, 44, 20, 60),
  labelSlots: [
    { dx: 50, dy: 20 },
    { dx: 50, dy: 40 },
  ],
}
