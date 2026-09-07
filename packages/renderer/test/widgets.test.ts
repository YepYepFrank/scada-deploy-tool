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
  statusLightWidget,
  tableWidget,
  imageWidget,
  builtinWidgets,
} from '../src/index'
import { ScadaPage, registerBuiltins, resetRegistry, migrateConfigProps } from '../src/index'

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
    await w.setProps({ chartStyle: 'bar' })
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

describe('status-light', () => {
  it('on / off / unknown 三态与 1/true 等价;错误态', () => {
    const C = statusLightWidget.component
    const on = mount(C, {
      props: { title: 'CB', onValue: '1', onLabel: '合闸', offLabel: '分闸', values: { state: true } },
    })
    expect(on.classes()).toContain('sr-state-on')
    expect(on.find('.sr-sl-label').text()).toBe('合闸')
    const off = mount(C, { props: { onValue: '1', onLabel: '合闸', offLabel: '分闸', values: { state: '0' } } })
    expect(off.classes()).toContain('sr-state-off')
    expect(off.find('.sr-sl-label').text()).toBe('分闸')
    const str = mount(C, { props: { onValue: 'RUN', values: { state: 'RUN' } } })
    expect(str.classes()).toContain('sr-state-on')
    const unknown = mount(C, { props: { values: {} } })
    expect(unknown.classes()).toContain('sr-state-unknown')
    expect(unknown.find('.sr-sl-label').text()).toBe('——')
    const err = mount(C, { props: { values: {}, errors: { state: '403' } } })
    expect(err.find('.sr-sl-err').exists()).toBe(true)
  })
})

describe('table', () => {
  const pts = (vals: number[], step = 86_400_000) =>
    vals.map((v, i) => ({ ts: 1_700_000_000_000 + i * step, value: v }))
  it('latest 模式:每序列一行,标签 / 值 / 单位;空态 / 错误态', () => {
    const C = tableWidget.component
    const w = mount(C, {
      props: {
        mode: 'latest',
        columns: [{ label: 'A 相', unit: 'A', decimals: 0 }],
        values: {
          rows: [
            { name: 'Ia', points: pts([1, 2, 3.4]) },
            { name: 'Ib', points: pts([5.56]) },
          ],
        },
      },
    })
    const rows = w.findAll('tbody tr')
    expect(rows).toHaveLength(2)
    expect(
      rows[0]!
        .findAll('td')
        .map(t => t.text())
        .slice(0, 3)
    ).toEqual(['A 相', '3', 'A'])
    expect(
      rows[1]!
        .findAll('td')
        .map(t => t.text())
        .slice(0, 3)
    ).toEqual(['Ib', '5.6', ''])
    expect(
      mount(C, { props: { values: { rows: [] } } })
        .find('.sr-empty-hint')
        .text()
    ).toBe('暂无数据')
    expect(
      mount(C, { props: { values: {}, errors: { rows: 'x' } } })
        .find('.sr-side-err')
        .exists()
    ).toBe(true)
  })
  it('timeline 模式:按 ts 合并、倒序、maxRows 截断、缺值 ——', () => {
    const C = tableWidget.component
    const w = mount(C, {
      props: {
        mode: 'timeline',
        timeFormat: 'date',
        maxRows: 2,
        columns: [{ label: '收益', unit: '元', decimals: 0 }, { label: '成本' }],
        values: {
          rows: [
            { name: 'rev', points: pts([100, 200, 300]) },
            { name: 'cost', points: pts([10, 20]) },
          ],
        },
      },
    })
    const head = w.findAll('thead th').map(t => t.text())
    expect(head).toEqual(['时间', '收益(元)', '成本'])
    const rows = w.findAll('tbody tr').map(r => r.findAll('td').map(t => t.text()))
    expect(rows).toHaveLength(2)
    expect(rows[0]!.slice(1)).toEqual(['300', '——']) // 最新一天成本缺值
    expect(rows[1]!.slice(1)).toEqual(['200', '20.0'])
    expect(rows[0]![0]).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })
})

describe('image', () => {
  it('props.src / 绑定 src / 未设置 / 错误态 / 加载失败', async () => {
    const C = imageWidget.component
    const a = mount(C, { props: { src: '/a.png', fit: 'cover', values: {} } })
    expect(a.find('img').attributes('src')).toBe('/a.png')
    expect(a.find('img').attributes('style')).toContain('object-fit: cover')
    const b = mount(C, { props: { src: '/a.png', values: { src: '/b.png' } } })
    expect(b.find('img').attributes('src')).toBe('/b.png') // 绑定优先
    expect(
      mount(C, { props: { values: {} } })
        .find('.sr-empty-hint')
        .text()
    ).toBe('未设置图片')
    expect(
      mount(C, { props: { values: {}, errors: { src: 'e' } } })
        .find('.sr-empty-hint')
        .text()
    ).toBe('图片地址不可用')
    await a.find('img').trigger('error')
    expect(a.find('.sr-empty-hint').text()).toBe('图片加载失败')
  })
})

describe('0.2.0:line 的 style → chartStyle 迁移', () => {
  it('migrateProps 把旧键名转成新键名;已是新键名或没有旧键名时原样返回', () => {
    const m = lineWidget.migrateProps!
    expect(m({ style: 'bar', title: 't' })).toEqual({ chartStyle: 'bar', title: 't' })
    expect(m({ chartStyle: 'area', style: 'bar' })).toEqual({ chartStyle: 'area', style: 'bar' })
    const same = { title: 'x' }
    expect(m(same)).toBe(same)
  })

  it('<ScadaPage> 渲染旧配置(props.style)时图表按 chartStyle 画柱状', async () => {
    resetRegistry()
    registerBuiltins()
    setOption.mockClear()
    mount(ScadaPage, {
      props: {
        design: true,
        config: {
          schemaVersion: 1,
          template: 'grid-3x3',
          title: 't',
          widgets: [
            {
              id: 'w1',
              type: 'line',
              slot: 'r1c1',
              props: { title: '旧配置', style: 'bar' },
              bindings: {}, // design 模式用 sampleData 画
            },
          ],
        },
      },
    })
    await nextTick()
    expect(seriesOf()[0]?.type).toBe('bar')
    // 全局字号:grid 模板 --sr-scale=1 → 12
    expect((lastOption() as { textStyle?: { fontSize?: number } }).textStyle?.fontSize).toBe(12)
  })
})

describe('migrateConfigProps(整份配置正规化)', () => {
  it('只改有 migrateProps 且带旧键名的组件;其余组件与输入对象都不动;没变化时返回原引用', () => {
    resetRegistry()
    registerBuiltins()
    const cfg = {
      schemaVersion: 1 as const,
      template: 'grid-3x3',
      title: 't',
      widgets: [
        { id: 'w1', type: 'line', slot: 'r1c1', props: { title: 'a', style: 'area' }, bindings: {} },
        { id: 'w2', type: 'number-card', slot: 'r1c2', props: { title: 'b' }, bindings: {} },
        { id: 'w3', type: 'line', slot: 'r1c3', props: { chartStyle: 'bar' }, bindings: {} },
      ],
    }
    const out = migrateConfigProps(cfg)
    expect(out).not.toBe(cfg)
    expect(out.widgets[0]!.props).toEqual({ title: 'a', chartStyle: 'area' })
    expect(cfg.widgets[0]!.props).toEqual({ title: 'a', style: 'area' })
    expect(out.widgets[1]).toBe(cfg.widgets[1])
    expect(out.widgets[2]).toBe(cfg.widgets[2])
    expect(migrateConfigProps(out)).toBe(out)
  })
})
