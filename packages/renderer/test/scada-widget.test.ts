/**
 * <ScadaWidget> 单卡入口(2026-09-14,单卡片嵌入方案 P1):
 * - live:只为这一张卡建订阅,推送后渲染出值,卸载全部退订;
 * - 数据源:prop 优先,否则 provide 注入;
 * - design:sampleData、零订阅;
 * - 未知类型 / 绑定形状错 → 错误态 + emit invalid,不抛到全局;
 * - pickWidget / listWidgetRefs;validateWidgetAgainstRegistry 不传模板时不查槽位。
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import {
  ScadaWidget,
  DATA_SOURCE_KEY,
  pickWidget,
  listWidgetRefs,
  registerBuiltins,
  resetRegistry,
  validateWidgetAgainstRegistry,
} from '../src/index'
import type { PageConfig, WidgetConfig } from '../src/schema/page-config'
import { createMockDataSource } from './mock-data-source'

const DEV = { type: 'DEVICE', id: 'd1', name: '设备一' } as const
const textCard = (): WidgetConfig => ({
  id: 'w_abc12345',
  slot: 'whatever',
  type: 'text',
  props: { content: 'P={{value}}' },
  bindings: { value: { mode: 'ts', entity: DEV, key: 'P' } },
})
const page = (): PageConfig => ({
  schemaVersion: 1,
  template: 'overview-a',
  widgets: [textCard(), { id: 'w_num00001', slot: 's2', type: 'number-card', props: { title: '功率' }, bindings: {} }],
})

beforeEach(() => {
  resetRegistry()
  registerBuiltins()
})

describe('ScadaWidget', () => {
  it('live:只订这一张卡的绑定,推送后渲染出值;卸载后退订数 == 订阅数', async () => {
    const ds = createMockDataSource()
    const w = mount(ScadaWidget, { props: { config: textCard(), dataSource: ds } })
    await nextTick()
    expect(ds.calls.filter(c => c.method === 'subscribeTs')).toHaveLength(1)
    expect(ds.calls[0]!.keys).toEqual(['P'])
    ds.pushTs(DEV, 'P', 'ok')
    await nextTick()
    expect(w.text()).toContain('P=ok')
    const root = w.find('.sr-page.sr-widget-standalone')
    expect(root.exists()).toBe(true)
    expect(root.classes()).toContain('sr-theme-default')
    expect(w.find('.sr-widget').attributes('data-widget')).toBe('w_abc12345')
    expect(w.find('.sr-widget').attributes('data-type')).toBe('text')
    w.unmount()
    expect(ds.unsubscribed()).toBe(1)
  })

  it('数据源从 provide 注入;slot 字段可以没有', async () => {
    const ds = createMockDataSource()
    const { slot: _s, ...noSlot } = textCard()
    const w = mount(ScadaWidget, {
      props: { config: noSlot as WidgetConfig },
      global: { provide: { [DATA_SOURCE_KEY as symbol]: ds } },
    })
    await nextTick()
    expect(ds.calls).toHaveLength(1)
    ds.pushTs(DEV, 'P', 7)
    await nextTick()
    expect(w.text()).toContain('P=7')
    w.unmount()
  })

  it('design:用 sampleData,不建订阅;theme prop 换主题类', async () => {
    const ds = createMockDataSource()
    const w = mount(ScadaWidget, {
      props: { config: page().widgets[1]!, dataSource: ds, design: true, theme: 'light' },
    })
    await nextTick()
    expect(ds.calls).toHaveLength(0)
    expect(w.find('.sr-widget[data-type="number-card"]').exists()).toBe(true)
    expect(w.find('.sr-page').classes()).toContain('sr-theme-light')
    expect(w.text()).toContain('功率')
    w.unmount()
  })

  it('未知组件类型 / 绑定形状错:错误态 + emit invalid,不订阅', async () => {
    const ds = createMockDataSource()
    const bad = mount(ScadaWidget, {
      props: { config: { id: 'x', slot: 's', type: 'nope', bindings: {} }, dataSource: ds },
    })
    await nextTick()
    expect(bad.find('.sr-widget-fatal').exists()).toBe(true)
    expect(bad.text()).toContain('未知组件类型')
    expect(bad.emitted('invalid')?.[0]?.[0]).toEqual([expect.objectContaining({ path: '/widgets/x/type' })])
    expect(ds.calls).toHaveLength(0)
    bad.unmount()

    // line 的 series 是多序列槽位,绑定必须是数组
    const shape = mount(ScadaWidget, {
      props: {
        config: {
          id: 'y',
          slot: 's',
          type: 'line',
          bindings: { series: { mode: 'ts-history', entity: DEV, keys: ['P'], window: '1h' } },
        } as WidgetConfig,
        dataSource: ds,
      },
    })
    await nextTick()
    expect(shape.find('.sr-widget-fatal').exists()).toBe(true)
    expect(ds.calls).toHaveLength(0)
    shape.unmount()
  })

  it('config 换掉时重建订阅:旧的退订、新的订上', async () => {
    const ds = createMockDataSource()
    const w = mount(ScadaWidget, { props: { config: textCard(), dataSource: ds } })
    await nextTick()
    await w.setProps({ config: { ...textCard(), bindings: { value: { mode: 'ts', entity: DEV, key: 'Q' } } } })
    await nextTick()
    expect(ds.unsubscribed()).toBe(1)
    expect(ds.calls.map(c => c.keys?.[0])).toEqual(['P', 'Q'])
    w.unmount()
    expect(ds.unsubscribed()).toBe(2)
  })
})

describe('pickWidget / listWidgetRefs / validateWidgetAgainstRegistry', () => {
  it('按组件 id 取卡,找不到返回 undefined;清单带类型 / 槽位 / 标题', () => {
    const p = page()
    expect(pickWidget(p, 'w_num00001')?.type).toBe('number-card')
    expect(pickWidget(p, 'nope')).toBeUndefined()
    expect(listWidgetRefs(p)).toEqual([
      { id: 'w_abc12345', type: 'text', slot: 'whatever', title: undefined },
      { id: 'w_num00001', type: 'number-card', slot: 's2', title: '功率' },
    ])
  })

  it('单卡校验不传模板时不查槽位,只查类型与绑定', () => {
    const w: WidgetConfig = { id: 'w', slot: 'no-such-slot', type: 'number-card', bindings: {} }
    const issues = validateWidgetAgainstRegistry(w)
    expect(issues.map(i => i.path)).toEqual(['/widgets/w/bindings']) // value 必填缺失
    expect(issues.some(i => i.path.endsWith('/slot'))).toBe(false)
  })
})
