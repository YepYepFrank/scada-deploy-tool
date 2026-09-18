import type { SldSymbolDefinition } from '../model/types'
import { line, polyline } from './svg'

/** 出线箭头(示意,终端):单端口,一小段引线末端带开口箭头,表示回路引出本图;转 90° 就是案例图里横向馈线末端的箭头。 */
export const feederArrowSymbol: SldSymbolDefinition = {
  id: 'feeder-arrow',
  name: '出线箭头',
  category: 'load',
  w: 20,
  h: 30,
  ports: [{ id: 'a', x: 10, y: 0, dir: 'n' }],
  conduct: 'none',
  body:
    line(10, 0, 10, 28) +
    polyline([
      [4, 18],
      [10, 28],
      [16, 18],
    ]),
  labelSlots: [
    { dx: 30, dy: 0 },
    { dx: 30, dy: 20 },
  ],
}
