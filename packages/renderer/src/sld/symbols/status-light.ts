import type { SldSymbolDefinition } from '../model/types'
import { circle, dot } from './svg'

/**
 * 状态灯(通用,如「安全检测」):20×20 的小圆,无端口、不导通;走节点的 state:closed = 实心、open = 空心、unknown = 虚线圈。
 * body 为空,形状全在 stateBody 里(<SldSymbol> 缺省按 open 画)。
 */
export const statusLightSymbol: SldSymbolDefinition = {
  id: 'status-light',
  name: '状态灯',
  category: 'measure',
  w: 20,
  h: 20,
  ports: [],
  conduct: 'none',
  body: '',
  stateBody: {
    closed: dot(10, 10, 7),
    open: circle(10, 10, 7),
    unknown: circle(10, 10, 7, { dashed: true }),
  },
  labelSlots: [
    { dx: 30, dy: 0 },
    { dx: 30, dy: 20 },
  ],
}
