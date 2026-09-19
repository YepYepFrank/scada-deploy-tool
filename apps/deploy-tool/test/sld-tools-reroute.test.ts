// T5.7 重置走线 / 拉直:作用对象、清拐点、拐点吸附栅格 + 斜段改先水平后垂直 + 合并共线点;工具的启用条件
import { describe, expect, it } from 'vitest'
import { ref } from 'vue'
import { lookupSldSymbol, registerBuiltinSldSymbols, type SldDoc, type SldSelection } from '@grid/scada-renderer'
import type { SldEditorContext } from '../src/sld-editor/ext'
import { createSldStore } from '../src/sld-editor/store'
import {
  resetRoutes,
  simplifyPath,
  straightenPath,
  straightenWires,
  targetWires,
  wiresWithVertices,
} from '../src/sld-editor/tools/reroute/ops'
import ext from '../src/sld-editor/tools/reroute/index'

registerBuiltinSldSymbols()

/** n1(断路器 40 × 60)在 (100,100):端口 a (120,100)、b (120,160);n2 在 (300,300):a (320,300) */
function doc(): SldDoc {
  return {
    v: 1,
    canvas: { w: 1000, h: 800, grid: 10 },
    nodes: [
      { id: 'n1', symbol: 'breaker', x: 100, y: 100, rot: 0, source: {} },
      { id: 'n2', symbol: 'breaker', x: 300, y: 300, rot: 0 },
      { id: 'n3', symbol: 'breaker', x: 600, y: 100, rot: 0 },
    ],
    buses: [{ id: 'b1', x1: 0, y1: 50, x2: 800, y2: 50 }],
    wires: [
      // 斜着拖歪的拐点
      { id: 'w1', from: { node: 'n1', port: 'b' }, to: { node: 'n2', port: 'a' }, vertices: [[213, 204]] },
      { id: 'w2', from: { bus: 'b1', d: 120 }, to: { node: 'n1', port: 'a' } },
      { id: 'w3', from: { bus: 'b1', d: 620 }, to: { node: 'n3', port: 'a' }, vertices: [[620, 70]] },
    ],
    labels: [],
  }
}
const sel = (s: Partial<SldSelection>): SldSelection => ({
  nodes: [],
  buses: [],
  wires: [],
  labels: [],
  frames: [],
  ...s,
})

describe('作用对象', () => {
  it('选中了连线就只处理连线;否则是选中节点相关的连线', () => {
    expect(targetWires(doc(), sel({ wires: ['w3'], nodes: ['n1'] }))).toEqual(['w3'])
    expect(targetWires(doc(), sel({ nodes: ['n1'] }))).toEqual(['w1', 'w2'])
    expect(wiresWithVertices(doc(), sel({ nodes: ['n1'] }))).toEqual(['w1'])
    expect(wiresWithVertices(doc(), sel({ nodes: ['n2', 'n3'] }))).toEqual(['w1', 'w3'])
  })
})

describe('重置走线', () => {
  it('删掉 vertices,回到缺省走线', () => {
    const d = doc()
    expect(resetRoutes(d, ['w1', 'w2'])).toBe(1)
    expect(d.wires[0]!.vertices).toBeUndefined()
    expect(d.wires[2]!.vertices).toEqual([[620, 70]])
  })
})

describe('拉直', () => {
  it('straightenPath:中间点吸附,斜段先水平后垂直,合并共线点', () => {
    const out = straightenPath([
      { x: 120, y: 160 },
      { x: 213, y: 204 },
      { x: 320, y: 300 },
    ])
    // (213,204) → (210,200);(120,160)→(210,200) 斜:插 (210,160);(210,200)→(320,300) 斜:插 (320,200)
    expect(out).toEqual([
      { x: 120, y: 160 },
      { x: 210, y: 160 },
      { x: 210, y: 200 },
      { x: 320, y: 200 },
      { x: 320, y: 300 },
    ])
    expect(out.every((p, i) => i === 0 || p.x === out[i - 1]!.x || p.y === out[i - 1]!.y)).toBe(true)
  })
  it('simplifyPath:共线的中间点与重复点去掉,端点保留', () => {
    expect(
      simplifyPath([
        { x: 0, y: 0 },
        { x: 0, y: 10 },
        { x: 0, y: 10 },
        { x: 0, y: 30 },
        { x: 20, y: 30 },
      ])
    ).toEqual([
      { x: 0, y: 0 },
      { x: 0, y: 30 },
      { x: 20, y: 30 },
    ])
  })
  it('straightenWires:写回 vertices;拐点全被合并掉时等同重置', () => {
    const d = doc()
    expect(straightenWires(d, ['w1', 'w3'], lookupSldSymbol)).toBe(2)
    expect(d.wires[0]!.vertices).toEqual([
      [210, 160],
      [210, 200],
      [320, 200],
    ])
    // w3:母线 (620,50) → 拐点 (620,70) → 端口 (620,100),全共线
    expect(d.wires[2]!.vertices).toBeUndefined()
    // 再拉一次没有变化
    expect(straightenWires(d, ['w1'], lookupSldSymbol)).toBe(0)
  })
})

describe('工具', () => {
  function fakeCtx() {
    const store = createSldStore({ doc: doc(), bindings: {} })
    const ro = ref(false)
    const ctx: SldEditorContext = {
      content: store.content,
      selection: store.selection,
      readonly: ro,
      apply: (r, l) => (ro.value ? false : store.apply(r, l)),
      select: s => store.select(s),
      newId: k => store.newId(k),
      toCanvas: p => p,
      view: { zoom: ref(1), fit: () => {}, zoomBy: () => {}, resetZoom: () => {} },
      host: {},
    }
    return { ctx, store, ro }
  }
  const [reset, straighten] = ext.tools!

  it('enabled:目标连线里有带拐点的且非只读', () => {
    const { ctx, store, ro } = fakeCtx()
    expect(reset!.enabled!(ctx)).toBe(false)
    store.select({ wires: ['w2'] })
    expect(reset!.enabled!(ctx)).toBe(false)
    store.select({ nodes: ['n2'] })
    expect(reset!.enabled!(ctx)).toBe(true)
    expect(straighten!.enabled!(ctx)).toBe(true)
    ro.value = true
    expect(reset!.enabled!(ctx)).toBe(false)
    expect(straighten!.enabled!(ctx)).toBe(false)
  })
  it('run:一次 apply,可撤销', () => {
    const { ctx, store } = fakeCtx()
    store.select({ nodes: ['n1'] })
    void straighten!.run(ctx)
    expect(store.undoLabel.value).toBe('拉直走线')
    void reset!.run(ctx)
    expect(store.undoLabel.value).toBe('重置走线')
    expect(store.content.value.doc.wires[0]!.vertices).toBeUndefined()
    store.undo()
    store.undo()
    expect(store.content.value.doc.wires[0]!.vertices).toEqual([[213, 204]])
  })
})
