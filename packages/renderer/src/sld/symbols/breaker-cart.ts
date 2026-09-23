import type { SldSymbolDefinition } from '../model/types'
import { cross, line, polyline } from './svg'

/**
 * 手车式断路器(国标画法示意):断路器本体两端各一副插头——上端两个 ∧、下端两个 ∨(《》形,动插头套静插座),中间留缝表示可抽出。
 * 三态同断路器:合位 = 直线连通;分位 = 动触头向左斜开;unknown = 虚线。手车的工作 / 试验位置一期不画。
 */
export const breakerCartSymbol: SldSymbolDefinition = {
  id: 'breaker-cart',
  name: '手车式断路器',
  category: 'switch',
  w: 40,
  h: 80,
  ports: [
    { id: 'a', x: 20, y: 0, dir: 'n' },
    { id: 'b', x: 20, y: 80, dir: 's' },
  ],
  conduct: 'switch',
  body:
    line(20, 0, 20, 6) +
    polyline([
      [12, 12],
      [20, 6],
      [28, 12],
    ]) +
    polyline([
      [12, 18],
      [20, 12],
      [28, 18],
    ]) +
    line(20, 12, 20, 32) +
    cross(20, 32, 4) +
    line(20, 50, 20, 68) +
    polyline([
      [12, 62],
      [20, 68],
      [28, 62],
    ]) +
    polyline([
      [12, 68],
      [20, 74],
      [28, 68],
    ]) +
    line(20, 74, 20, 80),
  stateBody: {
    closed: line(20, 32, 20, 50),
    open: line(20, 50, 8, 34),
    unknown: line(20, 32, 20, 50, { dashed: true }),
  },
  // 状态色:手车的上下插头保留,中间换成方块
  stateBlock: {
    body:
      line(20, 0, 20, 6) +
      polyline([
        [12, 12],
        [20, 6],
        [28, 12],
      ]) +
      polyline([
        [12, 18],
        [20, 12],
        [28, 18],
      ]) +
      line(20, 12, 20, 32) +
      line(20, 50, 20, 68) +
      polyline([
        [12, 62],
        [20, 68],
        [28, 62],
      ]) +
      polyline([
        [12, 68],
        [20, 74],
        [28, 68],
      ]) +
      line(20, 74, 20, 80),
    x: 12,
    y: 32,
    w: 16,
    h: 18,
  },
  labelSlots: [
    { dx: 50, dy: 20 },
    { dx: 50, dy: 40 },
    { dx: 50, dy: 60 },
  ],
}
