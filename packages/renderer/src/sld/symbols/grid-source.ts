import type { SldSymbolDefinition } from '../model/types'
import { circle, line, path } from './svg'

/**
 * 电网电源(示意,电源):圆里一道正弦波(用路径画,不是文字),端口在下——电源通常画在图的最上面向下供电。
 * defaultSource:拖进画布默认标为电源点(带电计算的起点)。
 */
export const gridSourceSymbol: SldSymbolDefinition = {
  id: 'grid-source',
  name: '电网电源',
  category: 'source',
  w: 40,
  h: 50,
  ports: [{ id: 'a', x: 20, y: 50, dir: 's' }],
  conduct: 'none',
  defaultSource: true,
  body: circle(20, 18, 16) + path('M10 18 Q15 6 20 18 Q25 30 30 18') + line(20, 34, 20, 50),
  labelSlots: [
    { dx: 50, dy: 10 },
    { dx: 50, dy: 30 },
  ],
}
