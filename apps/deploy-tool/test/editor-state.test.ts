import { describe, expect, it } from 'vitest'
import type { PageConfig, TemplateDefinition, WidgetDefinition } from '@grid/scada-renderer'
import { useEditorState } from '../src/editor/useEditorState'

const initial: PageConfig = { schemaVersion: 1, template: 'overview-a', title: '初始', widgets: [] }
const def = (type: string, defaults: Record<string, unknown> = {}): WidgetDefinition =>
  ({
    type,
    name: type,
    category: 'value',
    component: {},
    propsSchema: { type: 'object', properties: {} },
    bindingSlots: [],
    defaults,
  }) as WidgetDefinition
const tplA: TemplateDefinition = {
  id: 'a',
  name: 'A',
  kind: 'grid',
  areas: ['s1 s2', 'g1 g1'],
  slots: [
    { name: 's1', area: 's1', accepts: ['number-card'] },
    { name: 's2', area: 's2' },
    { name: 'g1', area: 'g1', accepts: ['line'] },
  ],
}
const tplB: TemplateDefinition = {
  id: 'b',
  name: 'B',
  kind: 'grid',
  areas: ['s1 x'],
  slots: [
    { name: 's1', area: 's1', accepts: ['gauge'] },
    { name: 'x', area: 'x', fixed: { type: 'alarm-list' } },
  ],
}

describe('useEditorState', () => {
  it('连续 5 次修改后撤销 5 次回到初始 JSON;重做 5 次回到末态;新修改清空重做栈', () => {
    const ed = useEditorState(initial)
    for (let i = 1; i <= 5; i++) ed.update(d => (d.title = `v${i}`))
    expect(ed.config.value.title).toBe('v5')
    expect(ed.state.pastCount).toBe(5)
    const end = ed.snapshot()
    for (let i = 0; i < 5; i++) expect(ed.undo()).toBe(true)
    expect(ed.undo()).toBe(false)
    expect(ed.config.value).toEqual(initial)
    expect(ed.canUndo.value).toBe(false)
    expect(ed.canRedo.value).toBe(true)
    for (let i = 0; i < 5; i++) ed.redo()
    expect(ed.config.value).toEqual(end)
    ed.undo()
    ed.update(d => (d.title = '分叉'))
    expect(ed.canRedo.value).toBe(false)
  })

  it('快照不可变:外部持有的引用与后续修改互不影响;深度限制生效', () => {
    const ed = useEditorState(initial, { depth: 3 })
    const before = ed.config.value
    ed.update(d => (d.title = 'x'))
    expect(before.title).toBe('初始')
    for (let i = 0; i < 10; i++) ed.update(d => (d.title = `t${i}`))
    expect(ed.state.pastCount).toBe(3)
    let n = 0
    while (ed.undo()) n++
    expect(n).toBe(3)
    expect(ed.config.value.title).toBe('t6')
  })

  it('placeWidget:填默认 props、id 唯一且与槽位无关、同槽位替换;removeWidget;patchWidget', () => {
    const ed = useEditorState(initial)
    const w1 = ed.placeWidget('s1', def('number-card', { title: '默认' }))
    expect(w1).toEqual({
      id: expect.stringMatching(/^w_[0-9a-z]{8}$/),
      slot: 's1',
      type: 'number-card',
      props: { title: '默认' },
      bindings: {},
    })
    const w2 = ed.placeWidget('s2', def('number-card'))
    expect(w2.id).toMatch(/^w_[0-9a-z]{8}$/)
    expect(w2.id).not.toBe(w1.id)
    ed.placeWidget('s1', def('gauge'))
    expect(ed.config.value.widgets.map(w => `${w.slot}:${w.type}`)).toEqual(['s2:number-card', 's1:gauge'])
    ed.patchWidget(w2.id, w => (w.props = { title: '改' }))
    expect(ed.widgetAt('s2')?.props).toEqual({ title: '改' })
    ed.removeWidget('s1')
    expect(ed.config.value.widgets).toHaveLength(1)
    expect(ed.state.pastCount).toBe(5)
  })

  it('组件 id 稳定(2026-09-14 单卡引用):改属性 / 绑定不变;换模板保留的组件 id 不变;换类型才换 id;导入时保留传入 id', () => {
    const ed = useEditorState({ ...initial, template: 'a' })
    const w = ed.placeWidget('s1', def('number-card'))
    ed.setWidgetProps(w.id, { title: '功率' })
    ed.patchWidget(w.id, x => (x.bindings = { value: { mode: 'const', value: 1 } }))
    expect(ed.widgetAt('s1')?.id).toBe(w.id)
    // tplB 的 s1 只收 gauge:number-card 被丢;先换成 tplB 里允许的组合验证「保留即不变」
    const ed2 = useEditorState({ ...initial, template: 'b' })
    const g = ed2.placeWidget('s1', def('gauge'))
    const a = ed2.placeWidget('x', def('alarm-list'))
    expect(ed2.setTemplate(tplB)).toEqual({ moved: [], restored: [], parked: [] })
    expect(ed2.config.value.widgets.map(x => x.id).sort()).toEqual([a.id, g.id].sort())
    // 换类型 = 新组件 = 新 id
    const g2 = ed2.placeWidget('s1', def('number-card'))
    expect(g2.id).not.toBe(g.id)
    // 导入 / 载入已发布页面:传入的旧格式 id 原样保留
    const legacy = ed.placeWidget('s2', def('text'), { id: 'w-s2' })
    expect(legacy.id).toBe('w-s2')
    // 与已有 id 不撞
    const ids = new Set<string>()
    for (let i = 0; i < 200; i++) ids.add(ed.placeWidget('g1', def('line')).id)
    expect(ids.size).toBe(200)
  })

  it('setTemplate(2026-09-21 起不丢组件):放不下的先收起来,换回放得下的模板自动放回原槽位', () => {
    const ed = useEditorState({ ...initial, template: 'a' })
    const n = ed.placeWidget('s1', def('number-card'))
    const t = ed.placeWidget('s2', def('text'))
    const l = ed.placeWidget('g1', def('line'))
    // tplB:s1 只收 gauge、x 固定 alarm-list —— 三个都放不下
    const r1 = ed.setTemplate(tplB)
    expect(ed.config.value.template).toBe('b')
    expect(r1.parked.sort()).toEqual([l.id, n.id, t.id].sort())
    expect(ed.config.value.widgets).toEqual([])
    // 换回 tplA:三个原样回到各自的槽位,属性 / 绑定 / id 都没变
    const r2 = ed.setTemplate(tplA)
    expect(r2.restored.sort()).toEqual([l.id, n.id, t.id].sort())
    expect(r2.parked).toEqual([])
    expect(ed.config.value.widgets.map(w => [w.id, w.slot])).toEqual([
      [n.id, 's1'],
      [t.id, 's2'],
      [l.id, 'g1'],
    ])
  })

  it('setTemplate:槽位名对不上的挪到空着的兼容槽位;固定槽位只放它指定的类型;撤销后再换模板不会放出重复的', () => {
    const tplC: TemplateDefinition = {
      id: 'c',
      name: 'C',
      kind: 'scaled',
      design: { w: 1000, h: 500 },
      slots: [
        { name: 'banner', area: { x: 0, y: 0, w: 1000, h: 50 }, fixed: { type: 'alarm-list' } },
        { name: 'small', area: { x: 0, y: 50, w: 300, h: 200 }, accepts: ['sld', 'text'] },
        { name: 'main', area: { x: 300, y: 50, w: 700, h: 450 }, accepts: ['sld', 'text'] },
      ],
    }
    const ed = useEditorState({ ...initial, template: 'a' })
    const sld = ed.placeWidget('s2', def('sld'), { props: { doc: { marker: '画了半天的图' } } })
    const txt = ed.placeWidget('g1', def('text'))
    const r = ed.setTemplate(tplC)
    // 接线图先挑、挑面积最大的槽位;文本拿剩下的;谁也不进固定槽位
    expect(r.moved).toEqual([
      { id: sld.id, from: 's2', to: 'main' },
      { id: txt.id, from: 'g1', to: 'small' },
    ])
    expect(ed.widgetAt('main')?.props).toEqual({ doc: { marker: '画了半天的图' } })
    expect(ed.widgetAt('banner')).toBeUndefined()
    // 换到放不下的模板 → 收起;撤销(组件回到页面上)→ 再换一次模板,不能出现两份
    ed.setTemplate(tplB)
    expect(ed.config.value.widgets).toEqual([])
    ed.undo()
    expect(ed.config.value.widgets).toHaveLength(2)
    ed.setTemplate(tplC)
    expect(ed.config.value.widgets.map(w => w.id).sort()).toEqual([sld.id, txt.id].sort())
    ed.reset()
    expect(ed.config.value).toEqual({ ...initial, template: 'a' })
    expect(ed.canUndo.value).toBe(false)
  })
})
