import type { SldSymbolDefinition } from '../model/types'
import { dot } from './svg'

/**
 * 连接点(T 接 / 十字接的实心小圆点,常通)。
 * 四个端口都放在圆点中心、只是朝向不同:连线直接画到圆点上,没接线的方向不会留一截引线。
 */
export const junctionSymbol: SldSymbolDefinition = {
  id: 'junction',
  name: '连接点',
  category: 'connect',
  w: 20,
  h: 20,
  ports: [
    { id: 'n', x: 10, y: 10, dir: 'n' },
    { id: 'e', x: 10, y: 10, dir: 'e' },
    { id: 's', x: 10, y: 10, dir: 's' },
    { id: 'w', x: 10, y: 10, dir: 'w' },
  ],
  conduct: 'always',
  body: dot(10, 10, 4),
}
