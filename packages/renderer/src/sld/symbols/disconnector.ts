import type { SldSymbolDefinition } from '../model/types'
import { line } from './svg'

/**
 * 隔离开关(国标画法示意):上引线末端一道短横(静触头),下引线顶端是刀闸转轴。
 * 合位 = 刀闸竖直顶到短横;分位 = 刀闸向左斜开;unknown = 虚线连通。
 */
export const disconnectorSymbol: SldSymbolDefinition = {
  id: 'disconnector',
  name: '隔离开关',
  category: 'switch',
  w: 40,
  h: 60,
  ports: [
    { id: 'a', x: 20, y: 0, dir: 'n' },
    { id: 'b', x: 20, y: 60, dir: 's' },
  ],
  conduct: 'switch',
  body: line(20, 0, 20, 20) + line(14, 20, 26, 20) + line(20, 40, 20, 60),
  stateBody: {
    closed: line(20, 20, 20, 40),
    open: line(20, 40, 8, 22),
    unknown: line(20, 20, 20, 40, { dashed: true }),
  },
  labelSlots: [
    { dx: 50, dy: 20 },
    { dx: 50, dy: 40 },
  ],
}
