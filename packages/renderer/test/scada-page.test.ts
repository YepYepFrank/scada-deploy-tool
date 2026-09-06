/**
 * <ScadaPage> 与注册表(T1.2 完成标准):
 * - schemaVersion: 2 渲染错误态、emit invalid、不抛到全局;
 * - 注册表校验:未知组件 / 槽位不存在 / multiple 槽位非数组 → 该组件错误态,其他组件照常;
 * - design 模式用 sampleData,不建立订阅;live 模式建立订阅并在卸载时全部退订;
 * - showStatus 默认 false;status 事件抛出。
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import { ScadaPage, registerBuiltins, registerWidget, resetRegistry, validateAgainstRegistry } from '../src/index'
import type { PageConfig } from '../src/schema/page-config'
import { createMockDataSource } from './mock-data-source'

const DEV = { type: 'DEVICE', id: 'd1', name: '设备一' } as const
const base = (): PageConfig => ({
  schemaVersion: 1,
  template: 'overview-a',
  widgets: [
    {
      id: 'w-s1',
      slot: 's1',
      type: 'number-card',
      props: { title: '功率', unit: 'kW' },
      bindings: { value: { mode: 'ts', entity: DEV, key: 'P' } },
    },
    {
      id: 'w-s2',
      slot: 's2',
      type: 'text',
      props: { content: 'CB={{value}}' },
      bindings: { value: { mode: 'attr', entity: DEV, scope: 'SERVER_SCOPE', key: 'CB' } },
    },
    { id: 'w-g1', slot: 'g1', type: 'text', props: { content: '占位' }, bindings: {} },
  ],
})

beforeEach(() => {
  resetRegistry()
  registerBuiltins()
})

describe('validateAgainstRegistry', () => {
  it('未知模板 / 组件 / 槽位、accepts、multiple 数组规则、必填槽位', () => {
    registerWidget({
      type: 'line',
      name: '曲线',
      category: 'chart',
      component: { render: () => null },
      propsSchema: { type: 'object', properties: {} },
      bindingSlots: [
        { name: 'series', valueType: 'series', required: true, multiple: true, modes: ['ts-history', 'ext', 'const'] },
      ],
    })
    const cfg: PageConfig = {
      schemaVersion: 1,
      template: 'nope',
      widgets: [
        { id: 'a', slot: 's1', type: 'unknown-w', bindings: {} },
        { id: 'b', slot: 'zz', type: 'text', bindings: {} },
        { id: 'c', slot: 's1', type: 'line', bindings: { series: { mode: 'const', value: [] } } }, // multiple 但非数组
        { id: 'd', slot: 'g1', type: 'number-card', bindings: {} }, // 必填 value 缺失
        { id: 'e', slot: 'g2', type: 'text', bindings: { value: { mode: 'alarm', entity: DEV } } }, // mode 不允许
      ],
    }
    const issues = validateAgainstRegistry(cfg)
    const errs = issues.filter(i => i.level === 'error').map(i => i.path)
    expect(errs).toContain('/template')
    expect(errs).toContain('/widgets/a/type')
    expect(errs).toContain('/widgets/c/bindings/series')
    expect(errs).toContain('/widgets/d/bindings')
    expect(errs).toContain('/widgets/e/bindings/value')
    // 模板未知时不再判 slot;换成已知模板再验槽位与 accepts
    const cfg2: PageConfig = {
      ...cfg,
      template: 'overview-a',
      widgets: [cfg.widgets[1]!, { id: 'f', slot: 's1', type: 'line', bindings: { series: [] } }],
    }
    const errs2 = validateAgainstRegistry(cfg2)
      .filter(i => i.level === 'error')
      .map(i => i.message)
    expect(errs2.some(m => m.includes('没有槽位 "zz"'))).toBe(true)
    expect(errs2.some(m => m.includes('不接受组件 "line"'))).toBe(true)
    expect(errs2.some(m => m.includes('必填槽位 "g1"'))).toBe(true)
  })
})

describe('<ScadaPage>', () => {
  it('schemaVersion 不为 1:渲染错误态并 emit invalid,不抛错', async () => {
    const cfg = { ...base(), schemaVersion: 2 } as unknown as PageConfig
    const w = mount(ScadaPage, { props: { config: cfg } })
    await nextTick()
    expect(w.find('.sr-fatal').exists()).toBe(true)
    expect(w.text()).toContain('schemaVersion')
    const ev = w.emitted('invalid')
    expect(ev?.[0]?.[0]).toEqual([{ path: '/schemaVersion', message: expect.stringContaining('2') }])
  })

  it('design 模式:用 sampleData 渲染,不建立订阅;空槽位显示占位', async () => {
    const ds = createMockDataSource()
    const w = mount(ScadaPage, { props: { config: base(), dataSource: ds, design: true } })
    await nextTick()
    expect(ds.calls).toHaveLength(0)
    expect(w.find('[data-widget="w-s1"] .sr-number-val').text()).toBe('42.5')
    expect(w.find('[data-widget="w-s2"] .sr-text').text()).toBe('CB=示例文本')
    expect(w.findAll('.sr-slot-empty').length).toBeGreaterThan(0)
    expect(w.find('.sr-root').attributes('data-template')).toBe('overview-a')
  })

  it('live 模式:订阅并响应推送;卸载时全部退订;showStatus 默认关、status 事件抛出', async () => {
    const ds = createMockDataSource()
    const w = mount(ScadaPage, { props: { config: base(), dataSource: ds } })
    await nextTick()
    expect(ds.calls.filter(c => c.method === 'subscribeTs')).toHaveLength(1)
    expect(ds.calls.filter(c => c.method === 'subscribeAttr')).toHaveLength(1)
    expect(w.find('[data-widget="w-s1"] .sr-number-val').text()).toBe('1.0')
    ds.pushTs(DEV, 'P', '43.26')
    await nextTick()
    expect(w.find('[data-widget="w-s1"] .sr-number-val').text()).toBe('43.3')
    ds.pushAttr(DEV, 'CB', '合闸')
    await nextTick()
    expect(w.find('[data-widget="w-s2"] .sr-text').text()).toBe('CB=合闸')

    expect(w.find('.sr-status').exists()).toBe(false)
    ds.setStatus('offline')
    await nextTick()
    expect(w.emitted('status')?.[0]).toEqual(['offline'])
    expect(w.find('.sr-status').exists()).toBe(false) // 默认不显示徽标
    await w.setProps({ showStatus: true })
    await nextTick()
    expect(w.find('.sr-status').attributes('data-status')).toBe('offline')

    const subs = ds.calls.filter(c => c.method.startsWith('subscribe')).length
    w.unmount()
    expect(ds.unsubscribed()).toBe(subs)
  })

  it('注册表错误只影响对应组件:其余照常渲染,问题列表可见', async () => {
    const cfg = base()
    cfg.widgets.push({ id: 'w-bad', slot: 's3', type: 'no-such', bindings: {} })
    const w = mount(ScadaPage, { props: { config: cfg, design: true } })
    await nextTick()
    expect(w.find('[data-widget="w-s1"]').exists()).toBe(true)
    expect(w.find('[data-widget="w-bad"]').exists()).toBe(false)
    expect(w.find('.sr-issues').text()).toContain('w-bad')
    expect(w.emitted('invalid')?.[0]?.[0]).toEqual([expect.objectContaining({ path: '/widgets/w-bad/type' })])
  })

  it('绑定失败:组件显示错误态,页面不崩', async () => {
    const ds = createMockDataSource()
    ds.subscribeTs = () => {
      throw new Error('403')
    }
    const w = mount(ScadaPage, { props: { config: base(), dataSource: ds } })
    await nextTick()
    expect(w.find('[data-widget="w-s1"] .sr-number-err').exists()).toBe(true)
    expect(w.find('[data-widget="w-s2"] .sr-text').exists()).toBe(true)
  })
})

describe('0.2.0 打磨(T3.9)', () => {
  beforeEach(() => {
    resetRegistry()
    registerBuiltins()
  })

  it('运行态不显示空槽位占位,design 模式才显示', async () => {
    const cfg: PageConfig = {
      schemaVersion: 1,
      template: 'overview-a',
      title: 't',
      widgets: [
        // 用 text 而不是 line:scada-page 测试没 mock echarts,happy-dom 没有 canvas
        { id: 'w-g1', type: 'text', slot: 'g1', props: { content: '占位' }, bindings: {} },
      ],
    }
    const run = mount(ScadaPage, { props: { config: cfg, dataSource: createMockDataSource() } })
    await nextTick()
    expect(run.findAll('.sr-slot-placeholder')).toHaveLength(0)
    expect(run.findAll('.sr-slot-empty').length).toBeGreaterThan(0)
    const design = mount(ScadaPage, { props: { config: cfg, design: true } })
    await nextTick()
    expect(design.findAll('.sr-slot-placeholder').length).toBeGreaterThan(0)
  })

  it('scaled 模板根节点带 --sr-scale,grid 模板为 1', async () => {
    const mk = (template: string): PageConfig => ({ schemaVersion: 1, template, title: 't', widgets: [] })
    const scaled = mount(ScadaPage, { props: { config: mk('overview-a'), design: true } })
    await nextTick()
    expect(scaled.find('.sr-root').attributes('style')).toMatch(/--sr-scale: ?[\d.]+/)
    const grid = mount(ScadaPage, { props: { config: mk('grid-3x3'), design: true } })
    await nextTick()
    expect(grid.find('.sr-root').attributes('style')).toMatch(/--sr-scale: ?1/)
  })
})
