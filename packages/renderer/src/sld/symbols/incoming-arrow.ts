import type { SldSymbolDefinition } from '../model/types'
import { line, polygon } from './svg'

/**
 * 进线箭头(示意,电源):一小段引线中间带朝下的实心箭头,表示电源从图外引入;端口在下(箭头指向端口)。
 * defaultSource:拖进画布默认标为电源点。
 */
export const incomingArrowSymbol: SldSymbolDefinition = {
  id: 'incoming-arrow',
  name: '进线箭头',
  category: 'source',
  w: 20,
  h: 30,
  ports: [{ id: 'a', x: 10, y: 30, dir: 's' }],
  conduct: 'none',
  defaultSource: true,
  body:
    line(10, 0, 10, 30) +
    polygon(
      [
        [4, 8],
        [16, 8],
        [10, 20],
      ],
      { filled: true }
    ),
  labelSlots: [
    { dx: 30, dy: 0 },
    { dx: 30, dy: 20 },
  ],
}
