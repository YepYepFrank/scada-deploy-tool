/**
 * 2026-09-20 的四项增补在编辑器一侧的改写:节点大小、母线粗细 / 颜色、文字样式(属性面板 ops),
 * 在线状态灯 / 状态标签(绑定面板 ops),母线端头补齐(x6-adapter.busAttrs)。
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { getSldSymbol, portPosition, registerBuiltins, sldPointSlot, type SldDoc } from '@grid/scada-renderer'
import type { SldEditorContent } from '../src/sld-editor/ext'
import { setBusColor, setBusWidth, setLabelStyle, setNodeScale } from '../src/sld-editor/panels/inspector/ops'
import {
  ONLINE_ATTR_KEY,
  bindingTarget,
  enableOnlineForNodes,
  setNodeOnline,
  setOnlineCorner,
  unboundRefs,
} from '../src/sld-editor/panels/binding/ops'
import { busAttrs, busToCell, labelToCell, LABEL_FILL, nodeToCell } from '../src/sld-editor/x6-adapter'

beforeAll(() => registerBuiltins())

const doc = (): SldDoc => ({
  v: 1,
  canvas: { w: 800, h: 600, grid: 10 },
  nodes: [
    { id: 'n1', symbol: 'breaker', x: 100, y: 100, rot: 0, entity: { type: 'DEVICE', name: 'QF1' } },
    { id: 'n2', symbol: 'meter', x: 200, y: 100, rot: 0, entity: { type: 'DEVICE', name: 'M1' } },
    { id: 'n3', symbol: 'meter', x: 300, y: 100, rot: 0 },
  ],
  buses: [{ id: 'b1', x1: 0, y1: 50, x2: 400, y2: 50 }],
  wires: [],
  labels: [{ id: 'l1', x: 10, y: 10, kind: 'text', text: '10kV I 段' }],
})
const content = (): SldEditorContent => ({ doc: doc(), bindings: {} })
const ids = () => {
  let i = 0
  return () => `p${++i}`
}

describe('节点大小', () => {
  it('合法倍数写进去,回到 1 就删字段;不合法的倍数拒绝', () => {
    const d = doc()
    expect(setNodeScale(d, 'n1', 2, getSldSymbol)).toBe(true)
    expect(d.nodes[0]!.scale).toBe(2)
    expect(setNodeScale(d, 'n1', 1.37, getSldSymbol)).toBe(false)
    expect(setNodeScale(d, 'n1', 1, getSldSymbol)).toBe(true)
    expect('scale' in d.nodes[0]!).toBe(false)
  })
  it('以包围盒中心为准放大:中轴线上的端口横向不挪,出线还是直的', () => {
    const d = doc()
    const def = getSldSymbol('breaker')!
    const top = def.ports.find(p => p.x === def.w / 2)!
    const before = portPosition(d.nodes[0]!, def, top.id)!
    setNodeScale(d, 'n1', 2, getSldSymbol)
    expect(portPosition(d.nodes[0]!, def, top.id)!.x).toBe(before.x)
    expect(d.nodes[0]!.x % 10).toBe(0)
    expect(d.nodes[0]!.y % 10).toBe(0)
  })
  it('画布上的节点盒子与端口跟着变大', () => {
    const d = doc()
    const before = nodeToCell(d.nodes[0]!)
    setNodeScale(d, 'n1', 2, getSldSymbol)
    const after = nodeToCell(d.nodes[0]!)
    expect(after.width).toBe(before.width * 2)
    expect(after.height).toBe(before.height * 2)
    expect(after.ports.items[1]!.args).toEqual({
      x: before.ports.items[1]!.args.x * 2,
      y: before.ports.items[1]!.args.y * 2,
    })
  })
})

describe('母线粗细 / 颜色', () => {
  it('缺省值(4)不落进 JSON;越界拒绝', () => {
    const d = doc()
    expect(setBusWidth(d, 'b1', 8)).toBe(true)
    expect(d.buses[0]!.width).toBe(8)
    expect(setBusWidth(d, 'b1', 99)).toBe(false)
    expect(setBusWidth(d, 'b1', 4)).toBe(true)
    expect('width' in d.buses[0]!).toBe(false)
  })
  it('颜色只认 #hex;给 undefined 恢复按电压等级', () => {
    const d = doc()
    expect(setBusColor(d, 'b1', 'red; drop table')).toBe(false)
    expect(setBusColor(d, 'b1', '#ff8800')).toBe(true)
    expect(setBusColor(d, 'b1', undefined)).toBe(true)
    expect('color' in d.buses[0]!).toBe(false)
  })
  it('画布:线体两头各多画半个线宽(横竖母线端头对端头时拐角不缺口),线宽 / 颜色生效', () => {
    const h = busAttrs(true, 'I 段', 8, '#ff8800').body!
    expect(h).toMatchObject({ refWidth: '100%', refWidth2: 8, refX2: -4, height: 8, refY2: -4, fill: '#ff8800' })
    const v = busAttrs(false).body!
    expect(v).toMatchObject({ refHeight: '100%', refHeight2: 4, refY2: -2, width: 4, refX2: -2, fill: 'currentColor' })
    const d = doc()
    setBusWidth(d, 'b1', 10)
    expect(busToCell(d.buses[0]!).attrs.body).toMatchObject({ height: 10, refWidth2: 10 })
  })
})

describe('文字样式', () => {
  it('字号 / 加粗 / 颜色;缺省值删字段', () => {
    const d = doc()
    expect(setLabelStyle(d, 'l1', { size: 24, bold: true, color: 'a' })).toBe(true)
    expect(d.labels[0]).toMatchObject({ size: 24, bold: true, color: 'a' })
    expect(setLabelStyle(d, 'l1', { size: 12, bold: false, color: '' })).toBe(true)
    expect(d.labels[0]).toEqual({ id: 'l1', x: 10, y: 10, kind: 'text', text: '10kV I 段' })
  })
  it('越界字号、乱写的颜色拒绝', () => {
    const d = doc()
    expect(setLabelStyle(d, 'l1', { size: 500 })).toBe(false)
    expect(setLabelStyle(d, 'l1', { color: 'javascript:alert(1)' })).toBe(false)
  })
  it('画布:每次都显式给颜色 / 粗细(setAttrs 是合并语义,清掉自定义值要能回缺省)', () => {
    const d = doc()
    setLabelStyle(d, 'l1', { size: 20, bold: true, color: '#00ff00' })
    expect(labelToCell(d.labels[0]!).attrs.text).toMatchObject({ fontSize: 20, fontWeight: 700, fill: '#00ff00' })
    setLabelStyle(d, 'l1', { bold: false, color: '' })
    expect(labelToCell(d.labels[0]!).attrs.text).toMatchObject({ fontWeight: 400, fill: LABEL_FILL })
  })
})

describe('在线状态灯', () => {
  it('节点有设备:勾上就自动绑好它的服务端属性 active', () => {
    const c = content()
    setNodeOnline(c, 'n1', true, null, ids())
    const pt = c.doc.nodes[0]!.online!.pt
    expect(c.bindings[sldPointSlot(pt)]).toEqual({
      mode: 'attr',
      entity: { type: 'DEVICE', id: '', name: 'QF1' },
      scope: 'SERVER_SCOPE',
      key: ONLINE_ATTR_KEY,
    })
    expect(unboundRefs(c)).toEqual([])
  })
  it('节点没设备:灯照开,但算一处未绑(等人去选)', () => {
    const c = content()
    setNodeOnline(c, 'n3', true, null, ids())
    expect(unboundRefs(c).map(r => r.from)).toEqual(['online'])
  })
  it('关掉:字段与没人引用的绑定一起清掉', () => {
    const c = content()
    setNodeOnline(c, 'n1', true, null, ids())
    setNodeOnline(c, 'n1', false, null, ids())
    expect('online' in c.doc.nodes[0]!).toBe(false)
    expect(c.bindings).toEqual({})
  })
  it('批量:只给「有设备、还没灯」的开', () => {
    const c = content()
    setNodeOnline(c, 'n1', true, null, ids())
    expect(enableOnlineForNodes(c, ['n1', 'n2', 'n3'], null, ids())).toBe(1)
    expect(c.doc.nodes.map(n => !!n.online)).toEqual([true, true, false])
  })
  it('灯的位置:右上是缺省,不落进 JSON', () => {
    const c = content()
    setNodeOnline(c, 'n1', true, null, ids())
    setOnlineCorner(c, 'n1', 'bl')
    expect(c.doc.nodes[0]!.online!.at).toBe('bl')
    setOnlineCorner(c, 'n1', 'tr')
    expect('at' in c.doc.nodes[0]!.online!).toBe(false)
  })
  it('选中单个状态标签 → 绑定面板的编辑对象是 status', () => {
    const d = doc()
    d.labels.push({ id: 's1', x: 0, y: 0, kind: 'status', pt: 'ps', title: '站点' })
    expect(bindingTarget(d, { nodes: [], buses: [], wires: [], labels: ['s1'] })).toEqual({ kind: 'status', id: 's1' })
    expect(labelToCell(d.labels[1]!).attrs.text!.text).toBe('● 站点 在线')
  })
})
