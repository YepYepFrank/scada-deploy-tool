import type { SldSymbolDefinition } from '../model/types'
import { line, rect } from './svg'

/** 熔断器(国标画法示意,常通):竖长矩形,回路直线从中间穿过。 */
export const fuseSymbol: SldSymbolDefinition = {
  id: 'fuse',
  name: '熔断器',
  category: 'protect',
  w: 40,
  h: 60,
  ports: [
    { id: 'a', x: 20, y: 0, dir: 'n' },
    { id: 'b', x: 20, y: 60, dir: 's' },
  ],
  conduct: 'always',
  body: line(20, 0, 20, 60) + rect(14, 14, 12, 32),
  labelSlots: [
    { dx: 50, dy: 20 },
    { dx: 50, dy: 40 },
  ],
}
