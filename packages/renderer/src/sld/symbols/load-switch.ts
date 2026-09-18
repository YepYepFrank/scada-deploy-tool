import type { SldSymbolDefinition } from '../model/types'
import { circle, line } from './svg'

/**
 * 负荷开关(国标画法示意):隔离开关的短横下面加一个小圆(能带负荷分断的标记),刀闸合位顶到小圆。
 * 合位 = 刀闸竖直;分位 = 向左斜开;unknown = 虚线连通。
 */
export const loadSwitchSymbol: SldSymbolDefinition = {
  id: 'load-switch',
  name: '负荷开关',
  category: 'switch',
  w: 40,
  h: 60,
  ports: [
    { id: 'a', x: 20, y: 0, dir: 'n' },
    { id: 'b', x: 20, y: 60, dir: 's' },
  ],
  conduct: 'switch',
  body: line(20, 0, 20, 16) + line(14, 16, 26, 16) + circle(20, 20, 4) + line(20, 40, 20, 60),
  stateBody: {
    closed: line(20, 24, 20, 40),
    open: line(20, 40, 8, 22),
    unknown: line(20, 24, 20, 40, { dashed: true }),
  },
  labelSlots: [
    { dx: 50, dy: 20 },
    { dx: 50, dy: 40 },
  ],
}
