// T5.6 绑定面板组件:只读禁用、无设备树降级、角标、概览跳转、拖入设备(drops)
import { describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { ref, shallowRef, type ShallowRef } from 'vue'
import { getSldSymbol, nodeBox, registerBuiltinSldSymbols, type SldSelection } from '@grid/scada-renderer'
import { SLD_EDITOR_CTX, type SldEditorContent, type SldEditorContext, type SldEditorHost } from '../src/sld-editor/ext'
import { emptySelection } from '../src/sld-editor/store'
import { makeMockContent } from '../src/sld-editor/dev/mock'
import BindingPanel from '../src/sld-editor/panels/binding/BindingPanel.vue'
import bindingExt from '../src/sld-editor/panels/binding/index'
import { mockHost } from '../src/sld-editor/panels/binding/dev-mock'
import { ENTITY_DRAG_TYPE, centerSpot } from '../src/sld-editor/panels/binding/drop'

registerBuiltinSldSymbols()

interface FakeCtx extends SldEditorContext {
  selectSpy: ReturnType<typeof vi.fn>
  /** 可写的选择集(测试里直接换) */
  sel: ShallowRef<SldSelection>
  labels: string[]
}

/** 假的编辑器上下文:apply = 深拷贝 → recipe → 整体换新(与 store 同口径,不做校验) */
function makeCtx(
  opts: { content?: SldEditorContent; host?: SldEditorHost; readonly?: boolean; sel?: Partial<SldSelection> } = {}
): FakeCtx {
  const content = shallowRef<SldEditorContent>(opts.content ?? makeMockContent())
  const selection = shallowRef<SldSelection>({ ...emptySelection(), ...opts.sel })
  const readonly = ref(!!opts.readonly)
  const counters: Record<string, number> = {}
  const labels: string[] = []
  const selectSpy = vi.fn((sel: Partial<SldSelection>, _opts?: { center?: boolean }) => {
    selection.value = { ...emptySelection(), ...sel }
  })
  return {
    content,
    selection,
    sel: selection,
    readonly,
    labels,
    selectSpy,
    apply(recipe, label = '修改') {
      if (readonly.value) return false
      const draft = JSON.parse(JSON.stringify(content.value)) as SldEditorContent
      if (recipe(draft) === false) return false
      if (JSON.stringify(draft) === JSON.stringify(content.value)) return false
      content.value = draft
      labels.push(label)
      return true
    },
    select: (sel, o) => selectSpy(sel, o),
    newId: kind => {
      counters[kind] = (counters[kind] ?? 100) + 1
      return `${kind}${counters[kind]}`
    },
    toCanvas: p => p,
    view: { zoom: ref(1), fit() {}, zoomBy() {}, resetZoom() {} },
    host: opts.host ?? {},
  }
}

const mountPanel = (ctx: SldEditorContext) =>
  mount(BindingPanel, { global: { provide: { [SLD_EDITOR_CTX as symbol]: ctx, keyCn: () => '' } } })

const panel = bindingExt.panels![0]!

describe('绑定面板', () => {
  it('注册:id binding / order 20 / 注册了 application/x-grid-entity 拖放', () => {
    expect(panel).toMatchObject({ id: 'binding', title: '绑定', order: 20 })
    expect(bindingExt.drops!.map(d => d.type)).toEqual([ENTITY_DRAG_TYPE])
  })

  it('角标 = 选中节点名下未绑引用数', () => {
    const content = makeMockContent()
    delete content.bindings['pt.p2'] // n2(1# 电表)的 P 标签没绑
    const ctx = makeCtx({ content })
    expect(panel.badge!(ctx)).toBeUndefined()
    ctx.sel.value = { ...emptySelection(), nodes: ['n2'] }
    expect(panel.badge!(ctx)).toBe(1)
    ctx.sel.value = { ...emptySelection(), nodes: ['n1'] }
    expect(panel.badge!(ctx)).toBeUndefined()
    ctx.sel.value = { ...emptySelection(), nodes: ['n1', 'n2'] }
    expect(panel.badge!(ctx)).toBeUndefined()
  })

  it('没有设备树:顶部提示,映射表照样能改(取反一步撤销)', async () => {
    const ctx = makeCtx({ sel: { nodes: ['n1'] } })
    const w = mountPanel(ctx)
    expect(w.find('[data-role="no-tree"]').text()).toContain('未连接平台')
    expect(w.find('[data-sec="tree"]').exists()).toBe(false)
    expect(w.find('[data-role="pick-entity"]').attributes('disabled')).toBeDefined()
    await w.find('[data-role="invert"]').trigger('click')
    expect(ctx.content.value.doc.nodes[0]!.state!.map).toEqual({ '1': 'open', '0': 'closed' })
    expect(ctx.labels).toEqual(['状态映射取反'])
    // 格式也能改
    await w.find('[data-role="add-label"]').trigger('click')
    expect(ctx.labels).toEqual(['状态映射取反', '添加数值标签'])
    const input = w.find('[data-field="unit"]')
    ;(input.element as HTMLInputElement).value = 'A'
    await input.trigger('change')
    expect(ctx.content.value.doc.labels.find(l => l.id === 'l101')).toMatchObject({ format: { unit: 'A' } })
  })

  it('有设备树:不提示,出现设备树区', () => {
    const w = mountPanel(makeCtx({ host: mockHost() }))
    expect(w.find('[data-role="no-tree"]').exists()).toBe(false)
    expect(w.find('[data-sec="tree"]').exists()).toBe(true)
  })

  it('只读:整个面板 fieldset disabled,点了也不改文档', async () => {
    const ctx = makeCtx({ readonly: true, sel: { nodes: ['n1'] }, host: mockHost() })
    const w = mountPanel(ctx)
    expect(w.find('fieldset.sld-bd').attributes('disabled')).toBeDefined()
    await w.find('[data-role="invert"]').trigger('click')
    expect(ctx.labels).toEqual([])
  })

  it('概览:已绑 / 未绑个数,点未绑的一条 → 选中并居中', async () => {
    const content = makeMockContent()
    delete content.bindings['pt.p1']
    const ctx = makeCtx({ content })
    const w = mountPanel(ctx)
    expect(w.find('[data-role="summary"]').text()).toMatch(/共 6 处引用 · 已绑 5 · 未绑\s*1/)
    await w.find('[data-role="unbound"]').trigger('click')
    expect(ctx.selectSpy).toHaveBeenCalledWith({ nodes: ['n1'] }, { center: true })
  })

  it('选中独立数值标签:单条编辑', () => {
    const content = makeMockContent()
    content.doc.labels.push({ id: 'l50', x: 0, y: 0, kind: 'value', pt: 'p50', title: 'SOC' })
    const w = mountPanel(makeCtx({ content, sel: { labels: ['l50'] } }))
    expect(w.find('[data-sec="label"]').exists()).toBe(true)
    expect(w.find('[data-label="l50"]').text()).toContain('SOC')
  })
})

describe('从设备树拖设备进画布', () => {
  it('drops:落点建节点,按默认规则加状态测点与数值标签(key 经 host.client 取)', async () => {
    const ctx = makeCtx({ host: mockHost() })
    const data = JSON.stringify({ type: 'DEVICE', name: 'PDR1_LP4_IED1' })
    bindingExt.drops![0]!.onDrop(ctx, data, { x: 900, y: 300 })
    await flushPromises()
    const node = ctx.content.value.doc.nodes.find(n => n.entity?.name === 'PDR1_LP4_IED1')!
    expect(node).toMatchObject({ symbol: 'breaker', x: 900, y: 300, name: 'PDR1_LP4_IED1' })
    expect(ctx.content.value.bindings[`pt.${node.state!.pt}`]).toMatchObject({
      mode: 'ts',
      key: 'switch_state',
      entity: { id: 'mock-PDR1_LP4_IED1' },
    })
    const labels = ctx.content.value.doc.labels.filter(l => l.attach === node.id)
    expect(labels.map(l => (l.kind === 'value' ? l.title : ''))).toEqual(['P', 'Q', 'Ia', 'Ib', 'Ic', 'F'])
    expect(ctx.labels).toEqual(['放置设备 PDR1_LP4_IED1'])
    expect(ctx.selectSpy).toHaveBeenCalledWith({ nodes: [node.id] }, undefined)
  })

  it('没有 client / 数据不合法:只建节点或什么都不做', async () => {
    const ctx = makeCtx()
    const drop = bindingExt.drops![0]!
    drop.onDrop(ctx, 'not json', { x: 0, y: 0 })
    drop.onDrop(ctx, JSON.stringify({ type: 'X', name: 'a' }), { x: 0, y: 0 })
    await flushPromises()
    expect(ctx.labels).toEqual([])
    drop.onDrop(ctx, JSON.stringify({ type: 'DEVICE', name: 'ESS_PCS1' }), { x: 0, y: 0 })
    await flushPromises()
    const node = ctx.content.value.doc.nodes.at(-1)!
    expect(node).toMatchObject({ symbol: 'pcs', entity: { type: 'DEVICE', name: 'ESS_PCS1' } })
    expect(ctx.content.value.doc.labels.filter(l => l.attach === node.id)).toEqual([])
  })

  it('选中设备后出现拖动手柄,dragstart 写入 application/x-grid-entity', async () => {
    const ctx = makeCtx({ host: mockHost() })
    const w = mountPanel(ctx)
    await w.find('[data-role="toggle-tree"]').trigger('click')
    const row = w.findAll('.et-row').find(r => r.text().includes('PDR1_METER1'))
    expect(row).toBeDefined()
    await row!.trigger('click')
    const handle = w.find('[data-role="drag-handle"]')
    expect(handle.attributes('draggable')).toBe('true')
    const setData = vi.fn()
    await handle.trigger('dragstart', { dataTransfer: { setData, effectAllowed: '' } })
    expect(setData).toHaveBeenCalledWith(
      ENTITY_DRAG_TYPE,
      JSON.stringify({ type: 'DEVICE', name: 'PDR1_METER1', deviceType: 'METER' })
    )
  })

  it('放到画布中央:落点不压在已有节点上', () => {
    const ctx = makeCtx()
    const p = centerSpot(ctx, { type: 'DEVICE', name: 'PDR1_LP9_IED1' })
    const size = getSldSymbol('breaker')!
    for (const n of ctx.content.value.doc.nodes) {
      const b = nodeBox(n, getSldSymbol(n.symbol)!)
      const overlap = p.x < b.x + b.w && p.x + size.w > b.x && p.y < b.y + b.h && p.y + size.h > b.y
      expect(overlap, n.id).toBe(false)
    }
    expect((p.x % 10) + (p.y % 10)).toBe(0)
  })
})
