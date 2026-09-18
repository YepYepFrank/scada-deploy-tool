import type { SldSymbolDefinition } from '../model/types'
import { rect } from './svg'

/** 设备框(通用,非电气设备:除湿机、液冷机等):80×40 的矩形,四边中点各一个端口;图元本身不写字,名字由节点的 name 标签显示。 */
export const deviceBoxSymbol: SldSymbolDefinition = {
  id: 'device-box',
  name: '设备框',
  category: 'load',
  w: 80,
  h: 40,
  ports: [
    { id: 'n', x: 40, y: 0, dir: 'n' },
    { id: 'e', x: 80, y: 20, dir: 'e' },
    { id: 's', x: 40, y: 40, dir: 's' },
    { id: 'w', x: 0, y: 20, dir: 'w' },
  ],
  conduct: 'none',
  body: rect(0, 0, 80, 40),
  labelSlots: [
    { dx: 90, dy: 0 },
    { dx: 90, dy: 20 },
    { dx: 90, dy: 40 },
  ],
}
