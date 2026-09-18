import type { SldSymbolDefinition } from '../model/types'
import { line, polyline, rect } from './svg'

/** 充电桩(示意,非国标,终端):单端口,竖长矩形(桩体)里一道闪电折线。 */
export const chargerSymbol: SldSymbolDefinition = {
  id: 'charger',
  name: '充电桩',
  category: 'load',
  w: 40,
  h: 50,
  ports: [{ id: 'a', x: 20, y: 0, dir: 'n' }],
  conduct: 'none',
  body:
    line(20, 0, 20, 10) +
    rect(8, 10, 24, 38) +
    polyline([
      [23, 16],
      [15, 30],
      [25, 30],
      [17, 44],
    ]),
  labelSlots: [
    { dx: 50, dy: 10 },
    { dx: 50, dy: 30 },
  ],
}
