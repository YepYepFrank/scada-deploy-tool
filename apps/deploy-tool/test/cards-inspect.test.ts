/** 卡片库检视(2026-09-17):每张卡左栏用数据源渲染出实时值,右栏数据源摘要 + 前端引用;订阅被拒显示在该卡下;未发布提示。 */
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

import { registerBuiltins, type PageConfig } from '@grid/scada-renderer'
import type { DataSource } from '@grid/tb-client'
import CardsInspect from '../src/components/CardsInspect.vue'

registerBuiltins()
const OK = { type: 'DEVICE', id: 'dev-ok', name: 'SSP1_GP1_IED1' } as const
const SECRET = { type: 'DEVICE', id: 'dev-secret', name: 'BS_1_CK' } as const
const config: PageConfig = {
  schemaVersion: 1,
  template: 'cards',
  widgets: [
    {
      id: 'w_txt',
      slot: 'c02',
      type: 'text',
      props: { title: '文本卡', content: 'P={{value}}' },
      bindings: { value: { mode: 'ts', entity: OK, key: 'P' } },
    },
    {
      id: 'w_den',
      slot: 'c01',
      type: 'number-card',
      props: { title: '无权的卡' },
      bindings: { value: { mode: 'ts', entity: SECRET, key: 'P' } },
    },
  ],
}
function fakeSource(): DataSource {
  return {
    status: 'live',
    onStatus: cb => {
      cb('live')
      return () => {}
    },
    subscribeTs: (entity, keys, cb, onError) => {
      if (entity.id === SECRET.id) queueMicrotask(() => onError?.(new Error('TB 订阅被拒绝(2):Failed to fetch data!')))
      else queueMicrotask(() => cb(keys.map(key => ({ key, points: [{ ts: 1, value: 42.5 }] }))))
      return () => {}
    },
    subscribeAttr: () => () => {},
    subscribeAlarms: () => () => {},
    getHistory: async () => ({}),
    getLatest: async () => ({}),
  }
}
const flush = async () => {
  for (let i = 0; i < 6; i++) await Promise.resolve()
  await nextTick()
}

describe('CardsInspect', () => {
  it('按格排序;左栏实时值渲染出来;被拒的卡显示报错;右栏数据源摘要与引用;复制', async () => {
    const written: string[] = []
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: async (t: string) => void written.push(t) },
      configurable: true,
    })
    const w = mount(CardsInspect, { props: { config, pageId: 'asset-cards', dataSource: fakeSource() } })
    await flush()
    const rows = w.findAll('.ci-row')
    expect(rows.map(r => r.attributes('data-card'))).toEqual(['w_den', 'w_txt'])
    expect(rows[1]!.text()).toContain('P=42.5') // 实时值
    expect(rows[1]!.text()).toContain('value = ts SSP1_GP1_IED1.P') // 数据源摘要
    expect(rows[0]!.find('[data-role="ci-error"]').text()).toContain('订阅被拒绝')
    expect(rows[1]!.find('[data-role="ci-error"]').exists()).toBe(false)
    expect(rows[1]!.text()).toContain('asset-cards')
    expect(rows[1]!.findAll('.sr-widget [data-role="expand"]')).toHaveLength(0) // 检视页不放大
    await rows[1]!.find('[data-role="ci-copy-json"]').trigger('click')
    await nextTick()
    expect(written[0]).toBe('{"pageId":"asset-cards","widgetId":"w_txt"}')
    expect(w.find('[data-role="ci-msg"]').text()).toContain('引用')
    w.unmount()
  })

  it('未发布:没有页面 id、没有复制按钮;design 用 sampleData 不订阅;空库提示', async () => {
    const subscribed = vi.fn()
    const ds = { ...fakeSource(), subscribeTs: subscribed.mockReturnValue(() => {}) } as DataSource
    const w = mount(CardsInspect, { props: { config, pageId: null, dataSource: ds, design: true } })
    await flush()
    expect(subscribed).not.toHaveBeenCalled()
    expect(w.findAll('[data-role="ci-unpublished"]')).toHaveLength(2)
    expect(w.findAll('[data-role="ci-copy-json"]')).toHaveLength(0)
    expect(w.find('[data-role="ci-summary"]').text()).toContain('未发布')
    const empty = mount(CardsInspect, { props: { config: { ...config, widgets: [] }, pageId: null, design: true } })
    expect(empty.find('.ci-empty').exists()).toBe(true)
  })
})
