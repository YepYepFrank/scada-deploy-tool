import type { SldSymbolDefinition } from '../model/types'
import { block, line, rect } from './svg'

/**
 * 简化开关(案例图 0.4 kV 出线回路的画法,非国标):回路上一个小方块,长边沿回路方向——竖向 20×40,转 90° 就是横向馈线上的 40×20。
 * 合位 = 实心;分位 = 空心;unknown = 虚线框。一页要排几十条回路时用它,与国标断路器并存,由画图的人选。
 */
export const switchSimpleSymbol: SldSymbolDefinition = {
  id: 'switch-simple',
  name: '简化开关',
  category: 'switch',
  w: 20,
  h: 40,
  ports: [
    { id: 'a', x: 10, y: 0, dir: 'n' },
    { id: 'b', x: 10, y: 40, dir: 's' },
  ],
  conduct: 'switch',
  body: line(10, 0, 10, 10) + line(10, 30, 10, 40),
  stateBody: {
    closed: block(4, 10, 12, 20),
    open: rect(4, 10, 12, 20),
    unknown: rect(4, 10, 12, 20, { dashed: true }),
  },
  stateBlock: { body: line(10, 0, 10, 10) + line(10, 30, 10, 40), x: 4, y: 10, w: 12, h: 20 },
  labelSlots: [
    { dx: 30, dy: 10 },
    { dx: 30, dy: 30 },
  ],
}
