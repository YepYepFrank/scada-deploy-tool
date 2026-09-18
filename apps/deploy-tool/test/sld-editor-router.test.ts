// T5.5 自定义 router 的纯函数部分:和运行时的 wirePoints() 对同一条线必须给出同一组拐点(编辑器所见 = 发布后所得)
import { describe, expect, it } from 'vitest'
import {
  busPoint,
  getSldSymbol,
  lookupSldSymbol,
  portDirection,
  portPosition,
  registerBuiltinSldSymbols,
  wirePoints,
  type SldDoc,
  type SldNode,
  type SldRotation,
  type SldWire,
  type SldWireEnd,
} from '@grid/scada-renderer'
import { routeMiddle, type SldRouteEnd } from '../src/sld-editor/x6-router'
import { busOfCell, busToCell, nodeToCell, portDirOfCell } from '../src/sld-editor/x6-adapter'
import { makeMockContent } from '../src/sld-editor/dev/mock'

registerBuiltinSldSymbols()

/** 模拟 X6 router 拿到的东西:锚点坐标 + 从 cell 快照读出来的朝向 / 母线线段(走 adapter 的同一组函数) */
function routeEnd(doc: SldDoc, end: SldWireEnd): SldRouteEnd {
  if ('bus' in end) {
    const bus = doc.buses.find(b => b.id === end.bus)!
    return { kind: 'bus', p: busPoint(bus, end.d), bus: busOfCell(busToCell(bus))! }
  }
  const node = doc.nodes.find(n => n.id === end.node)!
  const def = getSldSymbol(node.symbol)!
  return { kind: 'port', p: portPosition(node, def, end.port)!, dir: portDirOfCell(nodeToCell(node), end.port) }
}

function expectSame(doc: SldDoc, wire: SldWire): void {
  const full = wirePoints(doc, wire, lookupSldSymbol)!
  const middle = routeMiddle(
    routeEnd(doc, wire.from),
    routeEnd(doc, wire.to),
    (wire.vertices ?? []).map(([x, y]) => ({ x, y })),
    doc.canvas.grid
  )
  expect(middle).toEqual(full.slice(1, -1))
}

describe('routeMiddle 与 wirePoints 一致', () => {
  it('mock 图的每一条线(母线 → 端口、端口 → 端口、带手工拐点的)', () => {
    const { doc } = makeMockContent()
    expect(doc.wires.length).toBeGreaterThan(5)
    for (const w of doc.wires) expectSame(doc, w)
  })

  it('两个断路器:各种相对位置 × 旋转 × 镜像 × 端口组合', () => {
    let n = 0
    for (const rotA of [0, 90, 180, 270] as SldRotation[])
      for (const rotB of [0, 90] as SldRotation[])
        for (const flip of [false, true])
          for (const [dx, dy] of [
            [200, 0],
            [200, 130],
            [-170, 90],
            [0, 200],
            [30, -150],
          ] as Array<[number, number]>)
            for (const [pa, pb] of [
              ['a', 'a'],
              ['a', 'b'],
              ['b', 'a'],
              ['b', 'b'],
            ] as Array<[string, string]>) {
              const a: SldNode = { id: 'A', symbol: 'breaker', x: 400, y: 400, rot: rotA, flip }
              const b: SldNode = { id: 'B', symbol: 'breaker', x: 400 + dx, y: 400 + dy, rot: rotB }
              const doc: SldDoc = {
                v: 1,
                canvas: { w: 1000, h: 1000, grid: 10 },
                nodes: [a, b],
                buses: [],
                wires: [],
                labels: [],
              }
              expectSame(doc, { id: 'w', from: { node: 'A', port: pa }, to: { node: 'B', port: pb } })
              n += 1
            }
    expect(n).toBe(320)
  })

  it('接母线:母线上方 / 下方 / 左右、垂直母线、对端正好落在母线所在直线上', () => {
    const doc: SldDoc = {
      v: 1,
      canvas: { w: 1000, h: 1000, grid: 10 },
      nodes: [
        { id: 'up', symbol: 'meter', x: 300, y: 100, rot: 0 },
        { id: 'down', symbol: 'meter', x: 350, y: 500, rot: 180 },
        { id: 'side', symbol: 'breaker', x: 700, y: 300, rot: 90 },
        { id: 'on', symbol: 'junction', x: 590, y: 290, rot: 0 },
      ],
      buses: [
        { id: 'h', x1: 100, y1: 300, x2: 600, y2: 300 },
        { id: 'v', x1: 900, y1: 100, x2: 900, y2: 700 },
      ],
      wires: [],
      labels: [],
    }
    const ends: Array<[SldWireEnd, SldWireEnd]> = [
      [
        { bus: 'h', d: 220 },
        { node: 'up', port: 'b' },
      ],
      [
        { bus: 'h', d: 100 },
        { node: 'up', port: 'a' },
      ],
      [
        { node: 'down', port: 'a' },
        { bus: 'h', d: 400 },
      ],
      [
        { node: 'down', port: 'b' },
        { bus: 'h', d: 270 },
      ],
      [
        { bus: 'v', d: 220 },
        { node: 'side', port: 'a' },
      ],
      [
        { bus: 'v', d: 500 },
        { node: 'side', port: 'b' },
      ],
      [
        { bus: 'h', d: 500 },
        { node: 'on', port: 'w' },
      ], // 连接点圆心就在母线所在直线上:没有朝向
      [
        { bus: 'h', d: 300 },
        { bus: 'v', d: 300 },
      ],
    ]
    ends.forEach(([from, to], i) => expectSame(doc, { id: `w${i}`, from, to }))
  })

  it('有手工拐点:原样用,不重新走线', () => {
    const free: SldRouteEnd = { kind: 'free', p: { x: 0, y: 0 } }
    const vs = [
      { x: 10, y: 90 },
      { x: 70, y: 90 },
    ]
    expect(routeMiddle(free, { kind: 'free', p: { x: 300, y: 300 } }, vs)).toEqual(vs)
  })

  it('悬空端(正在拖的那头)没有朝向,也能出一条正交线', () => {
    const node: SldNode = { id: 'A', symbol: 'breaker', x: 100, y: 100, rot: 0 }
    const def = getSldSymbol('breaker')!
    const from: SldRouteEnd = { kind: 'port', p: portPosition(node, def, 'b')!, dir: portDirection(node, def, 'b') }
    const pts = [from.p, ...routeMiddle(from, { kind: 'free', p: { x: 333, y: 417 } }), { x: 333, y: 417 }]
    for (let i = 1; i < pts.length; i += 1)
      expect(pts[i]!.x === pts[i - 1]!.x || pts[i]!.y === pts[i - 1]!.y).toBe(true)
  })
})
