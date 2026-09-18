import type { SldSymbolDefinition } from '../model/types'
import { circle, cross, ground, line } from './svg'

/** 带电显示器(常见画法示意,终端):单端口,引线经一只电容(两道短横)接到指示灯(圆里打叉),灯下接地。 */
export const liveIndicatorSymbol: SldSymbolDefinition = {
  id: 'live-indicator',
  name: '带电显示器',
  category: 'measure',
  w: 40,
  h: 60,
  ports: [{ id: 'a', x: 20, y: 0, dir: 'n' }],
  conduct: 'none',
  body:
    line(20, 0, 20, 8) +
    line(12, 8, 28, 8) +
    line(12, 14, 28, 14) +
    line(20, 14, 20, 20) +
    circle(20, 28, 8) +
    cross(20, 28, 5) +
    line(20, 36, 20, 46) +
    ground(20, 46),
  labelSlots: [
    { dx: 50, dy: 10 },
    { dx: 50, dy: 30 },
  ],
}
