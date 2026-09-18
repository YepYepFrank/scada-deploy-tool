import type { SldSymbolDefinition } from '../model/types'
import { circle, line } from './svg'

/** 电压互感器(国标画法示意,终端):单端口,引线下面挂两个相交的小圆(一、二次绕组);比双绕组变小一号,且只有一个端口。 */
export const ptSymbol: SldSymbolDefinition = {
  id: 'pt',
  name: '电压互感器',
  category: 'measure',
  w: 40,
  h: 50,
  ports: [{ id: 'a', x: 20, y: 0, dir: 'n' }],
  conduct: 'none',
  body: line(20, 0, 20, 14) + circle(20, 24, 10) + circle(20, 38, 10),
  labelSlots: [
    { dx: 50, dy: 10 },
    { dx: 50, dy: 30 },
  ],
}
