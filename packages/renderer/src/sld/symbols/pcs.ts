import type { SldSymbolDefinition } from '../model/types'
import { line, rect } from './svg'

/** 储能变流器(示意,常通):矩形里写 PCS(写在 texts),端口 a 接交流侧(上)、b 接电池侧(下)。 */
export const pcsSymbol: SldSymbolDefinition = {
  id: 'pcs',
  name: '储能变流器',
  category: 'storage',
  w: 40,
  h: 60,
  ports: [
    { id: 'a', x: 20, y: 0, dir: 'n' },
    { id: 'b', x: 20, y: 60, dir: 's' },
  ],
  conduct: 'always',
  body: line(20, 0, 20, 10) + rect(4, 10, 32, 40) + line(20, 50, 20, 60),
  texts: [{ x: 20, y: 30, text: 'PCS', size: 12 }],
  labelSlots: [
    { dx: 50, dy: 10 },
    { dx: 50, dy: 30 },
    { dx: 50, dy: 50 },
  ],
}
