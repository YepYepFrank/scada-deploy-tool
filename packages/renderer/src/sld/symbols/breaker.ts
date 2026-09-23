import type { SldSymbolDefinition } from '../model/types'
import { cross, line } from './svg'

/**
 * 断路器(国标画法示意):上引线末端带叉(灭弧标记),下引线顶端是动触头的转轴。
 * 合位 = 直线连通;分位 = 动触头向左斜开;unknown = 虚线连通(不知道分合)。
 */
export const breakerSymbol: SldSymbolDefinition = {
  id: 'breaker',
  name: '断路器',
  category: 'switch',
  w: 40,
  h: 60,
  ports: [
    { id: 'a', x: 20, y: 0, dir: 'n' },
    { id: 'b', x: 20, y: 60, dir: 's' },
  ],
  conduct: 'switch',
  body: line(20, 0, 20, 20) + cross(20, 20, 4) + line(20, 40, 20, 60),
  stateBody: {
    closed: line(20, 20, 20, 40),
    open: line(20, 40, 8, 22),
    unknown: line(20, 20, 20, 40, { dashed: true }),
  },
  stateBlock: { body: line(20, 0, 20, 20) + line(20, 40, 20, 60), x: 12, y: 20, w: 16, h: 20 },
  labelSlots: [
    { dx: 50, dy: 20 },
    { dx: 50, dy: 40 },
  ],
}
