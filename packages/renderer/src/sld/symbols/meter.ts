import type { SldSymbolDefinition } from '../model/types'
import { circle, line, text } from './svg'

/** 电表(串在回路里,常通):圆圈里写 Wh;右侧纵向给 3 个数值标签落点,从设备树拖测点进来时依次使用。 */
export const meterSymbol: SldSymbolDefinition = {
  id: 'meter',
  name: '电表',
  category: 'measure',
  w: 40,
  h: 40,
  ports: [
    { id: 'a', x: 20, y: 0, dir: 'n' },
    { id: 'b', x: 20, y: 40, dir: 's' },
  ],
  conduct: 'always',
  body: line(20, 0, 20, 6) + circle(20, 20, 14) + text(20, 20, 'Wh') + line(20, 34, 20, 40),
  labelSlots: [
    { dx: 50, dy: 0 },
    { dx: 50, dy: 20 },
    { dx: 50, dy: 40 },
  ],
}
