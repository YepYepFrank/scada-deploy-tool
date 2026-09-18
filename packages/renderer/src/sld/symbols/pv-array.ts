import type { SldSymbolDefinition } from '../model/types'
import { line, rect } from './svg'

/**
 * 光伏阵列(国标光伏组件画法示意,电源):横向矩形,左侧两条斜线从上下两角收到一点(光伏标记),单端口在上。
 * defaultSource:拖进画布默认标为电源点。
 */
export const pvArraySymbol: SldSymbolDefinition = {
  id: 'pv-array',
  name: '光伏阵列',
  category: 'source',
  w: 40,
  h: 40,
  ports: [{ id: 'a', x: 20, y: 0, dir: 'n' }],
  conduct: 'none',
  defaultSource: true,
  body: line(20, 0, 20, 10) + rect(4, 10, 32, 28) + line(4, 10, 16, 24) + line(4, 38, 16, 24),
  labelSlots: [
    { dx: 50, dy: 10 },
    { dx: 50, dy: 30 },
  ],
}
