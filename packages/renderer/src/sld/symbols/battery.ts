import type { SldSymbolDefinition } from '../model/types'
import { line, rect } from './svg'

/**
 * 电池(国标画法示意):单端口在上,矩形(电池柜 / 电池簇)里两组长短极板(长横为正、短横为负);加框是为了不和接地符号、电容器混淆。
 * defaultSource:储能放电时是电源,拖进画布默认标为电源点(不需要时在属性里去掉)。
 */
export const batterySymbol: SldSymbolDefinition = {
  id: 'battery',
  name: '电池',
  category: 'storage',
  w: 40,
  h: 40,
  ports: [{ id: 'a', x: 20, y: 0, dir: 'n' }],
  conduct: 'none',
  defaultSource: true,
  body:
    line(20, 0, 20, 17) +
    rect(4, 10, 32, 28) +
    line(10, 17, 30, 17) +
    line(15, 22, 25, 22) +
    line(10, 29, 30, 29) +
    line(15, 34, 25, 34),
  labelSlots: [
    { dx: 50, dy: 10 },
    { dx: 50, dy: 30 },
  ],
}
