// T5.7 对齐 / 分布:六种对齐 + 两种等距、吸附栅格、依附标签跟随、母线与分组框参与;菜单的启用条件
import { describe, expect, it } from 'vitest'
import { nextTick, ref } from 'vue'
import { mount } from '@vue/test-utils'
import { lookupSldSymbol, registerBuiltinSldSymbols, type SldDoc, type SldSelection } from '@grid/scada-renderer'
import { SLD_EDITOR_CTX, type SldEditorContent, type SldEditorContext } from '../src/sld-editor/ext'
import { createSldStore } from '../src/sld-editor/store'
import { alignDeltas, alignItems, applyAlign, type AlignOp } from '../src/sld-editor/tools/align/ops'
import ext from '../src/sld-editor/tools/align/index'
import AlignMenu from '../src/sld-editor/tools/align/AlignMenu.vue'
import { alignMenu } from '../src/sld-editor/tools/align/state'

registerBuiltinSldSymbols()

/** 三个断路器(40 × 60)错落摆放 + 一条水平母线 + 一个分组框;n1 上依附一个标签;n1 → n2 的线带手工拐点 */
function doc(): SldDoc {
  return {
    v: 1,
    canvas: { w: 1000, h: 800, grid: 10 },
    nodes: [
      { id: 'n1', symbol: 'breaker', x: 100, y: 100, rot: 0, source: {} },
      { id: 'n2', symbol: 'breaker', x: 180, y: 130, rot: 0 },
      { id: 'n3', symbol: 'breaker', x: 400, y: 70, rot: 0 },
    ],
    buses: [{ id: 'b1', x1: 50, y1: 300, x2: 250, y2: 300 }],
    wires: [{ id: 'w1', from: { node: 'n1', port: 'b' }, to: { node: 'n2', port: 'a' }, vertices: [[120, 180]] }],
    labels: [
      { id: 'l1', x: 145, y: 110, attach: 'n1', kind: 'text', text: 'QF1' },
      { id: 'l2', x: 0, y: 0, kind: 'text', text: '自由' },
    ],
    frames: [{ id: 'f1', x: 600, y: 400, w: 100, h: 50 }],
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
const pos = (d: SldDoc, id: string): [number, number] => {
  const n = d.nodes.find(x => x.id === id)!
  return [n.x, n.y]
}
const run = (op: AlignOp, s: Partial<SldSelection>): SldDoc => {
  const d = doc()
  applyAlign(d, sel(s), op, lookupSldSymbol)
  return d
}

describe('对齐', () => {
  const three = { nodes: ['n1', 'n2', 'n3'] }
  it('左 / 右 / 水平居中', () => {
    expect(['n1', 'n2', 'n3'].map(id => pos(run('left', three), id)[0])).toEqual([100, 100, 100])
    expect(['n1', 'n2', 'n3'].map(id => pos(run('right', three), id)[0])).toEqual([400, 400, 400])
    // 跨度 100..440,中心 270 → x = 250
    expect(['n1', 'n2', 'n3'].map(id => pos(run('hcenter', three), id)[0])).toEqual([250, 250, 250])
  })
  it('顶 / 底 / 垂直居中;另一个坐标不动', () => {
    const top = run('top', three)
    expect(['n1', 'n2', 'n3'].map(id => pos(top, id))).toEqual([
      [100, 70],
      [180, 70],
      [400, 70],
    ])
    expect(['n1', 'n2', 'n3'].map(id => pos(run('bottom', three), id)[1])).toEqual([130, 130, 130])
    // 跨度 70..190,中心 130 → y = 100
    expect(['n1', 'n2', 'n3'].map(id => pos(run('vcenter', three), id)[1])).toEqual([100, 100, 100])
  })
  it('结果吸附栅格:居中落在 5 上时取整到 10', () => {
    const d = doc()
    d.nodes[2]!.x = 410 // 跨度 100..450,中心 275 − 20 = 255 → 260
    applyAlign(d, sel({ nodes: ['n1', 'n3'] }), 'hcenter', lookupSldSymbol)
    expect([pos(d, 'n1')[0], pos(d, 'n3')[0]]).toEqual([260, 260])
  })
  it('依附标签跟着节点走;自由标签不动;两端同步移动的连线拐点一起平移', () => {
    const d = run('top', { nodes: ['n1', 'n2'] }) // n1 y 100 → 100 不动;n2 130 → 100
    expect(d.labels.find(l => l.id === 'l1')).toMatchObject({ x: 145, y: 110 })
    const d2 = run('left', { nodes: ['n1', 'n2'], labels: ['l2'] }) // n2 x 180 → 100
    expect(d2.labels.find(l => l.id === 'l2')).toMatchObject({ x: 0, y: 0 })
    const d3 = run('bottom', { nodes: ['n1'], frames: ['f1'] }) // n1 底 160 → 450:dy = 290
    expect(d3.labels.find(l => l.id === 'l1')).toMatchObject({ x: 145, y: 400 })
    // w1 只有一端(n1)动了:拐点不动
    expect(d3.wires[0]!.vertices).toEqual([[120, 180]])
  })
  it('母线与分组框用各自的包围盒参与', () => {
    const d = run('left', { nodes: ['n3'], buses: ['b1'], frames: ['f1'] })
    expect(d.buses[0]).toMatchObject({ x1: 50, x2: 250 })
    expect(pos(d, 'n3')[0]).toBe(50)
    expect(d.frames![0]!.x).toBe(50)
    const d2 = run('top', { buses: ['b1'], frames: ['f1'] })
    expect(d2.frames![0]!.y).toBe(300)
    expect(d2.buses[0]).toMatchObject({ y1: 300, y2: 300 })
  })
  it('不足 2 个 / 已经对齐:返回 false 不改', () => {
    const d = doc()
    expect(applyAlign(d, sel({ nodes: ['n1'] }), 'left', lookupSldSymbol)).toBe(false)
    d.nodes[1]!.x = 100
    expect(applyAlign(d, sel({ nodes: ['n1', 'n2'] }), 'left', lookupSldSymbol)).toBe(false)
  })
})

describe('等距', () => {
  it('水平等距:首尾不动,中间按间隙相等排并吸附;少于 3 个不动', () => {
    const d = doc()
    d.nodes[1]!.x = 150 // 100..140、150..190、400..440:间隙 (340 − 120) / 2 = 110 → n2.x = 250
    applyAlign(d, sel({ nodes: ['n1', 'n2', 'n3'] }), 'hspace', lookupSldSymbol)
    expect(['n1', 'n2', 'n3'].map(id => pos(d, id)[0])).toEqual([100, 250, 400])
    expect(alignDeltas(alignItems(doc(), sel({ nodes: ['n1', 'n2'] }), lookupSldSymbol), 'hspace').size).toBe(0)
  })
  it('垂直等距:按中心排序,与选择顺序无关', () => {
    const d = doc()
    d.nodes[0]!.y = 0
    d.nodes[1]!.y = 50
    d.nodes[2]!.y = 300 // 0..60、50..110、300..360:间隙 (360 − 180) / 2 = 90 → n2.y = 150
    applyAlign(d, sel({ nodes: ['n3', 'n1', 'n2'] }), 'vspace', lookupSldSymbol)
    expect(['n1', 'n2', 'n3'].map(id => pos(d, id)[1])).toEqual([0, 150, 300])
  })
})

function fakeCtx(content: SldEditorContent) {
  const store = createSldStore(content)
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

describe('工具与菜单', () => {
  const tool = ext.tools![0]!
  it('enabled:≥ 2 个图元 / 母线 / 分组框且非只读;连线与标签不算', () => {
    const { ctx, store, ro } = fakeCtx({ doc: doc(), bindings: {} })
    store.select({ nodes: ['n1'], wires: ['w1'], labels: ['l2'] })
    expect(tool.enabled!(ctx)).toBe(false)
    store.select({ nodes: ['n1'], buses: ['b1'] })
    expect(tool.enabled!(ctx)).toBe(true)
    ro.value = true
    expect(tool.enabled!(ctx)).toBe(false)
  })
  it('菜单:等距在 2 个时禁用;点一项 = 一步撤销;只读全禁用', async () => {
    const { ctx, store, ro } = fakeCtx({ doc: doc(), bindings: {} })
    store.select({ nodes: ['n1', 'n2'] })
    const w = mount(AlignMenu, { global: { provide: { [SLD_EDITOR_CTX as symbol]: ctx } } })
    expect(w.find('[data-align]').exists()).toBe(false)
    void tool.run(ctx)
    await nextTick()
    expect(tool.active!(ctx)).toBe(true)
    expect(w.find('[data-align=hspace]').attributes('disabled')).toBeDefined()
    await w.find('[data-align=top]').trigger('click')
    expect(store.undoLabel.value).toBe('顶对齐')
    expect(store.content.value.doc.nodes[1]!.y).toBe(100)
    ro.value = true
    await nextTick()
    expect(w.findAll('[data-align]').every(b => b.attributes('disabled') !== undefined)).toBe(true)
    void tool.run(ctx)
    expect(alignMenu(ctx).open).toBe(false)
    w.unmount()
  })
})
