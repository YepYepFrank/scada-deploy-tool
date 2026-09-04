/**
 * T2.1 组件:每个组件三态——空态(无绑定 / 无数据)、错误态(绑定失败)、正常值(DOM 含格式化后的数值)。
 * ECharts 在 happy-dom 里没有 canvas,整体 mock 掉 echarts/core,同时断言 setOption 收到的 series 名。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'

const setOption = vi.fn()
vi.mock('echarts/core', () => ({
  init: () => ({ setOption, resize: vi.fn(), dispose: vi.fn() }),
  use: () => {},
  color: { modifyAlpha: (c: string) => c },
  graphic: { LinearGradient: class {} },
}))
vi.mock('echarts/charts', () => ({ LineChart: {}, BarChart: {}, GaugeChart: {} }))
vi.mock('echarts/components', () => ({ GridComponent: {}, TooltipComponent: {}, LegendComponent: {} }))
vi.mock('echarts/renderers', () => ({ CanvasRenderer: {} }))

import {
  numberCardWidget,
  gaugeWidget,
  lineWidget,
  dualAxisWidget,
  overviewCardWidget,
  alarmListWidget,
  textWidget,
  builtinWidgets,
} from '../src/index'

beforeEach(() => setOption.mockClear())

const lastOption = () =>
  setOption.mock.calls[setOption.mock.calls.length - 1]?.[0] as
    { series?: { name?: string; type?: string; data?: unknown[] }[] } | undefined
const seriesOf = () => (lastOption()?.series ?? []) as { name?: string; type?: string; data?: unknown[] }[]

describe('组件定义完整性', () => {
  it('每个内置组件都有 propsSchema / bindingSlots / sampleData,且 sampleData 覆盖必填槽位', () => {
    for (const w of builtinWidgets) {
      expect(w.propsSchema.type).toBe('object')
      expect(w.bindingSlots.length).toBeGreaterThan(0)
      const sample = w.sampleData?.() ?? {}
      for (const s of w.bindingSlots) if (s.required) expect(sample, `${w.type}.${s.name}`).toHaveProperty(s.name)
      // multiple 槽位的 sampleData 必须是数组
      for (const s of w.bindingSlots)
        if (s.multiple && s.name in sample) expect(Array.isArray(sample[s.name])).toBe(true)
    }
  })
})

describe('number-card', () => {
  it('空态 / 错误态 / 正常值', async () => {
    const C = numberCardWidget.component
    const empty = mount(C, { props: { title: '功率', unit: 'kW', values: {} } })
    expect(empty.find('.sr-number-empty').exists()).toBe(true)
    const err = mount(C, { props: { title: '功率', values: {}, errors: { value: '403' } } })
    expect(err.find('.sr-number-err').exists()).toBe(true)
    const ok = mount(C, { props: { title: '功率', unit: 'kW', decimals: 2, values: { value: '43.256' } } })
    expect(ok.find('.sr-number-val').text()).toBe('43.26')
    expect(ok.find('.sr-number-unit').text()).toBe('kW')
    await ok.setProps({ values: { value: 44 } })
    await nextTick()
    expect(ok.find('.sr-number-val').text()).toBe('44.00')
  })
})

describe('gauge', () => {
  it('把值和量程交给 ECharts;空值显示 ——', async () => {
    const C = gaugeWidget.component
    const w = mount(C, { props: { title: 'SOC', unit: '%', min: 0, max: 100, values: { value: 63.5 } } })
    await nextTick()
    const s = seriesOf()[0] as { type?: string; min?: number; max?: number; data?: { value: number }[] }
    expect(s.type).toBe('gauge')
    expect([s.min, s.max]).toEqual([0, 100])
    expect(s.data?.[0]?.value).toBe(63.5)
    expect(w.find('.sr-side-v').text()).toContain('63.5')
    const empty = mount(C, { props: { title: 'SOC', values: {} } })
    expect(empty.find('.sr-side-v').text()).toBe('——')
    const err = mount(C, { props: { title: 'SOC', values: {}, errors: { value: 'x' } } })
    expect(err.find('.sr-side-err').exists()).toBe(true)
  })
})

describe('line', () => {
  it('多序列 → 多条 series,名称与顺序一致;bar 样式;空数据提示', async () => {
    const C = lineWidget.component
    const pts = (n: number) => Array.from({ length: n }, (_, i) => ({ ts: i * 1000, value: i }))
    const w = mount(C, {
      props: {
        title: '功率',
        unit: 'kW',
        values: {
          series: [
            { name: 'P', points: pts(3) },
            { name: 'Q', points: pts(2) },
          ],
        },
      },
    })
    await nextTick()
    expect(seriesOf().map(s => s.name)).toEqual(['P', 'Q'])
    expect(seriesOf()[0]!.type).toBe('line')
    expect(seriesOf()[0]!.data).toHaveLength(3)
    expect(w.find('.sr-side-v').text()).toContain('2.0') // 首序列最后值
    await w.setProps({ style: 'bar' })
    await nextTick()
    expect(seriesOf()[0]!.type).toBe('bar')
    const empty = mount(C, { props: { title: '功率', values: { series: [] } } })
    expect(empty.find('.sr-empty-hint').text()).toBe('暂无数据')
    const err = mount(C, { props: { title: '功率', values: {}, errors: { series: '未实现 ext' } } })
    expect(err.find('.sr-side-err').exists()).toBe(true)
  })
})

describe('dual-axis', () => {
  it('primary 左轴 / secondary 右轴', async () => {
    const C = dualAxisWidget.component
    mount(C, {
      props: {
        title: 'P/Q',
        values: {
          primary: { name: 'P', points: [{ ts: 1, value: 10 }] },
          secondary: { name: 'Q', points: [{ ts: 1, value: 2 }] },
        },
      },
    })
    await nextTick()
    const s = seriesOf() as { name?: string; yAxisIndex?: number }[]
    expect(s.map(x => [x.name, x.yAxisIndex])).toEqual([
      ['P', 0],
      ['Q', 1],
    ])
  })
})

describe('overview-card', () => {
  it('items 每项一行:标签 / 值 / 单位;空态提示', () => {
    const C = overviewCardWidget.component
    const w = mount(C, {
      props: {
        title: '概览',
        items: [
          { label: '总有功', unit: 'kW', decimals: 0 },
          { label: '功率因数', decimals: 2 },
        ],
        values: {
          items: [
            { name: 'P', value: 1234.56 },
            { name: 'PF', value: 0.9712 },
            { name: 'X', value: null },
          ],
        },
      },
    })
    const rows = w.findAll('.sr-ov-row')
    expect(rows).toHaveLength(3)
    expect(rows[0]!.find('.sr-ov-label').text()).toBe('总有功')
    expect(rows[0]!.find('.sr-ov-val').text()).toBe('1235kW')
    expect(rows[1]!.find('.sr-ov-val').text()).toBe('0.97')
    expect(rows[2]!.find('.sr-ov-label').text()).toBe('X') // 无 props 配置回落到序列名
    expect(rows[2]!.find('.sr-ov-val').text()).toBe('——')
    const empty = mount(C, { props: { title: '概览', values: {} } })
    expect(empty.find('.sr-empty-hint').exists()).toBe(true)
  })
})

describe('alarm-list', () => {
  const alarms = alarmListWidget.sampleData!().alarms as { status: string }[]
  it('列表模式:只显示 ACTIVE_*,按时间倒序,maxRows 截断;空态', () => {
    const C = alarmListWidget.component
    const w = mount(C, {
      props: { maxRows: 2, values: { alarms: [...alarms, { ...alarms[0]!, id: 'c', status: 'CLEARED_ACK' }] } },
    })
    const rows = w.findAll('.sr-al-row')
    expect(rows).toHaveLength(2)
    expect(rows[0]!.find('.sr-al-type').text()).toBe('断路器变位') // 最新
    expect(w.find('.sr-side-v').text()).toBe('3')
    const empty = mount(C, { props: { values: { alarms: [] } } })
    expect(empty.find('.sr-empty-hint').text()).toContain('无活动告警')
  })
  it('横幅模式:显示数量与最新一条;无告警显示 ok', () => {
    const C = alarmListWidget.component
    const w = mount(C, { props: { compact: true, values: { alarms } } })
    expect(w.find('.sr-alarm-banner').exists()).toBe(true)
    expect(w.find('.sr-ab-count').text()).toBe('3')
    expect(w.find('.sr-ab-text b').text()).toBe('断路器变位')
    const none = mount(C, { props: { compact: true, values: { alarms: [] } } })
    expect(none.find('.sr-ab-dot.ok').exists()).toBe(true)
  })
})

describe('text', () => {
  it('{{value}} 插值与错误态', () => {
    const C = textWidget.component
    expect(mount(C, { props: { content: 'CB={{value}}', values: { value: '合闸' } } }).text()).toBe('CB=合闸')
    expect(mount(C, { props: { content: '', values: { value: 12 } } }).text()).toBe('12')
    expect(mount(C, { props: { content: 'x', values: {}, errors: { value: 'e' } } }).text()).toBe('数据不可用')
  })
})
