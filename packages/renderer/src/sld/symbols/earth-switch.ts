import type { SldSymbolDefinition } from '../model/types'
import { ground, line } from './svg'

/**
 * 接地开关(国标画法示意):单端口,上引线末端短横(静触头),刀闸下面直接落到接地符号(三条渐短横线)。
 * conduct = 'none'(不向外传带电),但三态 stateBody 给全:合位 = 刀闸竖直(已接地);分位 = 向左斜开;unknown = 虚线。
 */
export const earthSwitchSymbol: SldSymbolDefinition = {
  id: 'earth-switch',
  name: '接地开关',
  category: 'switch',
  w: 40,
  h: 60,
  ports: [{ id: 'a', x: 20, y: 0, dir: 'n' }],
  conduct: 'none',
  body: line(20, 0, 20, 10) + line(14, 10, 26, 10) + line(20, 30, 20, 40) + ground(20, 40),
  stateBody: {
    closed: line(20, 10, 20, 30),
    open: line(20, 30, 8, 12),
    unknown: line(20, 10, 20, 30, { dashed: true }),
  },
  labelSlots: [
    { dx: 50, dy: 10 },
    { dx: 50, dy: 30 },
  ],
}
