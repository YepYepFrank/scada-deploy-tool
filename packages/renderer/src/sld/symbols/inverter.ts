import type { SldSymbolDefinition } from '../model/types'
import { line, rect } from './svg'

/** 逆变器(国标变流器画法示意,常通):矩形加一条左下到右上的对角线,左上角 ~(交流侧,端口 a)、右下角 =(直流侧,端口 b);字写在 texts。 */
export const inverterSymbol: SldSymbolDefinition = {
  id: 'inverter',
  name: '逆变器',
  category: 'storage',
  w: 40,
  h: 60,
  ports: [
    { id: 'a', x: 20, y: 0, dir: 'n' },
    { id: 'b', x: 20, y: 60, dir: 's' },
  ],
  conduct: 'always',
  body: line(20, 0, 20, 10) + rect(4, 10, 32, 40) + line(4, 50, 36, 10) + line(20, 50, 20, 60),
  texts: [
    { x: 13, y: 20, text: '~', size: 14 },
    { x: 27, y: 41, text: '=', size: 14 },
  ],
  labelSlots: [
    { dx: 50, dy: 10 },
    { dx: 50, dy: 30 },
    { dx: 50, dy: 50 },
  ],
}
