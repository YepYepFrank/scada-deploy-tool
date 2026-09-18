/**
 * 组件事件透传 widget-event(接线图计划 D6 ②,T5.0):
 * 组件内 emit('widget-event', { name, detail }) → ScadaPage / ScadaWidget 补上 widgetId / type 向外抛;
 * 放大层(WidgetExpand)里触发的也从 ScadaPage / ScadaWidget 出去;形状不对的事件被忽略。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'
import { defineComponent, h, nextTick } from 'vue'
import { ScadaPage, ScadaWidget, registerBuiltins, registerWidget, resetRegistry } from '../src/index'
import type { PageConfig, WidgetConfig } from '../src/schema/page-config'
import type { WidgetEventPayload } from '../src/schema/scada-page'
import type { WidgetDefinition } from '../src/schema/registry'

/** 桩组件:三个按钮分别抛带 detail / 不带 detail / 形状不对的事件 */
const Clicker = defineComponent({
  name: 'ClickerStub',
  props: { values: Object, errors: Object, disabled: Boolean },
  emits: ['widget-event'],
  setup(_p, { emit }) {
    return () =>
      h('div', { class: 'clicker' }, [
        h('button', {
          'data-role': 'node',
          onClick: () => emit('widget-event', { name: 'node-click', detail: { nodeId: 'qf1' } }),
        }),
        h('button', { 'data-role': 'plain', onClick: () => emit('widget-event', { name: 'ping' }) }),
        h('button', { 'data-role': 'bad', onClick: () => emit('widget-event', { detail: 1 }) }),
      ])
  },
})
const clickerWidget: WidgetDefinition = {
  type: 'clicker',
  name: '事件桩',
  category: 'diagram',
  component: Clicker,
  propsSchema: { type: 'object', properties: {} },
  bindingSlots: [],
}
const card = (): WidgetConfig => ({ id: 'w_click', slot: 'r1c1', type: 'clicker', bindings: {} })
const page = (): PageConfig => ({ schemaVersion: 1, template: 'grid-3x3', widgets: [card()] })
const NODE_CLICK: WidgetEventPayload = {
  widgetId: 'w_click',
  type: 'clicker',
  name: 'node-click',
  detail: { nodeId: 'qf1' },
}
const events = (w: VueWrapper) => (w.emitted('widget-event') ?? []).map(a => a[0] as WidgetEventPayload)
const overlayBtn = (role: string) =>
  document.body.querySelector<HTMLButtonElement>(`.sr-expand .clicker [data-role="${role}"]`)!

let mounted: VueWrapper[] = []
beforeEach(() => {
  resetRegistry()
  registerBuiltins()
  registerWidget(clickerWidget)
})
afterEach(() => {
  for (const w of mounted) w.unmount()
  mounted = []
  document.body.innerHTML = ''
})

describe('widget-event 透传', () => {
  it('ScadaPage:带 widgetId / type / name / detail 抛出;无 detail 时不带该键;形状不对的忽略', async () => {
    const w = mount(ScadaPage, { props: { config: page(), design: true } })
    mounted.push(w)
    await nextTick()
    await w.find('.clicker [data-role="node"]').trigger('click')
    await w.find('.clicker [data-role="plain"]').trigger('click')
    await w.find('.clicker [data-role="bad"]').trigger('click')
    expect(events(w)).toEqual([NODE_CLICK, { widgetId: 'w_click', type: 'clicker', name: 'ping' }])
    expect('detail' in events(w)[1]!).toBe(false)
  })

  it('ScadaWidget:同样的载荷', async () => {
    const w = mount(ScadaWidget, { props: { config: card(), design: true } })
    mounted.push(w)
    await nextTick()
    await w.find('.clicker [data-role="node"]').trigger('click')
    await w.find('.clicker [data-role="bad"]').trigger('click')
    expect(events(w)).toEqual([NODE_CLICK])
  })

  it('放大层里触发的事件从 ScadaPage 抛出', async () => {
    const w = mount(ScadaPage, { props: { config: page() }, attachTo: document.body })
    mounted.push(w)
    await nextTick()
    await w.find('.sr-widget[data-widget="w_click"] [data-role="expand"]').trigger('click')
    await nextTick()
    overlayBtn('node').click()
    overlayBtn('bad').click()
    await nextTick()
    expect(events(w)).toEqual([NODE_CLICK])
  })

  it('放大层里触发的事件从 ScadaWidget 抛出', async () => {
    const w = mount(ScadaWidget, { props: { config: card() }, attachTo: document.body })
    mounted.push(w)
    await nextTick()
    await w.find('[data-role="expand"]').trigger('click')
    await nextTick()
    overlayBtn('plain').click()
    await nextTick()
    expect(events(w)).toEqual([{ widgetId: 'w_click', type: 'clicker', name: 'ping' }])
  })
})
