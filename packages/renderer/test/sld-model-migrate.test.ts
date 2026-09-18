/** T5.1 文档迁移:ADR-005 验收用例清单 migrateSldDoc 一节逐条对应(it 标题以清单原文开头)。 */
import { describe, it, expect } from 'vitest'
import { migrateSldDoc, emptySldDoc, isSldDoc } from '../src/sld'
import type { SldDoc } from '../src/sld'

const full = (): SldDoc => ({
  v: 1,
  canvas: { w: 1200, h: 700, grid: 10 },
  background: { src: 'data:image/png;base64,AAAA', opacity: 0.4 },
  nodes: [{ id: 'qf1', symbol: 'breaker', x: 100, y: 60, rot: 90, flip: true }],
  buses: [{ id: 'bus1', x1: 0, y1: 200, x2: 400, y2: 200, kv: 10 }],
  wires: [{ id: 'w1', from: { node: 'qf1', port: 'b' }, to: { bus: 'bus1', d: 120 } }],
  labels: [{ id: 'l1', x: 0, y: 0, kind: 'text', text: '1# 进线' }],
  frames: [{ id: 'f1', x: 0, y: 0, w: 100, h: 100, title: 'LP1' }],
})

describe('migrateSldDoc', () => {
  it('缺省数组补空:nodes / buses / wires / labels 缺了补 [],frames 缺了不补', () => {
    const doc = migrateSldDoc({
      v: 1,
      canvas: { w: 800, h: 600, grid: 10 },
      nodes: [{ id: 'n1', symbol: 'meter', x: 0, y: 0, rot: 0 }],
    })
    expect(doc).toEqual({
      v: 1,
      canvas: { w: 800, h: 600, grid: 10 },
      nodes: [{ id: 'n1', symbol: 'meter', x: 0, y: 0, rot: 0 }],
      buses: [],
      wires: [],
      labels: [],
    })
    expect('frames' in doc).toBe(false)
    expect(isSldDoc(doc)).toBe(true)
    // 不是数组的也当缺失
    expect(migrateSldDoc({ v: 1, wires: 'oops', labels: null })).toMatchObject({ wires: [], labels: [] })
  })

  it('canvas 缺省 1600 × 900 × 10:整个缺或缺某几项都补,已有的值不动', () => {
    expect(migrateSldDoc({ v: 1 })).toEqual(emptySldDoc())
    expect(migrateSldDoc({ v: 1, canvas: { w: 2000 } }).canvas).toEqual({ w: 2000, h: 900, grid: 10 })
    // grid 写错不在这里纠正,留给 validateSldDoc 报 bad-grid
    expect(migrateSldDoc({ v: 1, canvas: { w: 800, h: 600, grid: 20 } }).canvas.grid).toBe(20)
  })

  it('未知版本抛错(错误信息中文);不是对象同样抛错', () => {
    expect(() => migrateSldDoc({ ...full(), v: 2 })).toThrow(/版本 2 不支持/)
    expect(() => migrateSldDoc({ nodes: [] })).toThrow(/版本/)
    expect(() => migrateSldDoc({ ...full(), v: '1' })).toThrow(/版本/)
    for (const raw of [null, undefined, 42, 'doc', []]) expect(() => migrateSldDoc(raw)).toThrow(/不是对象/)
  })

  it('v1 原样通过:内容深相等(含 background / frames 等可选字段),且不修改输入', () => {
    const raw = full()
    const doc = migrateSldDoc(raw)
    expect(doc).toEqual(full())
    expect(raw).toEqual(full())
    expect(doc).not.toBe(raw)
  })

  it('输入缺字段时也不修改输入', () => {
    const raw = { v: 1, canvas: { w: 800 } }
    migrateSldDoc(raw)
    expect(raw).toEqual({ v: 1, canvas: { w: 800 } })
  })
})
