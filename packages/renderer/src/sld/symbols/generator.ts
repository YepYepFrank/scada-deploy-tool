import type { SldSymbolDefinition } from '../model/types'
import { circle, line } from './svg'

/**
 * 发电机(国标画法示意,电源):圆里写 G 和 ~(写在 texts,旋转 / 镜像时字保持正向),单端口在上。
 * defaultSource:拖进画布默认标为电源点。
 */
export const generatorSymbol: SldSymbolDefinition = {
  id: 'generator',
  name: '发电机',
  category: 'source',
  w: 40,
  h: 50,
  ports: [{ id: 'a', x: 20, y: 0, dir: 'n' }],
  conduct: 'none',
  defaultSource: true,
  body: line(20, 0, 20, 16) + circle(20, 32, 16),
  texts: [
    { x: 20, y: 27, text: 'G', size: 14 },
    { x: 20, y: 39, text: '~', size: 14 },
  ],
  labelSlots: [
    { dx: 50, dy: 10 },
    { dx: 50, dy: 30 },
  ],
}
