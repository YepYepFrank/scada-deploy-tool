/** T5.1 接线图结构校验:ADR-005 验收用例清单 validateSldDoc 一节逐条对应(it 标题以清单原文开头)。 */
import { describe, it, expect, beforeAll } from 'vitest'
import { validateSldDoc, registerBuiltinSldSymbols, lookupSldSymbol } from '../src/sld'
import type { SldDoc, SldIssue } from '../src/sld'

beforeAll(() => registerBuiltinSldSymbols())

/** 一张没毛病的图:电源侧电表(标 source)→ 断路器 → 母线,带两个标签与一个分组框 */
const good = (): SldDoc => ({
  v: 1,
  canvas: { w: 800, h: 600, grid: 10 },
  nodes: [
    { id: 'src', symbol: 'meter', x: 100, y: 0, rot: 0, source: { kv: 10 } },
    {
      id: 'qf1',
      symbol: 'breaker',
      x: 100,
      y: 60,
      rot: 0,
      state: { pt: 'p-qf1', map: { '1': 'closed', '0': 'open' } },
    },
  ],
  buses: [{ id: 'bus1', x1: 0, y1: 200, x2: 400, y2: 200 }],
  wires: [
    { id: 'w1', from: { node: 'src', port: 'b' }, to: { node: 'qf1', port: 'a' } },
    { id: 'w2', from: { node: 'qf1', port: 'b' }, to: { bus: 'bus1', d: 120 }, vertices: [[120, 150]] },
  ],
  labels: [
    { id: 'l1', x: 160, y: 80, kind: 'text', text: '1# 进线' },
    { id: 'l2', x: 160, y: 100, kind: 'value', pt: 'p-kw', attach: 'qf1', title: 'P' },
  ],
  frames: [{ id: 'f1', x: 80, y: 0, w: 120, h: 180, title: 'LP1' }],
})

const run = (doc: unknown): SldIssue[] => validateSldDoc(doc, lookupSldSymbol)
const codes = (doc: unknown): string[] => run(doc).map(i => i.code)
const find = (doc: unknown, code: SldIssue['code']): SldIssue[] => run(doc).filter(i => i.code === code)

describe('validateSldDoc', () => {
  it('没毛病的图 → 没有任何 issue', () => {
    expect(run(good())).toEqual([])
  })

  it('空白新图不报 no-source', () => {
    expect(run({ v: 1, canvas: { w: 1600, h: 900, grid: 10 }, nodes: [], buses: [], wires: [], labels: [] })).toEqual(
      []
    )
  })

  it('id 不合字符集 → bad-id(节点 / 母线 / 连线 / 标签 / 分组框 / 测点 id 都查)', () => {
    const doc = good()
    doc.nodes[1]!.id = 'qf/1'
    doc.buses[0]!.id = 'bus.1'
    doc.wires[0]!.id = ''
    doc.labels[0]!.id = '标签1'
    doc.frames![0]!.id = 'f 1'
    doc.nodes[0]!.state = { pt: 'p.bad', map: {} }
    const label = doc.labels[1]!
    if (label.kind === 'value') label.pt = 'a/b'
    const bad = find(doc, 'bad-id')
    expect(bad.map(i => i.path)).toEqual([
      'nodes/src/state/pt',
      'nodes/qf/1',
      'buses/bus.1',
      'wires/#0',
      'labels/标签1',
      'labels/l2/pt',
      'frames/f 1',
    ])
    expect(bad.every(i => i.level === 'error')).toBe(true)
  })

  it('重复 id(跨节点、母线、连线、标签)→ duplicate-id;frames 的 id 也参与', () => {
    const doc = good()
    doc.buses[0]!.id = 'src' // 母线撞节点
    doc.wires[1]!.id = 'w1' // 连线撞连线
    doc.labels[0]!.id = 'qf1' // 标签撞节点
    doc.frames![0]!.id = 'l2' // 分组框撞标签
    const dup = find(doc, 'duplicate-id')
    expect(dup.map(i => i.path)).toEqual(['buses/src', 'wires/w1', 'labels/qf1', 'frames/l2'])
    expect(dup[0]!.level).toBe('error')
    expect(dup[0]!.message).toContain('nodes/src')
  })

  it('未知图元 → unknown-symbol', () => {
    const doc = good()
    doc.nodes[1]!.symbol = 'no-such-symbol'
    expect(find(doc, 'unknown-symbol')).toMatchObject([{ level: 'error', path: 'nodes/qf1/symbol' }])
    // 图元未知时端口无从查起,不连带报 unknown-port
    expect(codes(doc)).not.toContain('unknown-port')
  })

  it('未知端口 → unknown-port', () => {
    const doc = good()
    doc.wires[0]!.to = { node: 'qf1', port: 'zz' }
    expect(find(doc, 'unknown-port')).toMatchObject([{ level: 'error', path: 'wires/w1/to' }])
  })

  it('悬空线(端点引用不存在)→ dangling-wire:节点不存在 / 母线不存在 / 端点形状不对', () => {
    const doc = good()
    doc.wires[0]!.from = { node: 'ghost', port: 'a' }
    doc.wires[1]!.to = { bus: 'ghost-bus', d: 0 }
    doc.wires.push({ id: 'w3', from: {} as never, to: { node: 'qf1', port: 'b' } })
    expect(find(doc, 'dangling-wire').map(i => [i.level, i.path])).toEqual([
      ['error', 'wires/w1/from'],
      ['error', 'wires/w2/to'],
      ['error', 'wires/w3/from'],
    ])
  })

  it('不落栅格(warning)→ off-grid:节点坐标 / 母线端点 / 连线拐点;标签自由摆放不报', () => {
    const doc = good()
    doc.nodes[0]!.x = 105
    doc.buses[0]!.x2 = 403
    doc.wires[1]!.vertices = [[120, 155]]
    doc.labels[0]!.x = 163
    expect(find(doc, 'off-grid').map(i => [i.level, i.path])).toEqual([
      ['warning', 'nodes/src'],
      ['warning', 'buses/bus1'],
      ['warning', 'wires/w2/vertices'],
    ])
  })

  it('母线非水平垂直 → bus-not-axis-aligned', () => {
    const doc = good()
    doc.buses[0]!.y2 = 300
    expect(find(doc, 'bus-not-axis-aligned')).toMatchObject([{ level: 'error', path: 'buses/bus1' }])
  })

  it("conduct = 'switch' 的节点没有 state(warning,视为常合)→ missing-state", () => {
    const doc = good()
    delete doc.nodes[1]!.state
    expect(find(doc, 'missing-state')).toMatchObject([{ level: 'warning', path: 'nodes/qf1/state' }])
    // 非开关图元(meter)没有 state 不报
    expect(find(good(), 'missing-state')).toEqual([])
  })

  it('标签 attach 指向不存在的节点 → unknown-point-owner', () => {
    const doc = good()
    doc.labels[1]!.attach = 'ghost'
    doc.labels[0]!.attach = 'bus1' // 母线不是节点,也算
    expect(find(doc, 'unknown-point-owner').map(i => [i.level, i.path])).toEqual([
      ['error', 'labels/l1/attach'],
      ['error', 'labels/l2/attach'],
    ])
  })

  it('无电源点(warning)→ no-source', () => {
    const doc = good()
    delete doc.nodes[0]!.source
    expect(find(doc, 'no-source')).toMatchObject([{ level: 'warning' }])
  })

  it('版本不对 → 只返回一条 bad-version,不抛异常(v 不是 1 / 不是对象 / null / 数组)', () => {
    for (const raw of [{ ...good(), v: 2 }, { nodes: [] }, null, undefined, 42, 'doc', []]) {
      const issues = run(raw)
      expect(issues).toHaveLength(1)
      expect(issues[0]).toMatchObject({ level: 'error', code: 'bad-version' })
    }
  })

  it('canvas.grid ≠ 10 → bad-grid', () => {
    const doc = good()
    doc.canvas.grid = 20
    expect(find(doc, 'bad-grid')).toMatchObject([{ level: 'error', path: 'canvas/grid' }])
    expect(codes({ ...good(), canvas: undefined })).toContain('bad-grid')
  })

  it('母线端 d 不在 [0, 母线长] 或不是 10 的整数倍 → bus-end-out-of-range', () => {
    const ends = (d: unknown): SldIssue[] => {
      const doc = good()
      doc.wires[1]!.to = { bus: 'bus1', d: d as number }
      return find(doc, 'bus-end-out-of-range')
    }
    for (const d of [0, 10, 400]) expect(ends(d)).toEqual([])
    for (const d of [-10, 410, 125, 0.5, NaN, '120', undefined])
      expect(ends(d)).toMatchObject([{ level: 'error', path: 'wires/w2/to' }])
  })

  it('数组缺失 / 元素不是对象也不抛异常', () => {
    expect(() => run({ v: 1, canvas: { grid: 10 } })).not.toThrow()
    expect(run({ v: 1, canvas: { grid: 10 } })).toEqual([])
    const issues = run({ v: 1, canvas: { grid: 10 }, nodes: [null, 3], buses: 'x', wires: [{}], labels: [[]] })
    expect(issues.filter(i => i.code === 'bad-id').map(i => i.path)).toEqual([
      'nodes/#0',
      'nodes/#1',
      'wires/#0',
      'labels/#0',
    ])
  })
})
