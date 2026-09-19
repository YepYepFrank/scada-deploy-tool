// 方案 A(ADR-005 D4 补充,2026-09-19):组件定义声明 receivesBindings 时,三个宿主都把它自己的绑定作为 prop 传入
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { defineComponent, h, nextTick } from 'vue'
import { mount } from '@vue/test-utils'
import { ScadaWidget, registerBuiltins, registerWidget, resetRegistry, widgetPropsOf, type WidgetConfig } from '../src'

const seen: unknown[] = []
const Probe = defineComponent({
  props: { bindings: { type: Object, default: undefined }, values: Object, errors: Object, disabled: Boolean },
  setup(p) {
    return () => {
      seen.push(p.bindings)
      return h('div', { class: 'probe' })
    }
  },
})
const cfg = (type: string): WidgetConfig => ({
  id: 'w1',
  slot: 's',
  type,
  bindings: { v: { mode: 'const', value: 1 } },
})

describe('receivesBindings', () => {
  beforeEach(() => {
    resetRegistry()
    registerBuiltins()
    seen.length = 0
    const base = {
      name: 'probe',
      category: 'value' as const,
      component: Probe,
      propsSchema: { type: 'object' as const, properties: {} },
    }
    registerWidget({
      ...base,
      type: 'probe-on',
      receivesBindings: true,
      bindingSlots: [{ name: 'v', valueType: 'any' }],
    })
    registerWidget({ ...base, type: 'probe-off', bindingSlots: [{ name: 'v', valueType: 'any' }] })
  })
  afterEach(() => resetRegistry())

  it('widgetPropsOf 只对声明了的组件附 bindings', () => {
    expect(widgetPropsOf(cfg('probe-on')).bindings).toEqual({ v: { mode: 'const', value: 1 } })
    expect('bindings' in widgetPropsOf(cfg('probe-off'))).toBe(false)
  })

  it('<ScadaWidget> 把绑定传给声明了的组件;没声明的根元素上不出现 bindings attribute', async () => {
    mount(ScadaWidget, { props: { config: cfg('probe-on'), design: true } })
    await nextTick()
    expect(seen.at(-1)).toEqual({ v: { mode: 'const', value: 1 } })
    const off = mount(ScadaWidget, { props: { config: cfg('probe-off'), design: true } })
    await nextTick()
    expect(off.find('.probe').attributes('bindings')).toBeUndefined()
  })
})
