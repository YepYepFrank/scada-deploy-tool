import type { SldSymbolDefinition } from '../model/types'
import { circle, line } from './svg'

/** 电流互感器(国标画法示意,常通):回路直线穿过一个圆(铁芯),右侧引出二次线并打两道斜杠。 */
export const ctSymbol: SldSymbolDefinition = {
  id: 'ct',
  name: '电流互感器',
  category: 'measure',
  w: 40,
  h: 40,
  ports: [
    { id: 'a', x: 20, y: 0, dir: 'n' },
    { id: 'b', x: 20, y: 40, dir: 's' },
  ],
  conduct: 'always',
  body: line(20, 0, 20, 40) + circle(20, 20, 10) + line(30, 20, 40, 20) + line(32, 24, 36, 16) + line(35, 24, 39, 16),
  labelSlots: [
    { dx: 50, dy: 0 },
    { dx: 50, dy: 20 },
    { dx: 50, dy: 40 },
  ],
}
