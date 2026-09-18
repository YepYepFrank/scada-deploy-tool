import type { SldSymbolDefinition } from '../model/types'
import { ground, line } from './svg'

/** 电容器(国标画法示意,终端):单端口,两道平行横线(极板),下极板引线接地——无功补偿柜的并联电容器组用。 */
export const capacitorSymbol: SldSymbolDefinition = {
  id: 'capacitor',
  name: '电容器',
  category: 'load',
  w: 40,
  h: 50,
  ports: [{ id: 'a', x: 20, y: 0, dir: 'n' }],
  conduct: 'none',
  body: line(20, 0, 20, 18) + line(8, 18, 32, 18) + line(8, 26, 32, 26) + line(20, 26, 20, 36) + ground(20, 36),
  labelSlots: [
    { dx: 50, dy: 10 },
    { dx: 50, dy: 30 },
  ],
}
