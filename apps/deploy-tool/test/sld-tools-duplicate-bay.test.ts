// T5.7 复制间隔 ×N:选择集扩展、方向猜测、默认间距、改名(含分组框标题)、一次 apply 内 doc 与 bindings 同步;对话框
import { describe, expect, it } from 'vitest'
import { nextTick, ref } from 'vue'
import { mount } from '@vue/test-utils'
import {
  lookupSldSymbol,
  registerBuiltinSldSymbols,
  validateSldDoc,
  type Binding,
  type SldDoc,
  type SldSelection,
} from '@grid/scada-renderer'
import { SLD_EDITOR_CTX, type SldEditorContent, type SldEditorContext } from '../src/sld-editor/ext'
import { createSldStore } from '../src/sld-editor/store'
import {
  applyDuplicateBay,
  bayNames,
  clampCount,
  defaultSpacing,
  expandBaySelection,
  guessDirection,
  maxSegments,
  renamePreview,
  stepOf,
} from '../src/sld-editor/tools/duplicate-bay/ops'
import ext from '../src/sld-editor/tools/duplicate-bay/index'
import DuplicateBayDialog from '../src/sld-editor/tools/duplicate-bay/DuplicateBayDialog.vue'
import { bayDialog } from '../src/sld-editor/tools/duplicate-bay/state'
import { makeMockContent } from '../src/sld-editor/dev/mock'

registerBuiltinSldSymbols()

const ts = (name: string, key: string): Binding => ({ mode: 'ts', entity: { type: 'DEVICE', id: 'id-x', name }, key })

/** LP3 那种:垂直母线 b1 + 一条向右的水平出线(简化开关 n1 → 出线箭头 n2),分组框 f1 */
function lp3(): SldEditorContent {
  const doc: SldDoc = {
    v: 1,
    canvas: { w: 1000, h: 800, grid: 10 },
    nodes: [
      {
        id: 'n1',
        symbol: 'switch-simple',
        x: 140,
        y: 90,
        rot: 90,
        name: '办公楼照明1',
        entity: { type: 'DEVICE', name: 'PDR1_LP3_IED1' },
        state: { pt: 'p1', map: { '1': 'closed', '0': 'open' } },
        source: {},
      },
      { id: 'n2', symbol: 'feeder-arrow', x: 220, y: 90, rot: 270 },
      { id: 'n9', symbol: 'junction', x: 600, y: 600, rot: 0 },
    ],
    buses: [{ id: 'b1', x1: 100, y1: 0, x2: 100, y2: 600 }],
    wires: [
      { id: 'w1', from: { bus: 'b1', d: 100 }, to: { node: 'n1', port: 'b' } },
      { id: 'w2', from: { node: 'n1', port: 'a' }, to: { node: 'n2', port: 'a' } },
      { id: 'w9', from: { bus: 'b1', d: 500 }, to: { node: 'n9', port: 'w' } },
    ],
    labels: [
      { id: 'l1', x: 150, y: 70, attach: 'n1', kind: 'text', text: '1# 出线' },
      { id: 'l2', x: 190, y: 70, attach: 'n1', kind: 'value', pt: 'p2', title: 'P' },
      { id: 'l3', x: 500, y: 20, kind: 'text', text: '标题 1' },
    ],
    frames: [{ id: 'f1', x: 120, y: 60, w: 140, h: 60, title: 'LP3' }],
  }
  return { doc, bindings: { 'pt.p1': ts('PDR1_LP3_IED1', 'sw'), 'pt.p2': ts('PDR1_LP3_IED1', 'P') } }
}

const sel = (s: Partial<SldSelection>): SldSelection => ({
  nodes: [],
  buses: [],
  wires: [],
  labels: [],
  frames: [],
  ...s,
})

function fakeCtx(content: SldEditorContent, readonly = false) {
  const store = createSldStore(content)
  const ro = ref(readonly)
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

describe('expandBaySelection', () => {
  it('带上节点之间的线、节点到母线的线、依附标签;母线本身不带', () => {
    const { doc } = lp3()
    const out = expandBaySelection(doc, sel({ nodes: ['n1', 'n2'] }))
    expect(out.nodes).toEqual(['n1', 'n2'])
    expect(out.wires).toEqual(['w1', 'w2'])
    expect(out.labels).toEqual(['l1', 'l2'])
    expect(out.buses).toEqual([])
  })
  it('显式选中的母线 / 分组框 / 自由标签保留;不相干的线不带', () => {
    const { doc } = lp3()
    const out = expandBaySelection(doc, sel({ nodes: ['n1'], buses: ['b1'], frames: ['f1'], labels: ['l3'] }))
    expect(out.buses).toEqual(['b1'])
    expect(out.frames).toEqual(['f1'])
    expect(out.wires).toEqual(['w1']) // w2 另一端 n2 没选;w9 的节点没选
    expect(out.labels).toEqual(['l1', 'l2', 'l3'])
  })
})

describe('guessDirection / defaultSpacing', () => {
  it('接在垂直母线上 → 向下;接在水平母线上 → 向右', () => {
    const { doc } = lp3()
    expect(guessDirection(doc, sel({ nodes: ['n1'] }), lookupSldSymbol)).toBe('down')
    const mock = makeMockContent().doc // 水平母线 b1 + 竖着的出线
    expect(guessDirection(mock, sel({ nodes: ['n1', 'n2', 'n3'] }), lookupSldSymbol)).toBe('right')
  })
  it('不接母线:按包围盒的长边猜', () => {
    const { doc } = lp3()
    expect(guessDirection(doc, sel({ nodes: ['n2'] }), lookupSldSymbol)).toBe('down') // 30 × 20 横长
  })
  it('间距 = 该方向包围盒尺寸 + 20,向上吸附到 10', () => {
    const { doc } = lp3()
    // n1 (rot 90) 40 × 20 在 (140,90);n2 (rot 270) 30 × 20 在 (220,90):并集 110 × 20
    const s = sel({ nodes: ['n1', 'n2'] })
    expect(defaultSpacing(doc, s, 'down', lookupSldSymbol)).toBe(40)
    expect(defaultSpacing(doc, s, 'right', lookupSldSymbol)).toBe(130)
    doc.nodes[1]!.x = 225 // 并集宽 115 → 135 → 140
    expect(defaultSpacing(doc, s, 'right', lookupSldSymbol)).toBe(140)
    expect(defaultSpacing(doc, sel({}), 'right', lookupSldSymbol)).toBe(100)
  })
  it('stepOf', () => {
    expect(stepOf('right', 50, { dx: 1, dy: 2 })).toEqual({ dx: 50, dy: 0 })
    expect(stepOf('down', 50, { dx: 1, dy: 2 })).toEqual({ dx: 0, dy: 50 })
    expect(stepOf('custom', 50, { dx: 10, dy: 20 })).toEqual({ dx: 10, dy: 20 })
  })
})

describe('改名规则与预览', () => {
  it('预览:原名 → 各份新名;段号可选;关掉改名原样', () => {
    expect(renamePreview(['PDR1_LP3_IED1'], 2, { enabled: true })).toEqual([
      { from: 'PDR1_LP3_IED1', to: ['PDR1_LP3_IED2', 'PDR1_LP3_IED3'] },
    ])
    expect(renamePreview(['PDR1_LP3_IED1'], 5, { enabled: true, segment: 1 })[0]!.to).toEqual([
      'PDR1_LP4_IED1',
      'PDR1_LP5_IED1',
      'PDR1_LP6_IED1',
    ])
    expect(renamePreview(['A1'], 2, { enabled: false })[0]!.to).toEqual(['A1', 'A1'])
    expect(maxSegments(['PDR1_LP3_IED1', 'x'])).toBe(3)
  })
  it('bayNames:节点名 + 设备名;开关打开时加分组框标题与文字标签', () => {
    const { doc } = lp3()
    const s = expandBaySelection(doc, sel({ nodes: ['n1'], frames: ['f1'] }))
    expect(bayNames(doc, s, false)).toEqual(['办公楼照明1', 'PDR1_LP3_IED1'])
    expect(bayNames(doc, s, true)).toEqual(['办公楼照明1', 'PDR1_LP3_IED1', 'LP3', '1# 出线'])
  })
  it('clampCount 夹到 1–50', () => {
    expect([clampCount(0), clampCount(3.7), clampCount(99), clampCount(NaN)]).toEqual([1, 3, 50, 1])
  })
})

describe('applyDuplicateBay', () => {
  it('一次 apply:doc 与 bindings 一起加、一起撤销;母线接点按位移换算;结果通过校验', () => {
    const { ctx, store } = fakeCtx(lp3())
    let created: SldSelection[] = []
    const ok = ctx.apply(d => {
      created = applyDuplicateBay(d, sel({ nodes: ['n1', 'n2'] }), {
        count: 3,
        dx: 0,
        dy: 40,
        rule: { enabled: true },
        renameTitles: true,
      })
    }, '复制间隔 ×3')
    expect(ok).toBe(true)
    expect(created).toHaveLength(3)
    const c = store.content.value
    expect(c.doc.nodes).toHaveLength(3 + 6)
    // 第 3 份:接母线的线 d = 100 + 120
    const w1 = c.doc.wires.find(w => w.id === created[2]!.wires[0])!
    expect(w1.from).toEqual({ bus: 'b1', d: 220 })
    // 新绑定:pt 重新编号、实体名 +3、id 置空
    const n = c.doc.nodes.find(x => x.id === created[2]!.nodes[0])!
    expect(n.name).toBe('办公楼照明4')
    expect(c.bindings[`pt.${n.state!.pt}`]).toEqual({
      mode: 'ts',
      entity: { type: 'DEVICE', id: '', name: 'PDR1_LP3_IED4' },
      key: 'sw',
    })
    expect(Object.keys(c.bindings)).toHaveLength(2 + 6)
    // 依附的文字标签按规则改名、数值标签的前缀不动
    const texts = c.doc.labels.filter(l => created[0]!.labels.includes(l.id))
    expect(texts.map(l => (l.kind === 'text' ? l.text : l.title))).toEqual(['2# 出线', 'P'])
    expect(validateSldDoc(c.doc, lookupSldSymbol).filter(i => i.level === 'error')).toEqual([])
    // 撤销一步回到原样
    store.undo()
    expect(store.content.value).toEqual(lp3())
  })

  it('分组框标题按规则改名;关掉开关则不改', () => {
    const d1 = lp3()
    const c1 = applyDuplicateBay(d1, sel({ nodes: ['n1'], frames: ['f1'] }), {
      count: 2,
      dx: 200,
      dy: 0,
      rule: { enabled: true },
      renameTitles: true,
    })
    expect(c1.map(c => d1.doc.frames!.find(f => f.id === c.frames![0])!.title)).toEqual(['LP4', 'LP5'])
    const d2 = lp3()
    const c2 = applyDuplicateBay(d2, sel({ nodes: ['n1'], frames: ['f1'] }), {
      count: 1,
      dx: 200,
      dy: 0,
      rule: { enabled: true },
      renameTitles: false,
    })
    expect(d2.doc.frames!.find(f => f.id === c2[0]!.frames![0])!.title).toBe('LP3')
    const d3 = lp3()
    const c3 = applyDuplicateBay(d3, sel({ nodes: ['n1'] }), {
      count: 1,
      dx: 200,
      dy: 0,
      rule: { enabled: false },
      renameTitles: true,
    })
    expect(d3.doc.nodes.find(n => n.id === c3[0]!.nodes[0])!.name).toBe('办公楼照明1')
  })

  it('空选择:不改草稿,返回空', () => {
    const d = lp3()
    expect(
      applyDuplicateBay(d, sel({}), { count: 2, dx: 10, dy: 0, rule: { enabled: true }, renameTitles: true })
    ).toEqual([])
    expect(d).toEqual(lp3())
  })
})

describe('工具与对话框', () => {
  const tool = ext.tools![0]!

  it('enabled:选中 ≥ 1 个节点且非只读', () => {
    const { ctx, store, ro } = fakeCtx(lp3())
    expect(tool.enabled!(ctx)).toBe(false)
    store.select({ buses: ['b1'] })
    expect(tool.enabled!(ctx)).toBe(false)
    store.select({ nodes: ['n1'] })
    expect(tool.enabled!(ctx)).toBe(true)
    ro.value = true
    expect(tool.enabled!(ctx)).toBe(false)
    expect(tool.shortcut).toBe('ctrl+d')
    expect(tool.group).toBe('bay')
  })

  it('打开后按猜测填默认值;确认 = 一次 apply,选中最后一份并关闭', async () => {
    const { ctx, store, selects } = fakeCtx(lp3())
    store.select({ nodes: ['n1', 'n2'] })
    const w = mount(DuplicateBayDialog, { global: { provide: { [SLD_EDITOR_CTX as symbol]: ctx } } })
    expect(w.find('[role=dialog]').exists()).toBe(false)
    void tool.run(ctx)
    await nextTick()
    expect(w.find('[role=dialog]').exists()).toBe(true)
    expect((w.find('[data-dir=down]').element as HTMLInputElement).checked).toBe(true)
    // 量的是扩展后的选择集:依附标签 l1 / l2 在 y = 70,节点底 110 → 高 40 + 20 = 60
    expect((w.find('[data-field=spacing]').element as HTMLInputElement).value).toBe('60')
    expect(w.find('[data-field=preview]').text()).toContain('PDR1_LP3_IED2')
    await w.find('[data-field=count]').setValue(2)
    await w.find('[data-act=ok]').trigger('click')
    expect(store.canUndo.value).toBe(true)
    expect(store.undoLabel.value).toBe('复制间隔 ×2')
    expect(store.content.value.doc.nodes).toHaveLength(3 + 4)
    const last = selects[selects.length - 1]![0]
    expect(last.nodes).toEqual(['n1_2', 'n2_2'])
    expect(bayDialog(ctx).open).toBe(false)
    await nextTick()
    expect(w.find('[role=dialog]').exists()).toBe(false)
  })

  it('只读:确认按钮禁用并提示', async () => {
    const { ctx, store, ro } = fakeCtx(lp3())
    store.select({ nodes: ['n1'] })
    void tool.run(ctx)
    ro.value = true
    const w = mount(DuplicateBayDialog, { global: { provide: { [SLD_EDITOR_CTX as symbol]: ctx } } })
    await nextTick()
    expect(w.find('[data-act=ok]').attributes('disabled')).toBeDefined()
    expect(w.find('[data-field=readonly]').exists()).toBe(true)
  })

  it('Esc 取消,不改文档', async () => {
    const { ctx, store } = fakeCtx(lp3())
    store.select({ nodes: ['n1'] })
    void tool.run(ctx)
    const w = mount(DuplicateBayDialog, { global: { provide: { [SLD_EDITOR_CTX as symbol]: ctx } } })
    await nextTick()
    await w.find('[role=dialog]').trigger('keydown', { key: 'Escape' })
    expect(bayDialog(ctx).open).toBe(false)
    expect(store.canUndo.value).toBe(false)
  })
})
