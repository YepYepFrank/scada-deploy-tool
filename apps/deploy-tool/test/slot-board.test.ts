// SlotBoard / TemplatePicker / WidgetPicker:注册表驱动的槽位示意图与组件选择。
import { describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'

vi.mock('echarts/core', () => ({
  init: () => ({ setOption: vi.fn(), resize: vi.fn(), dispose: vi.fn() }),
  use: () => {},
  color: { modifyAlpha: (c: string) => c },
  graphic: { LinearGradient: class {} },
}))
vi.mock('echarts/charts', () => ({ LineChart: {}, BarChart: {}, GaugeChart: {} }))
vi.mock('echarts/components', () => ({ GridComponent: {}, TooltipComponent: {}, LegendComponent: {} }))
vi.mock('echarts/renderers', () => ({ CanvasRenderer: {} }))

import { getTemplate, listTemplates, listWidgets, registerBuiltins, type PageConfig } from '@grid/scada-renderer'
import SlotBoard from '../src/editor/SlotBoard.vue'
import TemplatePicker from '../src/editor/TemplatePicker.vue'
import WidgetPicker from '../src/editor/WidgetPicker.vue'
import { slotRects } from '../src/editor/template-geometry'

registerBuiltins()
const empty = (template: string): PageConfig => ({ schemaVersion: 1, template, widgets: [] })

describe('SlotBoard', () => {
  it('monitor-3col:9 个可配槽位 + 横幅都能点,点到哪个就 emit 哪个;选中态落到对应 DOM', async () => {
    const tpl = getTemplate('monitor-3col')!
    const w = mount(SlotBoard, { props: { config: empty('monitor-3col'), template: tpl, selected: null } })
    const slots = w.findAll('.sr-slot[data-slot]')
    expect(slots.map(s => s.attributes('data-slot'))).toEqual([
      'banner',
      'l1',
      'l2',
      'l3',
      'main',
      'c1',
      'c2',
      'r1',
      'r2',
      'r3',
    ])
    for (const s of slots) await s.find('.sr-slot-placeholder').trigger('click')
    expect(w.emitted('select')!.map(e => e[0])).toEqual([
      'banner',
      'l1',
      'l2',
      'l3',
      'main',
      'c1',
      'c2',
      'r1',
      'r2',
      'r3',
    ])
    await w.setProps({ selected: 'main' })
    await nextTick()
    expect(w.find('.sr-slot.ed-selected').attributes('data-slot')).toBe('main')
  })

  it('已配槽位用 sampleData 渲染真组件(不需要绑定)', async () => {
    const tpl = getTemplate('overview-a')!
    const cfg: PageConfig = {
      schemaVersion: 1,
      template: 'overview-a',
      widgets: [{ id: 'n', slot: 's1', type: 'number-card', props: { title: '进线有功' }, bindings: {} }],
    }
    const w = mount(SlotBoard, { props: { config: cfg, template: tpl } })
    await nextTick()
    expect(w.find('.sr-slot[data-slot="s1"] .sr-widget[data-type="number-card"]').exists()).toBe(true)
    expect(w.find('.sr-slot[data-slot="s1"]').text()).toContain('进线有功')
  })
})

describe('WidgetPicker', () => {
  it('main 槽位只列 accepts 内的类型;固定槽位只列固定类型;无 accepts 列全部', () => {
    const tpl = getTemplate('monitor-3col')!
    const widgets = listWidgets()
    const main = tpl.slots.find(s => s.name === 'main')!
    const w = mount(WidgetPicker, { props: { slotDef: main, widgets } })
    const types = w.findAll('[data-widget-type]').map(b => b.attributes('data-widget-type'))
    expect(types.sort()).toEqual([...main.accepts!].sort())
    expect(types).not.toContain('number-card')
    const banner = tpl.slots.find(s => s.name === 'banner')!
    expect(
      mount(WidgetPicker, { props: { slotDef: banner, widgets } })
        .findAll('[data-widget-type]')
        .map(b => b.attributes('data-widget-type'))
    ).toEqual(['alarm-list'])
    const any = mount(WidgetPicker, { props: { slotDef: { name: 'z', area: 'z' }, widgets } })
    expect(any.findAll('[data-widget-type]')).toHaveLength(widgets.length)
  })

  it('点组件 emit pick;有当前组件时可移除', async () => {
    const tpl = getTemplate('overview-a')!
    const w = mount(WidgetPicker, {
      props: { slotDef: tpl.slots.find(s => s.name === 's1')!, widgets: listWidgets(), current: 'gauge' },
    })
    await w.find('[data-widget-type="number-card"]').trigger('click')
    expect((w.emitted('pick')![0]![0] as { type: string }).type).toBe('number-card')
    await w.find('.wp-remove').trigger('click')
    expect(w.emitted('remove')).toHaveLength(1)
  })
})

describe('TemplatePicker / 几何', () => {
  it('三个模板各一张卡片,缩略图矩形数 = 槽位数;grid 模板矩形按 areas 矩阵', async () => {
    const templates = listTemplates()
    const w = mount(TemplatePicker, { props: { templates, modelValue: 'overview-a' } })
    expect(w.findAll('.tp-card')).toHaveLength(templates.length)
    for (const t of templates)
      expect(w.find(`[data-template="${t.id}"]`).findAll('rect.tp-slot')).toHaveLength(t.slots.length)
    expect(w.find('.tp-card.active').attributes('data-template')).toBe('overview-a')
    await w.find('[data-template="grid-3x3"]').trigger('click')
    expect(w.emitted('update:modelValue')![0]).toEqual(['grid-3x3'])
    const rects = slotRects(getTemplate('grid-3x3')!)
    expect(rects.find(r => r.name === 'r2c3')).toMatchObject({ x: 2 / 3, y: 1 / 3, w: 1 / 3, h: 1 / 3 })
    const ov = slotRects(getTemplate('overview-a')!)
    expect(ov.find(r => r.name === 'banner')).toMatchObject({ fixed: true })
    expect(ov.find(r => r.name === 'g1')!.required).toBe(true)
  })
})
