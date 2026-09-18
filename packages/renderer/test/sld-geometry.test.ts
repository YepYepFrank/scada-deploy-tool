/**
 * T5.0 接线图几何:端口坐标 / 朝向 / 包围盒(四个旋转 × 是否镜像)、母线取点、连线缺省折线。
 * 图元用测试里自带的定义经 lookup 注入,不依赖图元注册表。
 */
import { describe, it, expect } from 'vitest'
import {
  portPosition,
  portDirection,
  nodeBox,
  symbolBoxSize,
  symbolTransform,
  busPoint,
  busOffset,
  busLength,
  wirePoints,
} from '../src/sld'
import type {
  SldBus,
  SldDoc,
  SldNode,
  SldPoint,
  SldRotation,
  SldSymbolDefinition,
  SldSymbolLookup,
  SldWire,
} from '../src/sld'

/** 40×60,故意不对称:c 在右边,镜像后才看得出区别 */
const sym: SldSymbolDefinition = {
  id: 't',
  name: '测试图元',
  category: 'switch',
  w: 40,
  h: 60,
  ports: [
    { id: 'a', x: 20, y: 0, dir: 'n' },
    { id: 'b', x: 20, y: 60, dir: 's' },
    { id: 'c', x: 40, y: 20, dir: 'e' },
  ],
  conduct: 'always',
  body: '',
}
const lookup: SldSymbolLookup = id => (id === 't' ? sym : undefined)
const node = (id: string, x: number, y: number, rot: SldRotation = 0, flip = false): SldNode => ({
  id,
  symbol: 't',
  x,
  y,
  rot,
  flip,
})

describe('portPosition / portDirection / nodeBox', () => {
  // [rot, flip, a, b, c, 包围盒 w×h];节点放在 (100, 200)
  const cases: Array<[SldRotation, boolean, string, string, string, string]> = [
    [0, false, '120,200,n', '120,260,s', '140,220,e', '40x60'],
    [0, true, '120,200,n', '120,260,s', '100,220,w', '40x60'],
    [90, false, '160,220,e', '100,220,w', '140,240,s', '60x40'],
    [90, true, '160,220,e', '100,220,w', '140,200,n', '60x40'],
    [180, false, '120,260,s', '120,200,n', '100,240,w', '40x60'],
    [180, true, '120,260,s', '120,200,n', '140,240,e', '40x60'],
    [270, false, '100,220,w', '160,220,e', '120,200,n', '60x40'],
    [270, true, '100,220,w', '160,220,e', '120,240,s', '60x40'],
  ]
  const fmt = (n: SldNode, port: string): string => {
    const p = portPosition(n, sym, port)!
    return `${p.x},${p.y},${portDirection(n, sym, port)}`
  }
  it.each(cases)('rot=%i flip=%s', (rot, flip, a, b, c, size) => {
    const n = node('n1', 100, 200, rot, flip)
    expect(fmt(n, 'a')).toBe(a)
    expect(fmt(n, 'b')).toBe(b)
    expect(fmt(n, 'c')).toBe(c)
    const box = nodeBox(n, sym)
    // 旋转后左上角仍是 (node.x, node.y)
    expect([box.x, box.y]).toEqual([100, 200])
    expect(`${box.w}x${box.h}`).toBe(size)
    expect(symbolBoxSize(sym, rot)).toEqual({ w: box.w, h: box.h })
    // 端口都落在旋转后的包围盒里,且仍是整数栅格点
    for (const id of ['a', 'b', 'c']) {
      const p = portPosition(n, sym, id)!
      expect(p.x >= box.x && p.x <= box.x + box.w && p.y >= box.y && p.y <= box.y + box.h).toBe(true)
      expect(p.x % 10 === 0 && p.y % 10 === 0).toBe(true)
    }
  })

  it('flip 缺省按不镜像;端口不存在 → undefined', () => {
    const n: SldNode = { id: 'n', symbol: 't', x: 0, y: 0, rot: 0 }
    expect(portPosition(n, sym, 'c')).toEqual({ x: 40, y: 20 })
    expect(portPosition(n, sym, 'nope')).toBeUndefined()
    expect(portDirection(n, sym, 'nope')).toBeUndefined()
  })

  it('symbolTransform(<SldSymbol> 用的 SVG transform)与 portPosition 是同一套规则', () => {
    /** 按 SVG 语义从右往左套用 translate / rotate / scale */
    const apply = (transform: string | undefined, p: SldPoint): SldPoint => {
      let { x, y } = p
      const ops = [...(transform ?? '').matchAll(/(translate|rotate|scale)\(([^)]*)\)/g)].reverse()
      for (const [, op, args = ''] of ops) {
        const [a = 0, b = 0] = args.split(/[ ,]+/).map(Number)
        if (op === 'translate') [x, y] = [x + a, y + b]
        else if (op === 'scale') [x, y] = [x * a, y * b]
        else {
          const r = (a * Math.PI) / 180
          ;[x, y] = [x * Math.cos(r) - y * Math.sin(r), x * Math.sin(r) + y * Math.cos(r)]
        }
      }
      return { x: Math.round(x) + 0, y: Math.round(y) + 0 } // + 0:把 -0 归成 0
    }
    expect(symbolTransform(sym, 0, false)).toBeUndefined()
    for (const rot of [0, 90, 180, 270] as SldRotation[])
      for (const flip of [false, true])
        for (const port of sym.ports)
          expect(apply(symbolTransform(sym, rot, flip), port), `rot=${rot} flip=${flip} ${port.id}`).toEqual(
            portPosition(node('n', 0, 0, rot, flip), sym, port.id)
          )
  })
})

describe('busPoint / busOffset / busLength', () => {
  const h: SldBus = { id: 'b1', x1: 100, y1: 50, x2: 500, y2: 50 }
  const v: SldBus = { id: 'b2', x1: 80, y1: 100, x2: 80, y2: 400 }

  it('按距 (x1,y1) 的像素数取点;长度', () => {
    expect(busLength(h)).toBe(400)
    expect(busLength(v)).toBe(300)
    expect(busPoint(h, 0)).toEqual({ x: 100, y: 50 })
    expect(busPoint(h, 100)).toEqual({ x: 200, y: 50 })
    expect(busPoint(h, 400)).toEqual({ x: 500, y: 50 })
    expect(busPoint(v, 150)).toEqual({ x: 80, y: 250 })
  })

  it('busOffset 与 busPoint 互逆(栅格点上)', () => {
    for (const bus of [h, v]) for (const d of [0, 10, 120, 300]) expect(busOffset(bus, busPoint(bus, d))).toBe(d)
    expect(busPoint(h, busOffset(h, { x: 220, y: 50 }))).toEqual({ x: 220, y: 50 })
  })

  it('取垂足、吸附栅格、越界夹取', () => {
    expect(busOffset(h, { x: 300, y: 999 })).toBe(200)
    expect(busOffset(h, { x: 304, y: 50 })).toBe(200)
    expect(busOffset(h, { x: 306, y: 50 })).toBe(210)
    expect(busOffset(h, { x: 306, y: 50 }, 0)).toBe(206)
    expect(busOffset(h, { x: -50, y: 50 })).toBe(0)
    expect(busOffset(h, { x: 9999, y: 0 })).toBe(400)
    expect(busOffset(v, { x: 0, y: 1000 })).toBe(300)
    expect(busPoint(h, -1)).toEqual({ x: 100, y: 50 })
    expect(busPoint(h, 9999)).toEqual({ x: 500, y: 50 })
    expect(busPoint(h, NaN)).toEqual({ x: 100, y: 50 })
  })

  it('零长度母线不除零', () => {
    const z: SldBus = { id: 'z', x1: 10, y1: 10, x2: 10, y2: 10 }
    expect(busOffset(z, { x: 50, y: 50 })).toBe(0)
    expect(busPoint(z, 30)).toEqual({ x: 10, y: 10 })
  })
})

describe('wirePoints', () => {
  const doc = (nodes: SldNode[], wires: SldWire[], buses: SldBus[] = []): SldDoc => ({
    v: 1,
    canvas: { w: 1000, h: 800, grid: 10 },
    nodes,
    buses,
    wires,
    labels: [],
  })
  const xy = (pts: SldPoint[] | undefined): Array<[number, number]> => (pts ?? []).map(p => [p.x, p.y])

  /** 每段水平或垂直、无零长度段、整条线上没有重复点 */
  const expectOrthogonal = (pts: SldPoint[]): void => {
    for (let i = 1; i < pts.length; i++) {
      const [p, q] = [pts[i - 1]!, pts[i]!]
      expect(p.x === q.x || p.y === q.y, `第 ${i} 段不正交`).toBe(true)
      expect(p.x === q.x && p.y === q.y, `第 ${i} 段零长度`).toBe(false)
    }
    expect(new Set(pts.map(p => `${p.x},${p.y}`)).size).toBe(pts.length)
  }

  it('直线:两端共线', () => {
    const w: SldWire = { id: 'w', from: { node: 'n1', port: 'b' }, to: { node: 'n2', port: 'a' } }
    const pts = wirePoints(doc([node('n1', 100, 100), node('n2', 100, 200)], [w]), w, lookup)!
    expect(xy(pts)).toEqual([
      [120, 160],
      [120, 200],
    ])
    expectOrthogonal(pts)
  })

  it('Z 形:两端朝向同轴、不共线,在中点(落栅格)折返', () => {
    const w: SldWire = { id: 'w', from: { node: 'n1', port: 'b' }, to: { node: 'n2', port: 'a' } }
    const pts = wirePoints(doc([node('n1', 100, 100), node('n2', 200, 300)], [w]), w, lookup)!
    expect(xy(pts)).toEqual([
      [120, 160],
      [120, 230],
      [220, 230],
      [220, 300],
    ])
    expectOrthogonal(pts)
  })

  it('L 形:两端朝向互相垂直', () => {
    // n3 转 90°:b 端口到左中 (300, 220),朝向 w
    const w: SldWire = { id: 'w', from: { node: 'n1', port: 'b' }, to: { node: 'n3', port: 'b' } }
    const pts = wirePoints(doc([node('n1', 100, 100), node('n3', 300, 200, 90)], [w]), w, lookup)!
    expect(xy(pts)).toEqual([
      [120, 160],
      [120, 220],
      [300, 220],
    ])
    expectOrthogonal(pts)
  })

  it('带 vertices:原样夹在两端之间', () => {
    const w: SldWire = {
      id: 'w',
      from: { node: 'n1', port: 'b' },
      to: { node: 'n2', port: 'a' },
      vertices: [
        [120, 180],
        [220, 180],
      ],
    }
    const pts = wirePoints(doc([node('n1', 100, 100), node('n2', 200, 300)], [w]), w, lookup)!
    expect(xy(pts)).toEqual([
      [120, 160],
      [120, 180],
      [220, 180],
      [220, 300],
    ])
    expectOrthogonal(pts)
  })

  it('母线端:朝向垂直于母线、指向另一端所在一侧', () => {
    const bus: SldBus = { id: 'bus', x1: 0, y1: 50, x2: 400, y2: 50 }
    const down: SldWire = { id: 'w1', from: { bus: 'bus', d: 200 }, to: { node: 'n1', port: 'a' } }
    const up: SldWire = { id: 'w2', from: { node: 'n0', port: 'b' }, to: { bus: 'bus', d: 300 } }
    const d = doc([node('n1', 100, 100), node('n0', 100, -100)], [down, up], [bus])
    // 节点在母线下方:从 (200, 50) 向下出线
    const p1 = wirePoints(d, down, lookup)!
    expect(xy(p1)).toEqual([
      [200, 50],
      [200, 80],
      [120, 80],
      [120, 100],
    ])
    expectOrthogonal(p1)
    // 节点在母线上方:b 端口 (120, -40) 朝下,母线端 (300, 50) 朝上
    const p2 = wirePoints(d, up, lookup)!
    expect(xy(p2)[0]).toEqual([120, -40])
    expect(xy(p2)[p2.length - 1]).toEqual([300, 50])
    expect(p2[p2.length - 2]!.x).toBe(300)
    expect(p2[p2.length - 2]!.y).toBeLessThan(50)
    expectOrthogonal(p2)
    // 正对着母线的端口:一条直线
    const straight: SldWire = { id: 'w3', from: { bus: 'bus', d: 120 }, to: { node: 'n1', port: 'a' } }
    expect(xy(wirePoints(d, straight, lookup))).toEqual([
      [120, 50],
      [120, 100],
    ])
  })

  it('悬空:节点 / 端口 / 母线 / 图元任一不存在 → undefined', () => {
    const ok = { node: 'n1', port: 'a' }
    const d = doc([node('n1', 100, 100), { ...node('n9', 0, 0), symbol: 'nope' }], [])
    const bad: SldWire['to'][] = [
      { node: 'ghost', port: 'a' },
      { node: 'n1', port: 'zz' },
      { bus: 'ghost', d: 200 },
      { node: 'n9', port: 'a' },
    ]
    for (const to of bad) {
      expect(wirePoints(d, { id: 'w', from: ok, to }, lookup)).toBeUndefined()
      expect(wirePoints(d, { id: 'w', from: to, to: ok }, lookup)).toBeUndefined()
    }
  })

  it('各种相对位置 / 旋转 / 镜像下,缺省折线始终正交、无重复点、两端对得上端口', () => {
    const rots: SldRotation[] = [0, 90, 180, 270]
    const offsets: Array<[number, number]> = [
      [200, 300],
      [200, -300],
      [-200, 100],
      [60, 10],
      [10, 70],
      [0, 0],
    ]
    for (const r1 of rots)
      for (const r2 of rots)
        for (const flip of [false, true])
          for (const [dx, dy] of offsets)
            for (const [pa, pb] of [
              ['a', 'a'],
              ['b', 'a'],
              ['c', 'b'],
              ['c', 'c'],
            ] as Array<[string, string]>) {
              const n1 = node('n1', 500, 500, r1, flip)
              const n2 = node('n2', 500 + dx, 500 + dy, r2)
              const w: SldWire = { id: 'w', from: { node: 'n1', port: pa }, to: { node: 'n2', port: pb } }
              const pts = wirePoints(doc([n1, n2], [w]), w, lookup)!
              expectOrthogonal(pts)
              expect(pts[0]).toEqual(portPosition(n1, sym, pa))
              expect(pts[pts.length - 1]).toEqual(portPosition(n2, sym, pb))
              expect(pts.length).toBeLessThanOrEqual(6)
            }
  })
})
