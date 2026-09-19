// T5.6 绑定面板对草稿的纯操作
import { describe, expect, it } from 'vitest'
import {
  getSldSymbol,
  registerBuiltinSldSymbols,
  symbolPoint,
  type Binding,
  type SldDoc,
  type SldNode,
} from '@grid/scada-renderer'
import type { SldEditorContent } from '../src/sld-editor/ext'
import type { MetaNode } from '../src/meta/MetaNode'
import {
  addValueLabel,
  attachedValueLabels,
  bindingTarget,
  clearState,
  dropEntity,
  findEntityByName,
  hydrateBinding,
  invertStateMap,
  isPointBound,
  mapAddRow,
  mapRemoveRow,
  mapRenameKey,
  nextLabelPosition,
  removeValueLabel,
  setLabelBinding,
  setNodeEntity,
  setStateBinding,
  setStateMap,
  unboundCount,
  unboundRefs,
  updateValueLabel,
  withDefaultEntity,
  type SldValueLabel,
} from '../src/sld-editor/panels/binding/ops'
import { defaultPoints } from '../src/sld-editor/device-defaults'

registerBuiltinSldSymbols()

const ts = (name: string, key: string, id = ''): Binding => ({ mode: 'ts', entity: { type: 'DEVICE', id, name }, key })

function makeContent(nodes: SldNode[] = []): SldEditorContent {
  const doc: SldDoc = { v: 1, canvas: { w: 800, h: 600, grid: 10 }, nodes, buses: [], wires: [], labels: [] }
  return { doc, bindings: {} }
}

/** 按 store.newId 的口径发号(只增不减,跨 kind 独立) */
function idGen(start: Partial<Record<string, number>> = {}) {
  const c: Record<string, number> = { n: 0, l: 0, p: 0, ...start }
  return (kind: 'n' | 'l' | 'p'): string => `${kind}${(c[kind] = (c[kind] ?? 0) + 1)}`
}

const brk = (extra: Partial<SldNode> = {}): SldNode => ({
  id: 'n1',
  symbol: 'breaker',
  x: 100,
  y: 100,
  rot: 0,
  ...extra,
})

describe('开关状态', () => {
  it('设状态测点:建 state(默认 1 合 0 分)+ 写 pt 绑定', () => {
    const c = makeContent([brk()])
    const gen = idGen()
    setStateBinding(c, 'n1', ts('IED1', 'switch_state'), () => gen('p'))
    expect(c.doc.nodes[0]!.state).toEqual({ pt: 'p1', map: { '1': 'closed', '0': 'open' } })
    expect(c.bindings['pt.p1']).toEqual(ts('IED1', 'switch_state'))
  })

  it('再设一次覆盖同一个 pt;解绑只删绑定,state 与映射保留', () => {
    const c = makeContent([brk()])
    const gen = idGen()
    setStateBinding(c, 'n1', ts('IED1', 'a'), () => gen('p'))
    setStateBinding(c, 'n1', ts('IED1', 'b'), () => gen('p'))
    expect(c.doc.nodes[0]!.state!.pt).toBe('p1')
    expect(c.bindings['pt.p1']).toEqual(ts('IED1', 'b'))
    setStateBinding(c, 'n1', null, () => gen('p'))
    expect(c.bindings['pt.p1']).toBeUndefined()
    expect(c.doc.nodes[0]!.state).toBeDefined()
  })

  it('pt 被别处共用时写时复制:只改这一处', () => {
    const c = makeContent([brk({ state: { pt: 'p1', map: { '1': 'closed' } } }), brk({ id: 'n2', x: 300 })])
    c.doc.nodes[1]!.state = { pt: 'p1', map: { '1': 'closed' } }
    c.bindings['pt.p1'] = ts('A', 'k')
    setStateBinding(c, 'n2', ts('B', 'k'), () => 'p9')
    expect(c.doc.nodes[1]!.state!.pt).toBe('p9')
    expect(c.bindings['pt.p1']).toEqual(ts('A', 'k'))
    expect(c.bindings['pt.p9']).toEqual(ts('B', 'k'))
  })

  it('改映射 / 取反 / 清除状态(清理无人引用的绑定)', () => {
    const c = makeContent([brk({ state: { pt: 'p1', map: { '1': 'closed', '0': 'open' } } })])
    c.bindings['pt.p1'] = ts('A', 'k')
    setStateMap(c, 'n1', invertStateMap(c.doc.nodes[0]!.state!.map))
    expect(c.doc.nodes[0]!.state!.map).toEqual({ '1': 'open', '0': 'closed' })
    clearState(c, 'n1')
    expect(c.doc.nodes[0]!.state).toBeUndefined()
    expect(c.bindings).toEqual({})
  })

  it('键值表的增 / 改键 / 删', () => {
    let m: Record<string, 'open' | 'closed'> = { '1': 'closed', '0': 'open' }
    m = mapAddRow(m, 'open')
    expect(m).toEqual({ '1': 'closed', '0': 'open', '2': 'open' })
    expect(mapRenameKey(m, '2', '1')).toBe(m) // 撞键不改
    expect(mapRenameKey(m, '2', ' ')).toBe(m) // 空键不改
    m = mapRenameKey(m, '2', 'true')
    expect(m).toEqual({ '1': 'closed', '0': 'open', true: 'open' })
    expect(mapRemoveRow(m, '0')).toEqual({ '1': 'closed', true: 'open' })
  })
})

describe('设备', () => {
  it('写 / 清 node.entity,只存类型与名字', () => {
    const c = makeContent([brk()])
    setNodeEntity(c, 'n1', { type: 'DEVICE', name: 'IED1', id: 'x' } as never)
    expect(c.doc.nodes[0]!.entity).toEqual({ type: 'DEVICE', name: 'IED1' })
    setNodeEntity(c, 'n1', null)
    expect(c.doc.nodes[0]!.entity).toBeUndefined()
    expect(setNodeEntity(c, 'nX', null)).toBe(false)
  })

  const tree: MetaNode = {
    id: 'site',
    name: 's',
    kind: 'site',
    children: [
      {
        id: 'gw',
        name: 'GW',
        kind: 'gateway',
        entity: { type: 'DEVICE', id: 'gw', name: 'GW' },
        children: [
          {
            id: 'd1',
            name: 'IED1',
            kind: 'device',
            profile: 'IED',
            entity: { type: 'DEVICE', id: 'd1', name: 'IED1' },
            children: [],
          },
        ],
      },
    ],
  }

  it('树上按名找实体;只有名字的绑定回树上补 id;新绑定默认带出节点设备', () => {
    expect(findEntityByName(tree, 'DEVICE', 'IED1')).toEqual({ type: 'DEVICE', id: 'd1', name: 'IED1', profile: 'IED' })
    expect(findEntityByName(tree, 'ASSET', 'IED1')).toBeUndefined()
    expect(hydrateBinding(ts('IED1', 'P'), tree)).toEqual(ts('IED1', 'P', 'd1'))
    const empty: Binding = { mode: 'ts', entity: { type: 'DEVICE', id: '', name: '' }, key: '' }
    expect(withDefaultEntity(empty, { type: 'DEVICE', name: 'IED1' }, tree)).toEqual(ts('IED1', '', 'd1'))
    expect(withDefaultEntity(empty, { type: 'DEVICE', name: 'NOPE' }, null)).toEqual(ts('NOPE', ''))
    const chosen = ts('OTHER', '', 'o1')
    expect(withDefaultEntity(chosen, { type: 'DEVICE', name: 'IED1' }, tree)).toBe(chosen)
  })
})

describe('数值标签', () => {
  it('按 labelSlots 依次放,占满后往下顺延 20', () => {
    const c = makeContent([brk()])
    const gen = idGen()
    const ids = () => ({ label: gen('l'), pt: gen('p') })
    const sym = getSldSymbol
    const a = addValueLabel(c, 'n1', ids(), sym) as SldValueLabel
    const b = addValueLabel(c, 'n1', ids(), sym) as SldValueLabel
    const d = addValueLabel(c, 'n1', ids(), sym) as SldValueLabel
    const e = addValueLabel(c, 'n1', ids(), sym) as SldValueLabel
    // breaker labelSlots: (50,20) (50,40)
    expect([a, b, d, e].map(l => [l.x, l.y])).toEqual([
      [150, 120],
      [150, 140],
      [150, 160],
      [150, 180],
    ])
    expect(a).toMatchObject({ attach: 'n1', kind: 'value', pt: 'p1' })
    // 删掉中间一个,空出来的位先补
    removeValueLabel(c, a.id)
    const f = addValueLabel(c, 'n1', ids(), sym) as SldValueLabel
    expect([f.x, f.y]).toEqual([150, 120])
  })

  it('rot = 90 + flip 时落点按 symbolPoint 换算', () => {
    const node = brk({ rot: 90, flip: true })
    const c = makeContent([node])
    const def = getSldSymbol('breaker')!
    const s0 = symbolPoint(def, 90, true, 50, 20)
    const s1 = symbolPoint(def, 90, true, 50, 40)
    // 手算:镜像 x → 40 − 50 = −10;转 90:(h − y, fx) = (40, −10) / (20, −10)
    expect([s0, s1]).toEqual([
      { x: 40, y: -10 },
      { x: 20, y: -10 },
    ])
    expect(nextLabelPosition(c.doc, node, def)).toEqual({ x: 140, y: 90 })
    addValueLabel(c, 'n1', { label: 'l1', pt: 'p1' }, getSldSymbol)
    expect(nextLabelPosition(c.doc, node, def)).toEqual({ x: 120, y: 90 })
    addValueLabel(c, 'n1', { label: 'l2', pt: 'p2' }, getSldSymbol)
    expect(nextLabelPosition(c.doc, node, def)).toEqual({ x: 120, y: 110 })
  })

  it('没有 labelSlots 的图元:从包围盒右侧起', () => {
    const node: SldNode = { id: 'n1', symbol: 'junction', x: 100, y: 100, rot: 0 }
    const c = makeContent([node])
    const def = getSldSymbol('junction')!
    const p = nextLabelPosition(c.doc, node, def)
    expect(p.y).toBe(100)
    expect(p.x).toBeGreaterThan(100)
  })

  it('改格式:title / digits / unit / scale / color / map;清空后字段删掉', () => {
    const c = makeContent([brk()])
    addValueLabel(c, 'n1', { label: 'l1', pt: 'p1' }, getSldSymbol)
    updateValueLabel(c, 'l1', { title: 'Ia', digits: 2.4, unit: 'A', scale: 0.001, color: 'a', map: { '0': '停止' } })
    expect(c.doc.labels[0]).toMatchObject({
      title: 'Ia',
      color: 'a',
      format: { digits: 2, unit: 'A', scale: 0.001, map: { '0': '停止' } },
    })
    updateValueLabel(c, 'l1', { title: '', digits: null, unit: '', scale: 1, color: null, map: {} })
    expect(c.doc.labels[0]).not.toHaveProperty('title')
    expect(c.doc.labels[0]).not.toHaveProperty('color')
    expect(c.doc.labels[0]).not.toHaveProperty('format')
  })

  it('删标签:无人引用的绑定一起删,仍被引用的保留', () => {
    const c = makeContent([brk({ state: { pt: 'p1', map: { '1': 'closed' } } })])
    addValueLabel(c, 'n1', { label: 'l1', pt: 'p1' }, getSldSymbol) // 与状态共用 p1
    addValueLabel(c, 'n1', { label: 'l2', pt: 'p2' }, getSldSymbol, { binding: ts('A', 'P') })
    c.bindings['pt.p1'] = ts('A', 'sw')
    removeValueLabel(c, 'l1')
    expect(c.bindings['pt.p1']).toEqual(ts('A', 'sw'))
    removeValueLabel(c, 'l2')
    expect(c.bindings['pt.p2']).toBeUndefined()
    expect(attachedValueLabels(c.doc, 'n1')).toEqual([])
  })

  it('改标签绑定', () => {
    const c = makeContent([brk()])
    addValueLabel(c, 'n1', { label: 'l1', pt: 'p1' }, getSldSymbol)
    setLabelBinding(c, 'l1', ts('A', 'P'), () => 'p2')
    expect(c.bindings['pt.p1']).toEqual(ts('A', 'P'))
  })
})

describe('查询', () => {
  it('未绑定统计与角标', () => {
    const c = makeContent([brk({ state: { pt: 'p1', map: {} } }), brk({ id: 'n2', x: 300 })])
    addValueLabel(c, 'n1', { label: 'l1', pt: 'p2' }, getSldSymbol, { binding: ts('A', 'P') })
    addValueLabel(c, 'n1', { label: 'l2', pt: 'p3' }, getSldSymbol, { binding: ts('A', '') })
    expect(isPointBound(ts('A', ''))).toBe(false)
    expect(isPointBound(ts('A', 'P'))).toBe(true)
    expect(unboundRefs(c).map(r => r.pt)).toEqual(['p1', 'p3'])
    const sel = (x: Partial<{ nodes: string[]; labels: string[] }>) => ({
      nodes: [],
      buses: [],
      wires: [],
      labels: [],
      ...x,
    })
    expect(unboundCount(c, sel({ nodes: ['n1'] }))).toBe(2)
    expect(unboundCount(c, sel({ nodes: ['n2'] }))).toBe(0)
    expect(unboundCount(c, sel({ labels: ['l2'] }))).toBe(1)
    expect(unboundCount(c, sel({ nodes: ['n1', 'n2'] }))).toBe(0)
    expect(bindingTarget(c.doc, sel({ nodes: ['n1', 'n2'] }))).toEqual({ kind: 'none' })
    expect(bindingTarget(c.doc, sel({ labels: ['l1'] }))).toEqual({ kind: 'label', id: 'l1' })
  })
})

describe('拖入设备', () => {
  it('建节点 + entity + name + 默认状态测点与数值标签', () => {
    const c = makeContent([brk({ id: 'n1' })])
    const gen = idGen({ n: 1 })
    const def = getSldSymbol('breaker')!
    const id = dropEntity(
      c,
      {
        entity: { type: 'DEVICE', name: 'PDR1_LP2_IED1' },
        ref: { type: 'DEVICE', id: 'd2', name: 'PDR1_LP2_IED1' },
        symbol: def,
        at: { x: 300, y: 200 },
        points: defaultPoints('breaker', ['switch_state', 'P', 'Q']),
      },
      gen,
      getSldSymbol
    )
    expect(id).toBe('n2')
    const node = c.doc.nodes.find(n => n.id === id)!
    expect(node).toMatchObject({
      symbol: 'breaker',
      x: 300,
      y: 200,
      rot: 0,
      name: 'PDR1_LP2_IED1',
      entity: { type: 'DEVICE', name: 'PDR1_LP2_IED1' },
      state: { pt: 'p1', map: { '1': 'closed', '0': 'open' } },
    })
    expect(c.bindings['pt.p1']).toEqual(ts('PDR1_LP2_IED1', 'switch_state', 'd2'))
    const labels = attachedValueLabels(c.doc, id)
    expect(labels.map(l => [l.title, l.x, l.y, l.format])).toEqual([
      ['P', 350, 220, { digits: 1, unit: 'kW' }],
      ['Q', 350, 240, { digits: 1, unit: 'kvar' }],
    ])
    expect(labels.map(l => c.bindings[`pt.${l.pt}`])).toEqual([
      ts('PDR1_LP2_IED1', 'P', 'd2'),
      ts('PDR1_LP2_IED1', 'Q', 'd2'),
    ])
  })

  it('没有测点信息时只建节点;设备树上没有时绑定只带名字', () => {
    const c = makeContent()
    const id = dropEntity(
      c,
      { entity: { type: 'ASSET', name: '储能系统' }, symbol: getSldSymbol('device-box')!, at: { x: 0, y: 0 } },
      idGen(),
      getSldSymbol
    )
    expect(c.doc.nodes).toHaveLength(1)
    expect(c.doc.nodes[0]).toMatchObject({ id, entity: { type: 'ASSET', name: '储能系统' }, name: '储能系统' })
    expect(c.doc.labels).toEqual([])
    expect(c.bindings).toEqual({})
  })
})
