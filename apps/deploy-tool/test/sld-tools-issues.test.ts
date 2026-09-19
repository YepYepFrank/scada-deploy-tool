// T5.7 问题面板:三类图 ↔ 绑定检查、合并结构校验、path → 选择集、清理多余绑定、角标与缓存、面板交互;300 节点耗时
import { describe, expect, it } from 'vitest'
import { nextTick, ref } from 'vue'
import { mount } from '@vue/test-utils'
import { registerBuiltinSldSymbols, type Binding, type SldDoc, type SldSelection } from '@grid/scada-renderer'
import { SLD_EDITOR_CTX, type SldEditorContent, type SldEditorContext } from '../src/sld-editor/ext'
import { createSldStore } from '../src/sld-editor/store'
import {
  checkBindings,
  checkContent,
  pathToSelection,
  removeUnusedBindings,
  unusedPointSlots,
} from '../src/sld-editor/panels/issues/check'
import { issuesOf, SLOW_MS } from '../src/sld-editor/panels/issues/state'
import ext from '../src/sld-editor/panels/issues/index'
import IssuesPanel from '../src/sld-editor/panels/issues/IssuesPanel.vue'
import { makeMockContent } from '../src/sld-editor/dev/mock'

registerBuiltinSldSymbols()

const ts = (name: string, key: string): Binding => ({ mode: 'ts', entity: { type: 'DEVICE', id: '', name }, key })

/** n1 状态引用 p1(已绑)、n2 有设备但名下测点 p2 没绑、l1 数值标签引用 p3(没绑)、p9 多余 */
function content(): SldEditorContent {
  const doc: SldDoc = {
    v: 1,
    canvas: { w: 800, h: 600, grid: 10 },
    nodes: [
      {
        id: 'n1',
        symbol: 'breaker',
        x: 100,
        y: 100,
        rot: 0,
        name: 'QF1',
        entity: { type: 'DEVICE', name: 'D1' },
        state: { pt: 'p1', map: { '1': 'closed' } },
        source: {},
      },
      {
        id: 'n2',
        symbol: 'breaker',
        x: 200,
        y: 100,
        rot: 0,
        entity: { type: 'DEVICE', name: 'D2' },
        state: { pt: 'p2', map: { '1': 'closed' } },
      },
      { id: 'n3', symbol: 'meter', x: 300, y: 100, rot: 0 },
    ],
    buses: [],
    wires: [{ id: 'w1', from: { node: 'n1', port: 'b' }, to: { node: 'n2', port: 'a' } }],
    labels: [{ id: 'l1', x: 350, y: 120, attach: 'n3', kind: 'value', pt: 'p3', title: 'P' }],
  }
  return { doc, bindings: { 'pt.p1': ts('D1', 'sw'), 'pt.p9': ts('D9', 'x'), alarms: ts('S', 'a') } }
}

describe('checkBindings', () => {
  it('图里引用了没绑定 → error,定位到引用者', () => {
    const issues = checkBindings(content()).filter(i => i.code === 'unbound-point')
    expect(issues.map(i => [i.level, i.path, i.slot])).toEqual([
      ['error', 'nodes/n2/state/pt', 'pt.p2'],
      ['error', 'labels/l1/pt', 'pt.p3'],
    ])
    expect(issues[1]!.message).toContain('数值标签 l1(P)')
  })
  it('绑定了没人引用 → warning;非 pt.* 槽位不管', () => {
    const issues = checkBindings(content()).filter(i => i.code === 'unused-binding')
    expect(issues.map(i => [i.level, i.path])).toEqual([['warning', 'bindings/pt.p9']])
    expect(unusedPointSlots(content())).toEqual(['pt.p9'])
  })
  it('有设备的节点名下没有已绑定测点 → warning;依附的数值标签也算名下', () => {
    const c = content()
    expect(
      checkBindings(c)
        .filter(i => i.code === 'entity-without-points')
        .map(i => i.path)
    ).toEqual(['nodes/n2'])
    // n2 上依附一个已绑定的数值标签 → 不再报
    c.doc.labels.push({ id: 'l2', x: 0, y: 0, attach: 'n2', kind: 'value', pt: 'p1' })
    expect(checkBindings(c).filter(i => i.code === 'entity-without-points')).toEqual([])
  })
  it('空数组绑定视为没绑', () => {
    const c = content()
    ;(c.bindings as Record<string, Binding | Binding[]>)['pt.p1'] = []
    expect(checkBindings(c).some(i => i.slot === 'pt.p1' && i.code === 'unbound-point')).toBe(true)
  })
})

describe('checkContent', () => {
  it('合并结构校验;error 在前;计数', () => {
    const c = content()
    c.doc.wires.push({ id: 'w2', from: { node: 'nX', port: 'a' }, to: { node: 'n1', port: 'a' } })
    const r = checkContent(c)
    expect(r.issues.findIndex(i => i.level === 'warning')).toBe(r.errors)
    expect(r.issues.map(i => i.code)).toContain('dangling-wire')
    expect(r.errors).toBe(3) // 悬空线 + 两个未绑定
    expect(r.warnings).toBe(r.issues.length - 3)
    expect(r.unusedSlots).toEqual(['pt.p9'])
  })
  it('mock 图:没有 error', () => {
    expect(checkContent(makeMockContent()).errors).toBe(0)
  })
})

describe('pathToSelection', () => {
  const { doc } = content()
  it('取前两段定位元素', () => {
    expect(pathToSelection('nodes/n3', doc)).toEqual({ nodes: ['n3'] })
    expect(pathToSelection('wires/w1/from', doc)).toEqual({ wires: ['w1'] })
    expect(pathToSelection('labels/l1/pt', doc)).toEqual({ labels: ['l1'] })
    expect(pathToSelection('/nodes/n2/state/pt')).toEqual({ nodes: ['n2'] })
    expect(pathToSelection('frames/f1')).toEqual({ frames: ['f1'] })
  })
  it('定位不到的返回 undefined', () => {
    for (const p of ['canvas/grid', 'nodes', 'bindings/pt.p9', 'nodes/#3', 'v', '', 'nodes/nX'])
      expect(pathToSelection(p, doc)).toBeUndefined()
  })
})

describe('removeUnusedBindings', () => {
  it('只删没人引用的 pt.*', () => {
    const c = content()
    expect(removeUnusedBindings(c)).toBe(1)
    expect(Object.keys(c.bindings).sort()).toEqual(['alarms', 'pt.p1'])
    expect(removeUnusedBindings(c)).toBe(0)
  })
})

function fakeCtx(c: SldEditorContent = content()) {
  const store = createSldStore(c)
  const ro = ref(false)
  const selects: Array<[Partial<SldSelection>, unknown]> = []
  const ctx: SldEditorContext = {
    content: store.content,
    selection: store.selection,
    readonly: ro,
    apply: (r, l) => (ro.value ? false : store.apply(r, l)),
    select: (s, o) => {
      selects.push([s, o])
      store.select(s)
    },
    newId: k => store.newId(k),
    toCanvas: p => p,
    view: { zoom: ref(1), fit: () => {}, zoomBy: () => {}, resetZoom: () => {} },
    host: {},
  }
  return { ctx, store, ro, selects }
}

describe('角标与缓存', () => {
  const panel = ext.panels![0]!
  it('order 30;角标 = error + warning,随内容变化', () => {
    expect(panel.order).toBe(30)
    const { ctx, store } = fakeCtx()
    const r0 = checkContent(content())
    expect(panel.badge!(ctx)).toBe(r0.errors + r0.warnings)
    expect(issuesOf(ctx)).toBe(issuesOf(ctx))
    store.apply(d => {
      d.bindings['pt.p2'] = ts('D2', 'sw')
      d.bindings['pt.p3'] = ts('D3', 'P')
      delete d.bindings['pt.p9']
    })
    expect(panel.badge!(ctx)).toBeUndefined()
    expect(issuesOf(ctx).lastCost()).toBeLessThan(SLOW_MS) // 即时模式,没走防抖
  })
  it('没有问题时角标为 undefined(不显示)', () => {
    const c = content()
    c.bindings = { 'pt.p1': ts('D1', 'sw'), 'pt.p2': ts('D2', 'sw'), 'pt.p3': ts('D3', 'P') }
    const { ctx } = fakeCtx(c)
    expect(panel.badge!(ctx)).toBeUndefined()
  })
})

describe('面板', () => {
  it('分组、点击定位(center)、不可定位的不选;清理多余绑定一步;只读禁用', async () => {
    const { ctx, store, ro, selects } = fakeCtx()
    const w = mount(IssuesPanel, { global: { provide: { [SLD_EDITOR_CTX as symbol]: ctx } } })
    expect(w.findAll('[data-group]').map(g => g.attributes('data-group'))).toEqual(['error', 'warning'])
    await w.find('[data-path="labels/l1/pt"]').trigger('click')
    expect(selects.at(-1)).toEqual([{ labels: ['l1'] }, { center: true }])
    const n = selects.length
    await w.find('[data-path="bindings/pt.p9"]').trigger('click')
    expect(selects.length).toBe(n)
    const btn = w.find('[data-act=cleanup]')
    expect(btn.text()).toContain('(1)')
    ro.value = true
    await nextTick()
    expect(btn.attributes('disabled')).toBeDefined()
    ro.value = false
    await nextTick()
    await btn.trigger('click')
    expect(store.content.value.bindings['pt.p9']).toBeUndefined()
    expect(store.undoLabel.value).toBe('清理多余绑定(1 个)')
    await nextTick()
    expect(w.find('[data-path="bindings/pt.p9"]').exists()).toBe(false)
    expect(w.find('[data-act=cleanup]').attributes('disabled')).toBeDefined()
  })
})

describe('性能', () => {
  it(`300 节点 + 300 线 + 300 标签:一次检查在 ${SLOW_MS} ms 内(超过则面板自动改防抖)`, () => {
    const c = makeMockContent()
    const doc = c.doc
    doc.canvas = { w: 6000, h: 4000, grid: 10 }
    doc.buses.push({ id: 'bb', x1: 0, y1: 0, x2: 6000, y2: 0 })
    for (let i = 0; i < 300; i++) {
      const id = `m${i}`
      doc.nodes.push({
        id,
        symbol: 'breaker',
        x: (i % 100) * 60,
        y: 100 + Math.floor(i / 100) * 200,
        rot: 0,
        entity: { type: 'DEVICE', name: `D${i}` },
        state: { pt: `q${i}`, map: { '1': 'closed' } },
      })
      doc.wires.push({ id: `mw${i}`, from: { bus: 'bb', d: (i % 100) * 60 + 20 }, to: { node: id, port: 'a' } })
      doc.labels.push({ id: `ml${i}`, x: 0, y: 0, attach: id, kind: 'value', pt: `r${i}` })
      c.bindings[`pt.q${i}`] = ts(`D${i}`, 'sw')
    }
    checkContent(c) // 预热
    const t0 = performance.now()
    const r = checkContent(c)
    const ms = performance.now() - t0
    console.info(`[T5.7] 300 节点问题检查耗时 ${ms.toFixed(1)} ms`)
    expect(r.errors).toBe(300) // r* 全没绑
    expect(ms).toBeLessThan(SLOW_MS)
  })
})
