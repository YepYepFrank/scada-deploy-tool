/** T5.0 接线图测点:doc 里的测点引用清单、测点值 → 开关状态。 */
import { describe, it, expect } from 'vitest'
import { collectPointRefs, resolveSwitchState } from '../src/sld'
import type { SldDoc, SldStateRef } from '../src/sld'

describe('collectPointRefs', () => {
  const doc: SldDoc = {
    v: 1,
    canvas: { w: 800, h: 600, grid: 10 },
    nodes: [
      { id: 'qf1', symbol: 'breaker', x: 0, y: 0, rot: 0, state: { pt: 'p-qf1', map: { '1': 'closed', '0': 'open' } } },
      { id: 'm1', symbol: 'meter', x: 0, y: 100, rot: 0 },
      { id: 'qf2', symbol: 'breaker', x: 100, y: 0, rot: 0, state: { pt: 'p-shared', map: { '1': 'closed' } } },
    ],
    buses: [],
    wires: [],
    labels: [
      { id: 'l1', x: 0, y: 0, kind: 'text', text: '1# 进线' },
      { id: 'l2', x: 0, y: 20, kind: 'value', pt: 'p-kw', attach: 'm1', title: 'P' },
      { id: 'l3', x: 0, y: 40, kind: 'value', pt: 'p-shared' },
      { id: 'l4', x: 0, y: 60, kind: 'value', pt: 'p-kw' },
    ],
  }

  it('先节点状态、后数值标签,各按出现顺序;同一 pt 多处引用各出现一次', () => {
    expect(collectPointRefs(doc)).toEqual([
      { pt: 'p-qf1', from: 'state', owner: 'qf1' },
      { pt: 'p-shared', from: 'state', owner: 'qf2' },
      { pt: 'p-kw', from: 'label', owner: 'l2' },
      { pt: 'p-shared', from: 'label', owner: 'l3' },
      { pt: 'p-kw', from: 'label', owner: 'l4' },
    ])
  })

  it('空图 → 空数组', () => {
    expect(collectPointRefs({ ...doc, nodes: [], labels: [] })).toEqual([])
  })
})

describe('resolveSwitchState', () => {
  const ref: SldStateRef = { pt: 'p1', map: { '1': 'closed', '0': 'open', 合: 'closed', 分: 'open' } }
  const at = (v: unknown, ts = 1000) => ({ v, ts })

  it('数字', () => {
    expect(resolveSwitchState(ref, at(1))).toBe('closed')
    expect(resolveSwitchState(ref, at(0))).toBe('open')
  })

  it('字符串', () => {
    expect(resolveSwitchState(ref, at('1'))).toBe('closed')
    expect(resolveSwitchState(ref, at('分'))).toBe('open')
  })

  it("布尔:先按 'true' / 'false' 比,再按 '1' / '0' 比", () => {
    expect(resolveSwitchState(ref, at(true))).toBe('closed')
    expect(resolveSwitchState(ref, at(false))).toBe('open')
    // map 里直接写了 'true' 的以它为准
    const inverted: SldStateRef = { pt: 'p1', map: { true: 'open', '1': 'closed' } }
    expect(resolveSwitchState(inverted, at(true))).toBe('open')
  })

  it('映射不上 → unknown(含撞原型链的键)', () => {
    expect(resolveSwitchState(ref, at(2))).toBe('unknown')
    expect(resolveSwitchState(ref, at('closed'))).toBe('unknown')
    expect(resolveSwitchState(ref, at('constructor'))).toBe('unknown')
    expect(resolveSwitchState(ref, at({}))).toBe('unknown')
  })

  it('无值 → unknown', () => {
    expect(resolveSwitchState(ref, undefined)).toBe('unknown')
    expect(resolveSwitchState(ref, at(undefined))).toBe('unknown')
    expect(resolveSwitchState(ref, at(null))).toBe('unknown')
  })

  it('过期:给了 staleMs 才判,按数据时间戳算', () => {
    expect(resolveSwitchState(ref, at(1, 1000), { now: 61_001, staleMs: 60_000 })).toBe('unknown')
    expect(resolveSwitchState(ref, at(1, 1000), { now: 61_000, staleMs: 60_000 })).toBe('closed')
    // 没给 staleMs:再旧也照常映射
    expect(resolveSwitchState(ref, at(1, 0), { now: 9e12 })).toBe('closed')
    // 没给 now:用当前时间
    expect(resolveSwitchState(ref, at(1, Date.now()), { staleMs: 60_000 })).toBe('closed')
    expect(resolveSwitchState(ref, at(1, 0), { staleMs: 60_000 })).toBe('unknown')
  })

  it('节点没配状态来源 → closed(缺省视为常合)', () => {
    expect(resolveSwitchState(undefined, undefined)).toBe('closed')
    expect(resolveSwitchState(undefined, at(0))).toBe('closed')
  })
})
