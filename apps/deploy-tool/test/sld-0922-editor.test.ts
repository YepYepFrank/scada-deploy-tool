/**
 * 一次接线图编辑器 · 2026-09-22 现场反馈的六项(编辑器侧):
 * ① 母线 / 文字 / 图元的颜色、粗细、字号**批量改**(同类一起选就一起改);
 * ② 设备框自由改宽高(拖手柄 / 填数字),其余图元仍锁宽高比;
 * ③ 图元自定义颜色;④ 分组框边框;⑤ 数值列对齐;⑥ 开关没数据时按合闸画。
 * 右栏可拖是纯 DOM 交互,在 sld-integration 里点。
 */
import { describe, expect, it } from 'vitest'
import {
  getSldSymbol,
  nodeBox,
  portPosition,
  registerBuiltins,
  type SldDoc,
  type SldLabel,
  type SldNode,
} from '@grid/scada-renderer'
import {
  alignLabelColumns,
  freeSizeOf,
  resizeNodeByBox,
  setBusColor,
  setBusWidth,
  setFrameStyle,
  setLabelStyle,
  setNodeColor,
  setNodeScale,
  setNodeSize,
  setStateFallback,
} from '../src/sld-editor/panels/inspector/ops'
import { frameToCell, nodeToCell } from '../src/sld-editor/x6-adapter'

registerBuiltins()

const node = (id: string, symbol: string, over: Partial<SldNode> = {}): SldNode => ({
  id,
  symbol,
  x: 100,
  y: 100,
  rot: 0,
  ...over,
})
const valueLabel = (id: string, title: string, over: Partial<SldLabel> = {}): SldLabel =>
  ({ id, kind: 'value', x: 40, y: 40, pt: `p_${id}`, title, ...over }) as SldLabel

const doc = (over: Partial<SldDoc> = {}): SldDoc => ({
  v: 1,
  canvas: { w: 1200, h: 800, grid: 10 },
  nodes: [node('n1', 'breaker'), node('n2', 'ct', { x: 200 }), node('box', 'device-box', { x: 300 })],
  buses: [
    { id: 'b1', x1: 0, y1: 0, x2: 200, y2: 0 },
    { id: 'b2', x1: 0, y1: 100, x2: 200, y2: 100 },
  ],
  wires: [],
  labels: [valueLabel('l1', 'Uab'), valueLabel('l2', 'P'), { id: 'l3', kind: 'text', x: 0, y: 0, text: '注释' }],
  frames: [
    { id: 'f1', x: 0, y: 0, w: 200, h: 100 },
    { id: 'f2', x: 0, y: 200, w: 200, h: 100 },
  ],
  ...over,
})

describe('① 批量改外观', () => {
  it('两条母线一起改粗细与颜色', () => {
    const d = doc()
    expect(setBusWidth(d, ['b1', 'b2'], 8)).toBe(true)
    expect(d.buses.map(b => b.width)).toEqual([8, 8])
    expect(setBusColor(d, ['b1', 'b2'], '#ff8800')).toBe(true)
    expect(d.buses.map(b => b.color)).toEqual(['#ff8800', '#ff8800'])
    // 改回缺省值 / 清掉颜色:字段一起删掉,不留在 JSON 里
    expect(setBusWidth(d, ['b1', 'b2'], 4)).toBe(true)
    expect(setBusColor(d, ['b1', 'b2'], undefined)).toBe(true)
    expect(d.buses.every(b => !('width' in b) && !('color' in b))).toBe(true)
  })
  it('三个文字一起改字号 / 加粗 / 颜色;再改成同一个值时返回 false(不进撤销栈)', () => {
    const d = doc()
    const ids = ['l1', 'l2', 'l3']
    expect(setLabelStyle(d, ids, { size: 16, bold: true, color: 'a' })).toBe(true)
    expect(d.labels.map(l => [l.size, l.bold, l.color])).toEqual([
      [16, true, 'a'],
      [16, true, 'a'],
      [16, true, 'a'],
    ])
    expect(setLabelStyle(d, ids, { size: 16, bold: true, color: 'a' })).toBe(false)
  })
  it('非法值一个都不改(不会只改一半)', () => {
    const d = doc()
    expect(setLabelStyle(d, ['l1', 'l2'], { size: 999 })).toBe(false)
    expect(d.labels.every(l => l.size === undefined)).toBe(true)
    expect(setBusWidth(d, ['b1', 'b2'], 99)).toBe(false)
    expect(d.buses.every(b => b.width === undefined)).toBe(true)
  })
  it('只选了一个就只改一个(单选是批量的特例)', () => {
    const d = doc()
    setBusWidth(d, ['b1'], 8)
    expect(d.buses.map(b => b.width)).toEqual([8, undefined])
  })
})

describe('② 设备框自由改宽高', () => {
  it('填数字:吸附到步长,只给宽时高不动;画布上的盒子与端口跟着变', () => {
    const d = doc()
    expect(setNodeSize(d, ['box'], { w: 235 }, getSldSymbol)).toBe(true)
    const box = d.nodes.find(n => n.id === 'box')!
    expect(box.size).toEqual({ w: 240, h: 40 })
    const cell = nodeToCell(box)
    expect([cell.width, cell.height]).toEqual([240, 40])
    // 端口还在四边中点,且落栅格
    const e = portPosition(box, getSldSymbol('device-box')!, 'e')!
    expect([e.x - box.x, e.y - box.y]).toEqual([240, 20])
  })
  it('拖手柄:宽高各自吸附,长宽比不锁;拖右下角时左上角不动', () => {
    const d = doc()
    const box = d.nodes.find(n => n.id === 'box')!
    expect(resizeNodeByBox(d, 'box', { x: 300, y: 100, width: 237, height: 63 }, getSldSymbol)).toBe(true)
    expect(box.size).toEqual({ w: 240, h: 60 })
    expect([box.x, box.y]).toEqual([300, 100])
  })
  it('拖左上角:右下角不动', () => {
    const d = doc()
    const box = d.nodes.find(n => n.id === 'box')!
    const before = nodeBox(box, getSldSymbol('device-box')!)
    const right = before.x + before.w
    const bottom = before.y + before.h
    resizeNodeByBox(d, 'box', { x: before.x - 160, y: before.y - 20, width: 240, height: 60 }, getSldSymbol)
    expect(box.size).toEqual({ w: 240, h: 60 })
    expect(box.x + box.size!.w).toBe(right)
    expect(box.y + box.size!.h).toBe(bottom)
  })
  it('非设备框图元不吃 size,拖手柄仍按等比倍数吸附', () => {
    const d = doc()
    expect(setNodeSize(d, ['n1'], { w: 240 }, getSldSymbol)).toBe(false)
    const def = getSldSymbol('breaker')!
    resizeNodeByBox(d, 'n1', { x: 100, y: 100, width: def.w * 2.2, height: def.h * 2.2 }, getSldSymbol)
    expect(d.nodes[0]).toMatchObject({ scale: 2 })
    expect(d.nodes[0]!.size).toBeUndefined()
  })
  it('选了等比倍数就把自由宽高去掉,两者互斥', () => {
    const d = doc()
    setNodeSize(d, ['box'], { w: 240, h: 60 }, getSldSymbol)
    expect(setNodeScale(d, ['box'], 2, getSldSymbol)).toBe(true)
    const box = d.nodes.find(n => n.id === 'box')!
    expect(box.size).toBeUndefined()
    expect(box.scale).toBe(2)
  })
  it('freeSizeOf:能自由改宽高的才给宽高与步长,其余返回 undefined', () => {
    const d = doc()
    expect(
      freeSizeOf(
        d,
        d.nodes.find(n => n.id === 'box'),
        getSldSymbol
      )
    ).toEqual({ w: 80, h: 40, step: { w: 20, h: 20 } })
    expect(freeSizeOf(d, d.nodes[0], getSldSymbol)).toBeUndefined()
  })
})

describe('③ 图元颜色', () => {
  it('两个图元一起上色;只认 #hex;清掉回到随带电着色', () => {
    const d = doc()
    expect(setNodeColor(d, ['n1', 'n2'], '#ff8800')).toBe(true)
    expect(d.nodes.slice(0, 2).map(n => n.color)).toEqual(['#ff8800', '#ff8800'])
    expect(setNodeColor(d, ['n1'], 'red')).toBe(false)
    expect(setNodeColor(d, ['n1', 'n2'], undefined)).toBe(true)
    expect(d.nodes.every(n => !('color' in n))).toBe(true)
  })
})

describe('④ 分组框边框', () => {
  it('两个分组框一起改颜色 / 粗细 / 实线;缺省值不落进 JSON', () => {
    const d = doc()
    expect(setFrameStyle(d, ['f1', 'f2'], { color: '#ff8800', width: 3, solid: true })).toBe(true)
    expect(d.frames!.map(f => [f.color, f.width, f.solid])).toEqual([
      ['#ff8800', 3, true],
      ['#ff8800', 3, true],
    ])
    expect(setFrameStyle(d, ['f1', 'f2'], { width: 1, solid: false, color: '' })).toBe(true)
    expect(d.frames!.every(f => !('width' in f) && !('solid' in f) && !('color' in f))).toBe(true)
    expect(setFrameStyle(d, ['f1'], { width: 99 })).toBe(false)
  })
  it('样式落到画布 cell 的 body 上(setAttrs 是合并语义,每次都显式给值)', () => {
    const d = doc()
    setFrameStyle(d, ['f1'], { color: '#ff8800', width: 3, solid: true })
    const body = frameToCell(d.frames![0]!).attrs.body as Record<string, unknown>
    expect(body).toMatchObject({ stroke: '#ff8800', strokeWidth: 3, strokeDasharray: 'none' })
    // 没配的分组框回到缺省虚线
    expect(frameToCell(d.frames![1]!).attrs.body).toMatchObject({ strokeDasharray: '6 4', strokeWidth: 1 })
  })
})

describe('⑤ 数值列对齐', () => {
  it('一组数值标签算出同一个列宽:前缀长的那个决定列宽', () => {
    const d = doc()
    expect(alignLabelColumns(d, ['l1', 'l2', 'l3'])).toBe(true)
    const [a, b] = [d.labels[0], d.labels[1]] as Array<SldLabel & { colW?: number }>
    expect(a!.colW).toBeGreaterThan(0)
    expect(a!.colW).toBe(b!.colW)
    // 纯文字标签不掺和
    expect('colW' in d.labels[2]!).toBe(false)
  })
  it('只有一个数值标签时不做(没有「对齐」可言)', () => {
    const d = doc()
    expect(alignLabelColumns(d, ['l1'])).toBe(false)
  })
  it('手填列宽;填 0 清掉', () => {
    const d = doc()
    expect(setLabelStyle(d, ['l1', 'l2'], { colW: 70 })).toBe(true)
    expect((d.labels[0] as SldLabel & { colW?: number }).colW).toBe(70)
    expect(setLabelStyle(d, ['l1', 'l2'], { colW: 0 })).toBe(true)
    expect('colW' in d.labels[0]!).toBe(false)
  })
})

describe('⑥ 开关没数据时按什么画', () => {
  it('只对配了状态测点的节点生效;unknown 不落进 JSON', () => {
    const d = doc({
      nodes: [
        node('s1', 'breaker', { state: { pt: 'p1', map: { '1': 'closed', '0': 'open' } } }),
        node('s2', 'breaker'),
      ],
    })
    expect(setStateFallback(d, ['s1', 's2'], 'closed')).toBe(true)
    expect(d.nodes[0]!.state!.fallback).toBe('closed')
    expect(d.nodes[1]!.state).toBeUndefined()
    expect(setStateFallback(d, ['s1'], 'unknown')).toBe(true)
    expect('fallback' in d.nodes[0]!.state!).toBe(false)
  })
})
