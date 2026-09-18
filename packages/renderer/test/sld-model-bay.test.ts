/** T5.1 复制间隔与改名规律:ADR-005 验收用例清单 duplicateBay / incrementName 两节逐条对应(it 标题以清单原文开头)。 */
import { describe, it, expect, beforeAll } from 'vitest'
import { duplicateBay, incrementName, validateSldDoc, registerBuiltinSldSymbols, lookupSldSymbol } from '../src/sld'
import type { DuplicateBayOptions, SldDoc, SldSelection } from '../src/sld'
import type { Binding } from '../src/schema'

beforeAll(() => registerBuiltinSldSymbols())

/**
 * 一条水平母线(长 400)下挂一个出线间隔:母线 → 断路器 qf → 电表 m;
 * 断路器状态 p-qf、电表两个数值标签 p-kw / p-ia(其中 lb-ia 不在选择集里,靠 attach 跟随)。
 */
const baseDoc = (): SldDoc => ({
  v: 1,
  canvas: { w: 800, h: 600, grid: 10 },
  nodes: [
    { id: 'src', symbol: 'meter', x: 0, y: 0, rot: 0, source: { kv: 0.4 } },
    {
      id: 'qf',
      symbol: 'breaker',
      x: 80,
      y: 120,
      rot: 0,
      name: '1# 出线柜 LP1',
      entity: { type: 'DEVICE', name: 'PDR1_LP1_IED1' },
      state: { pt: 'p-qf', map: { '1': 'closed', '0': 'open' } },
    },
    { id: 'm', symbol: 'meter', x: 80, y: 200, rot: 0, entity: { type: 'DEVICE', name: 'PDR1_LP1_IED1' } },
  ],
  buses: [{ id: 'bus1', x1: 0, y1: 100, x2: 400, y2: 100, kv: 0.4 }],
  wires: [
    { id: 'w-src', from: { node: 'src', port: 'b' }, to: { bus: 'bus1', d: 20 } },
    { id: 'w-bus', from: { bus: 'bus1', d: 100 }, to: { node: 'qf', port: 'a' } },
    { id: 'w-in', from: { node: 'qf', port: 'b' }, to: { node: 'm', port: 'a' }, vertices: [[100, 190]] },
  ],
  labels: [
    { id: 'lb-name', x: 130, y: 140, kind: 'text', text: '1# 出线', attach: 'qf' },
    {
      id: 'lb-kw',
      x: 130,
      y: 210,
      kind: 'value',
      pt: 'p-kw',
      attach: 'm',
      title: 'P',
      format: { digits: 1, unit: 'kW' },
    },
    { id: 'lb-ia', x: 130, y: 230, kind: 'value', pt: 'p-ia', attach: 'm', title: 'Ia', color: 'a' },
    { id: 'lb-free', x: 10, y: 10, kind: 'text', text: '0.4 kV 配电' },
  ],
  frames: [{ id: 'fr', x: 60, y: 110, w: 140, h: 150, title: 'LP1' }],
})

const LP1 = { type: 'DEVICE', id: 'uuid-lp1', name: 'PDR1_LP1_IED1' } as const
const baseBindings = (): Record<string, Binding | Binding[]> => ({
  'pt.p-qf': { mode: 'ts', entity: { ...LP1 }, key: 'sw' },
  'pt.p-kw': { mode: 'ts', entity: { ...LP1 }, key: 'P' },
  'pt.p-ia': { mode: 'ext', source: 'kz', params: { entity: { ...LP1 }, keys: ['Ia'] } },
  alarms: { mode: 'alarm', entity: { type: 'ASSET', id: 'uuid-site', name: '站点' } },
})

const bay: SldSelection = {
  nodes: ['qf', 'm'],
  buses: [],
  wires: ['w-bus', 'w-in'],
  labels: ['lb-name', 'lb-kw'],
  frames: ['fr'],
}
const opts = (over: Partial<DuplicateBayOptions> = {}): DuplicateBayOptions => ({
  count: 2,
  dx: 120,
  dy: 0,
  rename: (name, i) => incrementName(name, i, 1), // PDR1_LP<n>_IED1 的 LP 段
  ...over,
})
const dup = (over: Partial<DuplicateBayOptions> = {}, selection: SldSelection = bay) =>
  duplicateBay(baseDoc(), baseBindings(), selection, opts(over))

describe('duplicateBay', () => {
  it('节点 / 连线 / 标签整体复制且新 id 唯一(分组框、attach 在选中节点上的标签一并复制)', () => {
    const r = dup()
    expect(r.created).toEqual([
      {
        nodes: ['qf_1', 'm_1'],
        buses: [],
        wires: ['w-bus_1', 'w-in_1'],
        labels: ['lb-name_1', 'lb-kw_1', 'lb-ia_1'],
        frames: ['fr_1'],
      },
      {
        nodes: ['qf_2', 'm_2'],
        buses: [],
        wires: ['w-bus_2', 'w-in_2'],
        labels: ['lb-name_2', 'lb-kw_2', 'lb-ia_2'],
        frames: ['fr_2'],
      },
    ])
    expect(r.doc.nodes).toHaveLength(3 + 4)
    expect(r.doc.wires).toHaveLength(3 + 4)
    expect(r.doc.labels).toHaveLength(4 + 6)
    expect(r.doc.frames).toHaveLength(1 + 2)
    // 原件在前、位置不变;第 i 份位移 (dx × i, dy × i)
    expect(r.doc.nodes.slice(0, 3)).toEqual(baseDoc().nodes)
    expect(r.doc.nodes.find(n => n.id === 'qf_2')).toMatchObject({ x: 80 + 240, y: 120, symbol: 'breaker', rot: 0 })
    expect(r.doc.wires.find(w => w.id === 'w-in_2')!.vertices).toEqual([[100 + 240, 190]])
    expect(r.doc.labels.find(l => l.id === 'lb-kw_1')).toMatchObject({
      x: 130 + 120,
      y: 210,
      attach: 'm_1',
      title: 'P',
    })
    expect(r.doc.frames!.find(f => f.id === 'fr_1')).toEqual({
      id: 'fr_1',
      x: 60 + 120,
      y: 110,
      w: 140,
      h: 150,
      title: 'LP1',
    })
    // 全图 id 唯一、结构校验无 error
    const ids = [r.doc.nodes, r.doc.buses, r.doc.wires, r.doc.labels, r.doc.frames!].flat().map(x => x.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(validateSldDoc(r.doc, lookupSldSymbol).filter(i => i.level === 'error')).toEqual([])
  })

  it('新 id 唯一:「原 id + _ + 份号」已被占用时继续加后缀', () => {
    const doc = baseDoc()
    doc.labels.push({ id: 'qf_1', x: 0, y: 0, kind: 'text', text: '占位' }) // 跨类型也算占用
    doc.nodes.push({ id: 'm_1', symbol: 'meter', x: 300, y: 300, rot: 0, state: { pt: 'p-qf_1', map: {} } })
    const r = duplicateBay(
      doc,
      { ...baseBindings(), 'pt.p-kw_1': { mode: 'const', value: 0 } },
      bay,
      opts({ count: 1 })
    )
    expect(r.created[0]!.nodes).toEqual(['qf_1_1', 'm_1_1'])
    // pt 也一样:p-qf_1 被图里引用、p-kw_1 已有绑定,都要避开
    expect(r.doc.nodes.find(n => n.id === 'qf_1_1')!.state!.pt).toBe('p-qf_1_1')
    expect(Object.keys(r.bindings).sort()).toEqual(['pt.p-ia_1', 'pt.p-kw_1_1', 'pt.p-qf_1_1'])
  })

  it('接母线的连线按位移换算 t 并夹取(契约修订后为 d):水平母线取 dx,越界夹到母线长', () => {
    const r = dup({ count: 3 })
    const busEnd = (id: string) => r.doc.wires.find(w => w.id === id)!.from
    expect(busEnd('w-bus_1')).toEqual({ bus: 'bus1', d: 220 })
    expect(busEnd('w-bus_2')).toEqual({ bus: 'bus1', d: 340 })
    expect(busEnd('w-bus_3')).toEqual({ bus: 'bus1', d: 400 }) // 100 + 360 = 460 > 400 → 夹到 400
    // 反方向夹到 0;垂直于母线的位移不影响 d
    expect(dup({ count: 1, dx: -150 }).doc.wires.find(w => w.id === 'w-bus_1')!.from).toEqual({ bus: 'bus1', d: 0 })
    expect(dup({ count: 1, dx: 0, dy: 200 }).doc.wires.find(w => w.id === 'w-bus_1')!.from).toEqual({
      bus: 'bus1',
      d: 100,
    })
  })

  it('接母线的连线按位移换算:垂直母线 + 纵向排列取 dy', () => {
    const doc = baseDoc()
    doc.buses[0] = { id: 'bus1', x1: 50, y1: 0, x2: 50, y2: 300 }
    const r = duplicateBay(doc, {}, bay, opts({ count: 3, dx: 0, dy: 90 }))
    const d = (id: string) => r.doc.wires.find(w => w.id === id)!.from
    expect(d('w-bus_1')).toEqual({ bus: 'bus1', d: 190 })
    expect(d('w-bus_2')).toEqual({ bus: 'bus1', d: 280 })
    expect(d('w-bus_3')).toEqual({ bus: 'bus1', d: 300 })
    expect(r.doc.nodes.find(n => n.id === 'qf_2')).toMatchObject({ x: 80, y: 120 + 180 })
  })

  it('选择集里带母线时母线也复制位移,接在它上面的新连线改接新母线、d 不变', () => {
    const r = dup({ count: 1, dx: 0, dy: 300 }, { ...bay, buses: ['bus1'] })
    expect(r.created[0]!.buses).toEqual(['bus1_1'])
    expect(r.doc.buses.find(b => b.id === 'bus1_1')).toEqual({
      id: 'bus1_1',
      x1: 0,
      y1: 400,
      x2: 400,
      y2: 400,
      kv: 0.4,
    })
    expect(r.doc.wires.find(w => w.id === 'w-bus_1')!.from).toEqual({ bus: 'bus1_1', d: 100 })
  })

  it('pt 重新编号且绑定同步复制(同一份里同一个旧 pt 只对应一个新 pt;没有绑定的 pt 只改引用)', () => {
    const doc = baseDoc()
    // 再加一个与断路器共用 p-qf 的标签、一个没有绑定的测点
    doc.labels.push({ id: 'lb-sw', x: 130, y: 160, kind: 'value', pt: 'p-qf', attach: 'qf' })
    doc.labels.push({ id: 'lb-nobind', x: 130, y: 250, kind: 'value', pt: 'p-none', attach: 'm' })
    const r = duplicateBay(doc, baseBindings(), bay, opts())
    const pt = (id: string) => {
      const l = r.doc.labels.find(x => x.id === id)!
      return l.kind === 'value' ? l.pt : undefined
    }
    expect(r.doc.nodes.find(n => n.id === 'qf_2')!.state).toEqual({ pt: 'p-qf_2', map: { '1': 'closed', '0': 'open' } })
    expect(pt('lb-sw_2')).toBe('p-qf_2')
    expect(pt('lb-kw_1')).toBe('p-kw_1')
    expect(pt('lb-ia_2')).toBe('p-ia_2')
    expect(pt('lb-nobind_1')).toBe('p-none_1')
    // 只新增 pt.* 的绑定;alarms 之类的静态槽位不复制,没绑定的 p-none 不造绑定
    expect(Object.keys(r.bindings).sort()).toEqual([
      'pt.p-ia_1',
      'pt.p-ia_2',
      'pt.p-kw_1',
      'pt.p-kw_2',
      'pt.p-qf_1',
      'pt.p-qf_2',
    ])
    expect(r.bindings['pt.p-kw_2']).toMatchObject({ mode: 'ts', key: 'P' })
  })

  it('rename 作用到 node.name、node.entity.name、绑定的 entity.name,entity.id 置空(ext 绑定的实体在 params.entity)', () => {
    const r = dup({ rename: (name, i) => incrementName(name, i, name.startsWith('PDR') ? 1 : 0) })
    const qf2 = r.doc.nodes.find(n => n.id === 'qf_2')!
    expect(qf2.name).toBe('3# 出线柜 LP1') // 显示名第 0 段数字 +2
    expect(qf2.entity).toEqual({ type: 'DEVICE', name: 'PDR1_LP3_IED1' })
    expect(r.doc.nodes.find(n => n.id === 'm_1')!.entity).toEqual({ type: 'DEVICE', name: 'PDR1_LP2_IED1' })
    expect(r.doc.nodes.find(n => n.id === 'm_1')!.name).toBeUndefined() // 原来没有 name 的不凭空造
    expect(r.bindings['pt.p-qf_1']).toEqual({
      mode: 'ts',
      entity: { type: 'DEVICE', id: '', name: 'PDR1_LP2_IED1' },
      key: 'sw',
    })
    expect(r.bindings['pt.p-kw_2']).toEqual({
      mode: 'ts',
      entity: { type: 'DEVICE', id: '', name: 'PDR1_LP3_IED1' },
      key: 'P',
    })
    expect(r.bindings['pt.p-ia_2']).toEqual({
      mode: 'ext',
      source: 'kz',
      params: { entity: { type: 'DEVICE', id: '', name: 'PDR1_LP3_IED1' }, keys: ['Ia'] },
    })
    // 标签文字、分组框标题不走 rename
    expect(r.doc.labels.find(l => l.id === 'lb-name_1')).toMatchObject({ text: '1# 出线' })
  })

  it('绑定写成数组的取第一项;const 绑定原样复制', () => {
    const bindings: Record<string, Binding | Binding[]> = {
      'pt.p-qf': [{ mode: 'ts', entity: { ...LP1 }, key: 'sw' }],
      'pt.p-kw': { mode: 'const', value: 12.5 },
    }
    const r = duplicateBay(baseDoc(), bindings, bay, opts({ count: 1 }))
    expect(r.bindings).toEqual({
      'pt.p-qf_1': { mode: 'ts', entity: { type: 'DEVICE', id: '', name: 'PDR1_LP2_IED1' }, key: 'sw' },
      'pt.p-kw_1': { mode: 'const', value: 12.5 },
    })
  })

  it('选择集内部连线两端都指向新节点;另一端在选择集外的节点则仍接原节点', () => {
    const r = dup()
    expect(r.doc.wires.find(w => w.id === 'w-in_1')).toMatchObject({
      from: { node: 'qf_1', port: 'b' },
      to: { node: 'm_1', port: 'a' },
    })
    expect(r.doc.wires.find(w => w.id === 'w-in_2')).toMatchObject({
      from: { node: 'qf_2', port: 'b' },
      to: { node: 'm_2', port: 'a' },
    })
    // 只选 m 和进它的线:qf 在选择集外,新线的 from 仍是 qf
    const r2 = dup({ count: 1 }, { nodes: ['m'], buses: [], wires: ['w-in'], labels: [] })
    expect(r2.doc.wires.find(w => w.id === 'w-in_1')).toMatchObject({
      from: { node: 'qf', port: 'b' },
      to: { node: 'm_1', port: 'a' },
    })
  })

  it('输入不被修改(doc / bindings / selection 深比较不变,结果与输入不共享对象)', () => {
    const doc = baseDoc()
    const bindings = baseBindings()
    const selection: SldSelection = JSON.parse(JSON.stringify(bay))
    const r = duplicateBay(doc, bindings, selection, opts())
    expect(doc).toEqual(baseDoc())
    expect(bindings).toEqual(baseBindings())
    expect(selection).toEqual(bay)
    expect(r.doc).not.toBe(doc)
    expect(r.doc.nodes[1]).not.toBe(doc.nodes[1])
    // 改结果不会连带改到输入
    r.doc.nodes[1]!.entity!.name = '改了'
    r.doc.nodes.find(n => n.id === 'qf_1')!.state!.map['2'] = 'open'
    expect(doc).toEqual(baseDoc())
  })

  it('count = 0 原样返回(负数 / NaN 同)', () => {
    for (const count of [0, -1, NaN]) {
      const r = dup({ count })
      expect(r.doc).toEqual(baseDoc())
      expect(r.bindings).toEqual({})
      expect(r.created).toEqual([])
    }
  })

  it('旧图没有 frames 字段时不凭空补;selection 里不存在的 id 忽略', () => {
    const doc = baseDoc()
    delete doc.frames
    const r = duplicateBay(
      doc,
      {},
      { nodes: ['qf', 'ghost'], buses: ['nobus'], wires: [], labels: ['nolabel'] },
      opts({ count: 1 })
    )
    expect('frames' in r.doc).toBe(false)
    expect(r.created).toEqual([{ nodes: ['qf_1'], buses: [], wires: [], labels: ['lb-name_1'], frames: [] }])
  })
})

describe('incrementName', () => {
  it('`PDR1_LP1_IED1` 末段 +1', () => {
    expect(incrementName('PDR1_LP1_IED1', 1)).toBe('PDR1_LP1_IED2')
    expect(incrementName('PDR1_LP1_IED1', 3)).toBe('PDR1_LP1_IED4')
    expect(incrementName('PDR1_LP1_IED1', 0)).toBe('PDR1_LP1_IED1')
  })

  it('指定段:从左数第几串数字(0 起),负数从右数', () => {
    expect(incrementName('PDR1_LP1_IED1', 2, 0)).toBe('PDR3_LP1_IED1')
    expect(incrementName('PDR1_LP1_IED1', 2, 1)).toBe('PDR1_LP3_IED1')
    expect(incrementName('PDR1_LP1_IED1', 2, 2)).toBe('PDR1_LP1_IED3')
    expect(incrementName('PDR1_LP1_IED1', 2, -2)).toBe('PDR1_LP3_IED1')
    // 越界原样返回
    expect(incrementName('PDR1_LP1_IED1', 2, 3)).toBe('PDR1_LP1_IED1')
    expect(incrementName('PDR1_LP1_IED1', 2, -4)).toBe('PDR1_LP1_IED1')
  })

  it('无数字原样返回', () => {
    expect(incrementName('进线柜', 1)).toBe('进线柜')
    expect(incrementName('', 1)).toBe('')
  })

  it('补零宽度保持(`LP01` → `LP02`),进位超宽自然变长', () => {
    expect(incrementName('LP01', 1)).toBe('LP02')
    expect(incrementName('LP09', 1)).toBe('LP10')
    expect(incrementName('LP099_A', 1)).toBe('LP100_A')
    expect(incrementName('LP99', 1)).toBe('LP100')
    expect(incrementName('1# 出线柜', 9)).toBe('10# 出线柜')
  })
})
