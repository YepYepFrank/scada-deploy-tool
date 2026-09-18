/**
 * T5.1 连通图与带电计算:ADR-005 验收用例清单 energize 一节逐条对应(it 标题以清单原文开头)。
 * 内置图元:breaker = switch、meter = always、junction = always;电源 / 变压器 / 终端图元在这里自带,经 lookup 注入。
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { energize, buildSldGraph, registerBuiltinSldSymbols, lookupSldSymbol } from '../src/sld'
import type {
  SldBus,
  SldDoc,
  SldNode,
  SldSwitchState,
  SldSymbolDefinition,
  SldSymbolLookup,
  SldWire,
  SldWireEnd,
} from '../src/sld'

beforeAll(() => registerBuiltinSldSymbols())

const custom: Record<string, SldSymbolDefinition> = {
  /** 电网电源:终端图元,一个端口 */
  grid: {
    id: 'grid',
    name: '电网电源',
    category: 'source',
    w: 40,
    h: 40,
    ports: [{ id: 'out', x: 20, y: 40, dir: 's' }],
    conduct: 'none',
    defaultSource: true,
    body: '',
  },
  /** 双绕组变压器 */
  tr: {
    id: 'tr',
    name: '变压器',
    category: 'transformer',
    w: 40,
    h: 80,
    ports: [
      { id: 'hv', x: 20, y: 0, dir: 'n' },
      { id: 'lv', x: 20, y: 80, dir: 's' },
    ],
    conduct: 'transformer',
    body: '',
  },
  /** 负荷:终端图元,一个端口 */
  load: {
    id: 'load',
    name: '负荷',
    category: 'load',
    w: 40,
    h: 40,
    ports: [{ id: 'in', x: 20, y: 0, dir: 'n' }],
    conduct: 'none',
    body: '',
  },
  /** 两个端口但不导通的设备框(conduct = 'none') */
  box: {
    id: 'box',
    name: '设备框',
    category: 'load',
    w: 40,
    h: 40,
    ports: [
      { id: 'a', x: 20, y: 0, dir: 'n' },
      { id: 'b', x: 20, y: 40, dir: 's' },
    ],
    conduct: 'none',
    body: '',
  },
}
const lookup: SldSymbolLookup = id => custom[id] ?? lookupSldSymbol(id)

/* ── 搭图小工具(带电计算不看坐标,一律放原点) ── */
const node = (id: string, symbol: string, extra: Partial<SldNode> = {}): SldNode => ({
  id,
  symbol,
  x: 0,
  y: 0,
  rot: 0,
  ...extra,
})
/** 配了状态来源的断路器 */
const qf = (id: string): SldNode =>
  node(id, 'breaker', { state: { pt: `p-${id}`, map: { '1': 'closed', '0': 'open' } } })
const bus = (id: string, kv?: number): SldBus => ({
  id,
  x1: 0,
  y1: 0,
  x2: 400,
  y2: 0,
  ...(kv === undefined ? {} : { kv }),
})
/** 端点简写:'n1.a' = 节点端口;'bus1@120' = 母线上 d = 120 */
const end = (s: string): SldWireEnd => {
  if (s.includes('@')) {
    const [b, d] = s.split('@')
    return { bus: b!, d: Number(d) }
  }
  const [n, p] = s.split('.')
  return { node: n!, port: p! }
}
const wire = (id: string, from: string, to: string): SldWire => ({ id, from: end(from), to: end(to) })
const doc = (nodes: SldNode[], buses: SldBus[], wires: SldWire[]): SldDoc => ({
  v: 1,
  canvas: { w: 800, h: 600, grid: 10 },
  nodes,
  buses,
  wires,
  labels: [],
})
const run = (d: SldDoc, states: Record<string, SldSwitchState> = {}) => energize(d, lookup, states)

const LIVE10 = { live: true, kv: 10 }
const DEAD = { live: false }

/** 电源 → 断路器 → 母线 → 负荷 */
const feeder = (): SldDoc =>
  doc(
    [node('src', 'grid', { source: { kv: 10 } }), qf('qf1'), node('ld', 'load')],
    [bus('bus1')],
    [wire('w1', 'src.out', 'qf1.a'), wire('w2', 'qf1.b', 'bus1@100'), wire('w3', 'bus1@200', 'ld.in')]
  )

describe('energize', () => {
  it('单电源直馈:合位开关后面全部带电,电压等级取 source.kv', () => {
    expect(run(feeder(), { qf1: 'closed' })).toEqual({
      nodes: { src: LIVE10, qf1: LIVE10, ld: LIVE10 },
      buses: { bus1: LIVE10 },
      wires: { w1: LIVE10, w2: LIVE10, w3: LIVE10 },
    })
  })

  it('分位开关后失电:开关电源侧与开关自身带电,其后全部 { live: false }', () => {
    expect(run(feeder(), { qf1: 'open' })).toEqual({
      nodes: { src: LIVE10, qf1: LIVE10, ld: DEAD },
      buses: { bus1: DEAD },
      wires: { w1: LIVE10, w2: DEAD, w3: DEAD },
    })
  })

  it('unknown 开关后标 uncertain:按断开算(live = false),其后本可带电的部分 uncertain = true', () => {
    const maybe = { live: false, uncertain: true, kv: 10 }
    const expected = {
      nodes: { src: LIVE10, qf1: LIVE10, ld: maybe },
      buses: { bus1: maybe },
      wires: { w1: LIVE10, w2: maybe, w3: maybe },
    }
    expect(run(feeder(), { qf1: 'unknown' })).toEqual(expected)
    // 配了 state 但 states 里没给 → 同 unknown
    expect(run(feeder(), {})).toEqual(expected)
  })

  it('没配 node.state 的开关视为常合', () => {
    const d = feeder()
    delete d.nodes[1]!.state
    expect(run(d, {}).nodes.ld).toEqual(LIVE10)
    // 调用方明确给了状态的,以给的为准
    expect(run(d, { qf1: 'open' }).nodes.ld).toEqual(DEAD)
  })

  /** 两段母线各有进线,中间母联 qfT */
  const twoSources = (): SldDoc =>
    doc(
      [
        node('srcA', 'grid', { source: { kv: 10 } }),
        node('srcB', 'grid', { source: { kv: 10 } }),
        qf('qfA'),
        qf('qfB'),
        qf('qfT'),
        node('ldA', 'load'),
      ],
      [bus('busA'), bus('busB')],
      [
        wire('wa1', 'srcA.out', 'qfA.a'),
        wire('wa2', 'qfA.b', 'busA@100'),
        wire('wb1', 'srcB.out', 'qfB.a'),
        wire('wb2', 'qfB.b', 'busB@100'),
        wire('wt1', 'busA@400', 'qfT.a'),
        wire('wt2', 'qfT.b', 'busB@0'),
        wire('wl', 'busA@200', 'ldA.in'),
      ]
    )

  it('双电源经母联,一侧失电另一侧经母联带电', () => {
    const r = run(twoSources(), { qfA: 'open', qfB: 'closed', qfT: 'closed' })
    expect(r.buses).toEqual({ busA: LIVE10, busB: LIVE10 })
    expect(r.nodes.ldA).toEqual(LIVE10)
    expect(r.wires.wa2).toEqual(LIVE10) // 进线开关负荷侧被母线反送电
    expect(r.wires.wa1).toEqual(LIVE10) // 电源侧本来就有电
    // 母联也分开 → A 段失电
    const r2 = run(twoSources(), { qfA: 'open', qfB: 'closed', qfT: 'open' })
    expect(r2.buses).toEqual({ busA: DEAD, busB: LIVE10 })
    expect(r2.nodes.ldA).toEqual(DEAD)
    expect(r2.nodes.qfT).toEqual(LIVE10) // 母联 B 侧端口带电,图元自身算带电
  })

  it('多电源同时到达:任一路确定带电即 live = true 且不标 uncertain', () => {
    const r = run(twoSources(), { qfA: 'closed', qfB: 'closed', qfT: 'unknown' })
    expect(r.buses).toEqual({ busA: LIVE10, busB: LIVE10 })
    expect(r.nodes.ldA?.uncertain).toBeFalsy()
    expect(r.nodes.ldA).toEqual(LIVE10)
    // 只剩不确定的一路时才标 uncertain
    const r2 = run(twoSources(), { qfA: 'open', qfB: 'closed', qfT: 'unknown' })
    expect(r2.buses.busA).toEqual({ live: false, uncertain: true, kv: 10 })
    expect(r2.buses.busB).toEqual(LIVE10)
  })

  it('变压器两侧电压等级不同:穿过后换成 node.portKv[出口端口]', () => {
    const d = doc(
      [
        node('src', 'grid', { source: { kv: 10 } }),
        node('t1', 'tr', { portKv: { hv: 10, lv: 0.4 } }),
        node('ld', 'load'),
      ],
      [bus('lvbus')],
      [wire('w1', 'src.out', 't1.hv'), wire('w2', 't1.lv', 'lvbus@100'), wire('w3', 'lvbus@200', 'ld.in')]
    )
    const r = run(d)
    expect(r.wires).toEqual({ w1: LIVE10, w2: { live: true, kv: 0.4 }, w3: { live: true, kv: 0.4 } })
    expect(r.buses.lvbus).toEqual({ live: true, kv: 0.4 })
    expect(r.nodes.ld).toEqual({ live: true, kv: 0.4 })
    expect(r.nodes.t1).toEqual(LIVE10) // 变压器节点自身取先到的一侧
    // 没配 portKv:能传,但等级未知
    d.nodes[1] = node('t1', 'tr')
    expect(run(d).nodes.ld).toEqual({ live: true })
  })

  it('母线 kv 覆盖继承值:母线及从它继续往下传的等级以母线为准', () => {
    const d = feeder()
    d.buses[0] = bus('bus1', 35)
    const r = run(d, { qf1: 'closed' })
    expect(r.buses.bus1).toEqual({ live: true, kv: 35 })
    expect(r.nodes.ld).toEqual({ live: true, kv: 35 })
    expect(r.wires.w3).toEqual({ live: true, kv: 35 })
    expect(r.wires.w1).toEqual(LIVE10) // 母线之前的仍是电源的等级
    // 电源没给 kv:母线的等级顺带回填到上游
    d.nodes[0] = node('src', 'grid', { source: {} })
    expect(run(d, { qf1: 'closed' }).nodes.src).toEqual({ live: true, kv: 35 })
  })

  it('环网不死循环:母线 — 开关 — 母线 — 开关 — 回到原母线,外加连接点自环', () => {
    const d = doc(
      [node('src', 'grid', { source: { kv: 10 } }), qf('q1'), qf('q2'), node('j', 'junction'), node('ld', 'load')],
      [bus('busA'), bus('busB')],
      [
        wire('w0', 'src.out', 'busA@0'),
        wire('w1', 'busA@100', 'q1.a'),
        wire('w2', 'q1.b', 'busB@100'),
        wire('w3', 'busB@200', 'q2.a'),
        wire('w4', 'q2.b', 'busA@200'),
        wire('w5', 'busB@300', 'j.n'),
        wire('w6', 'j.s', 'j.e'), // 自环
        wire('w7', 'j.w', 'ld.in'),
      ]
    )
    const r = run(d, { q1: 'closed', q2: 'closed' })
    expect(Object.values(r.nodes).every(e => e.live)).toBe(true)
    expect(Object.values(r.buses).every(e => e.live)).toBe(true)
    expect(Object.values(r.wires).every(e => e.live)).toBe(true)
    // 断开一个开关,另一路仍供电
    expect(run(d, { q1: 'open', q2: 'closed' }).nodes.ld).toEqual(LIVE10)
    expect(run(d, { q1: 'open', q2: 'open' }).nodes.ld).toEqual(DEAD)
  })

  it("conduct = 'none' 的图元自身带电但不向外传", () => {
    const d = doc(
      [node('src', 'grid', { source: { kv: 10 } }), node('bx', 'box'), node('ld', 'load')],
      [],
      [wire('w1', 'src.out', 'bx.a'), wire('w2', 'bx.b', 'ld.in')]
    )
    expect(run(d)).toEqual({
      nodes: { src: LIVE10, bx: LIVE10, ld: DEAD },
      buses: {},
      wires: { w1: LIVE10, w2: DEAD },
    })
  })

  it('无电源全失电:每个元素都有条目', () => {
    const d = feeder()
    delete d.nodes[0]!.source
    expect(run(d, { qf1: 'closed' })).toEqual({
      nodes: { src: DEAD, qf1: DEAD, ld: DEAD },
      buses: { bus1: DEAD },
      wires: { w1: DEAD, w2: DEAD, w3: DEAD },
    })
  })

  it('连线接在母线中段(t,契约修订后为 d)能导通:同一母线上所有接点互通', () => {
    const d = doc(
      [node('src', 'grid', { source: { kv: 10 } }), node('l1', 'load'), node('l2', 'load'), node('m', 'meter')],
      [bus('bus1')],
      [
        wire('w0', 'src.out', 'bus1@130'),
        wire('w1', 'bus1@0', 'l1.in'),
        wire('w2', 'bus1@400', 'm.a'),
        wire('w3', 'm.b', 'l2.in'), // always 图元:串在回路里照传
      ]
    )
    const r = run(d)
    expect(r.nodes).toEqual({ src: LIVE10, l1: LIVE10, l2: LIVE10, m: LIVE10 })
    expect(r.wires).toEqual({ w0: LIVE10, w1: LIVE10, w2: LIVE10, w3: LIVE10 })
  })

  it('孤立元素失电:没接线的节点 / 母线、两端都悬空的连线', () => {
    const d = feeder()
    d.nodes.push(node('alone', 'meter'), node('mystery', 'no-such-symbol'))
    d.buses.push(bus('idle'))
    d.wires.push(wire('ghost', 'nobody.a', 'nobus@0'), wire('half', 'bus1@300', 'nobody.a'))
    const r = run(d, { qf1: 'closed' })
    expect(r.nodes.alone).toEqual(DEAD)
    expect(r.nodes.mystery).toEqual(DEAD)
    expect(r.buses.idle).toEqual(DEAD)
    expect(r.wires.ghost).toEqual(DEAD)
    // 一端悬空、另一端接在带电母线上的线:线本身带电
    expect(r.wires.half).toEqual(LIVE10)
  })

  it('未知图元的节点:连线接上来自身算带电,但不向外传', () => {
    const d = doc(
      [node('src', 'grid', { source: { kv: 10 } }), node('x', 'no-such-symbol'), node('ld', 'load')],
      [],
      [wire('w1', 'src.out', 'x.a'), wire('w2', 'x.b', 'ld.in')]
    )
    const r = run(d)
    expect(r.nodes.x).toEqual(LIVE10)
    expect(r.nodes.ld).toEqual(DEAD)
  })
})

describe('buildSldGraph', () => {
  it('顶点 = 节点端口 + 母线;边 = 连线 + 图元内部端口对(none 的图元没有内部边)', () => {
    const g = buildSldGraph(feeder(), lookup)
    expect(g.vertices).toEqual([
      { kind: 'port', node: 'src', port: 'out' },
      { kind: 'port', node: 'qf1', port: 'a' },
      { kind: 'port', node: 'qf1', port: 'b' },
      { kind: 'port', node: 'ld', port: 'in' },
      { kind: 'bus', bus: 'bus1' },
    ])
    expect(g.edges).toEqual([
      { a: 1, b: 2, kind: 'node', node: 'qf1', conduct: 'switch' },
      { a: 0, b: 1, kind: 'wire', wire: 'w1' },
      { a: 2, b: 4, kind: 'wire', wire: 'w2' },
      { a: 4, b: 3, kind: 'wire', wire: 'w3' },
    ])
    expect(g.adjacency[4]).toEqual([2, 3]) // 母线一个顶点,两条接线都挂在它上面
    expect(g.nodePorts.get('qf1')).toEqual([1, 2])
    expect(g.busVertex.get('bus1')).toBe(4)
    expect(g.wireEnds.get('w2')).toEqual([2, 4])
  })
})
