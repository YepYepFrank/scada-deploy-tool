/**
 * 绑定上下文(0.9.0,方案讨论-BindingContext-2026-09-21 + 庄 09-21 答复):
 * - applyContext 纯函数:实体 / 测点 / 时间范围取自上下文;whenMissing 四态;类型不符;custom.*;
 * - <ScadaWidget> / <ScadaPage>:换设备只重订受影响的卡,固定绑定的卡订阅不动;空态 / 隐藏 / 错误三种显示;
 * - prop 优先于 provide;绝对时间区间只拉历史不追加实时;
 * - 事件:整卡 click 带实体、表格 row-click、告警 alarm-click;
 * - 旧配置(没有任何上下文引用)行为不变;契约 schema 认识新写法。
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'

// happy-dom 没有 canvas:曲线组件要 mock 掉 echarts(同 widgets.test.ts)
vi.mock('echarts/core', () => ({
  init: () => ({ setOption: vi.fn(), resize: vi.fn(), dispose: vi.fn() }),
  use: () => {},
  color: { modifyAlpha: (c: string) => c },
  graphic: { LinearGradient: class {} },
}))
vi.mock('echarts/charts', () => ({ LineChart: {}, BarChart: {}, GaugeChart: {} }))
vi.mock('echarts/components', () => ({ GridComponent: {}, TooltipComponent: {}, LegendComponent: {} }))
vi.mock('echarts/renderers', () => ({ CanvasRenderer: {} }))

import { flushPromises, mount } from '@vue/test-utils'
import { defineComponent, h, nextTick, reactive } from 'vue'
import {
  ScadaPage,
  ScadaWidget,
  applyContext,
  contextKeysOf,
  provideBindingContext,
  registerBuiltins,
  resetRegistry,
  validatePageConfig,
  validateWidgetAgainstRegistry,
  type BindingContext,
} from '../src/index'
import type { PageConfig, WidgetConfig } from '../src/schema/page-config'
import { createMockDataSource } from './mock-data-source'

const D1 = { type: 'DEVICE', id: 'd1', name: '1# PCS' } as const
const D2 = { type: 'DEVICE', id: 'd2', name: '2# PCS' } as const
const SITE = { type: 'ASSET', id: 'site1', name: '站点' } as const
const SEL = { source: 'context', key: 'selectedDevice', type: 'DEVICE' } as const

const numCard = (over: Partial<WidgetConfig> = {}): WidgetConfig => ({
  id: 'w_ctx',
  slot: 's1',
  type: 'number-card',
  props: { title: '实时功率' },
  bindings: { value: { mode: 'ts', entity: SEL, key: 'P' } },
  ...over,
})
const fixedCard = (): WidgetConfig => ({
  id: 'w_fixed',
  slot: 's2',
  type: 'number-card',
  props: { title: '全站功率' },
  bindings: { value: { mode: 'ts', entity: SITE, key: 'P_total' } },
})
const lineCard = (window: unknown, key: unknown = 'P'): WidgetConfig =>
  ({
    id: 'w_line',
    slot: 'g1',
    type: 'line',
    props: { title: '趋势' },
    bindings: { series: [{ mode: 'ts-history', entity: SEL, keys: [key], window }] },
  }) as WidgetConfig
const page = (widgets: WidgetConfig[]): PageConfig => ({ schemaVersion: 1, template: 'overview-a', widgets })

beforeEach(() => {
  resetRegistry()
  registerBuiltins()
})

describe('applyContext(纯函数)', () => {
  it('没有上下文引用的卡原样返回同一个对象', () => {
    const w = fixedCard()
    const r = applyContext(w, null)
    expect(r.status).toBe('ok')
    expect(r.widget).toBe(w)
    expect(r.keys).toEqual([])
  })

  it('实体取自上下文;名字跟着上下文走', () => {
    const r = applyContext(numCard(), { selectedDevice: D2 })
    expect(r.status).toBe('ok')
    expect(r.widget!.bindings.value).toEqual({ mode: 'ts', entity: D2, key: 'P' })
    expect(r.keys).toEqual(['selectedDevice'])
  })

  it('缺上下文:缺省 empty「未选择设备」;hide / error;fallback 用兜底实体', () => {
    expect(applyContext(numCard(), {})).toMatchObject({ status: 'empty', message: '未选择设备' })
    expect(applyContext(numCard(), { selectedDevice: null })).toMatchObject({ status: 'empty' })
    const withMode = (whenMissing: string, fallback?: unknown) =>
      numCard({ bindings: { value: { mode: 'ts', entity: { ...SEL, whenMissing, fallback }, key: 'P' } } as never })
    expect(applyContext(withMode('hide'), {}).status).toBe('hide')
    expect(applyContext(withMode('error'), {})).toMatchObject({ status: 'error' })
    const fb = applyContext(withMode('fallback', D1), {})
    expect(fb.status).toBe('ok')
    expect((fb.widget!.bindings.value as { entity: unknown }).entity).toEqual(D1)
    // 给了 fallback 但 whenMissing 不是 fallback:样例设备不会悄悄成为默认值
    expect(applyContext(withMode('empty', D1), {}).status).toBe('empty')
    // fallback 模式却没给 fallback → 错误
    expect(applyContext(withMode('fallback'), {}).status).toBe('error')
  })

  it('类型不符 / 形状不对 → error,不去订阅', () => {
    expect(applyContext(numCard(), { selectedDevice: SITE as never })).toMatchObject({
      status: 'error',
      message: expect.stringContaining('需要 DEVICE,给的是 ASSET'),
    })
    expect(applyContext(numCard(), { selectedDevice: { id: 'x' } as never }).status).toBe('error')
  })

  it('测点取自上下文:字符串或 { key, label };custom.* 键', () => {
    const w = numCard({
      bindings: {
        value: {
          mode: 'ts',
          entity: { source: 'context', key: 'custom.selectedTu' },
          key: { source: 'context', key: 'selectedMeasurePoint' },
        },
      },
    })
    expect(contextKeysOf([w])).toEqual(['custom.selectedTu', 'selectedMeasurePoint'])
    expect(applyContext(w, { custom: { selectedTu: D1 } })).toMatchObject({ status: 'empty', message: '未选择测点' })
    const r = applyContext(w, { custom: { selectedTu: D1 }, selectedMeasurePoint: { key: 'Ua', label: 'A 相电压' } })
    expect(r.widget!.bindings.value).toEqual({ mode: 'ts', entity: D1, key: 'Ua', label: 'A 相电压' })
    expect(
      applyContext(w, { custom: { selectedTu: D1 }, selectedMeasurePoint: 'Ub' }).widget!.bindings.value
    ).toMatchObject({
      key: 'Ub',
    })
  })

  it('时间范围:窗口字面量 / 绝对区间(毫秒、ISO、Date 都收)/ 非法值', () => {
    const w = lineCard({ source: 'context', key: 'timeRange' })
    const ctx = (timeRange: unknown) => ({ selectedDevice: D1, timeRange }) as BindingContext
    const win = (r: ReturnType<typeof applyContext>) => (r.widget!.bindings.series as { window: unknown }[])[0]!.window
    expect(win(applyContext(w, ctx('7d')))).toBe('7d')
    expect(win(applyContext(w, ctx({ from: 1000, to: 2000 })))).toEqual({ from: 1000, to: 2000 })
    expect(win(applyContext(w, ctx({ from: '2026-09-01T00:00:00Z', to: new Date('2026-09-02T00:00:00Z') })))).toEqual({
      from: Date.parse('2026-09-01T00:00:00Z'),
      to: Date.parse('2026-09-02T00:00:00Z'),
    })
    expect(applyContext(w, ctx('上周')).status).toBe('error')
    expect(applyContext(w, ctx({ from: 2000, to: 1000 })).status).toBe('error')
    expect(applyContext(w, { selectedDevice: D1 })).toMatchObject({ status: 'empty', message: '未选择时间范围' })
  })

  it('多处同时缺:取最重的(error > hide > empty)', () => {
    const w = lineCard({ source: 'context', key: 'timeRange', whenMissing: 'hide' })
    expect(applyContext(w, {}).status).toBe('hide')
  })

  it('ext(kz 通用历史):params.entity / params.keys / window 同样解析;绝对区间落到 range', () => {
    const w: WidgetConfig = {
      id: 'w_ext',
      slot: 'g1',
      type: 'line',
      bindings: {
        series: [
          {
            mode: 'ext',
            source: 'kz',
            window: { source: 'context', key: 'timeRange' },
            params: { entity: SEL, keys: [{ source: 'context', key: 'selectedMeasurePoint' }] },
          },
        ],
      },
    }
    const r = applyContext(w, { selectedDevice: D2, selectedMeasurePoint: 'P', timeRange: { from: 1, to: 2 } })
    expect((r.widget!.bindings.series as unknown[])[0]).toEqual({
      mode: 'ext',
      source: 'kz',
      range: { from: 1, to: 2 },
      params: { entity: D2, keys: ['P'] },
    })
  })
})

describe('契约与校验', () => {
  it('JSON Schema 认识上下文写法;键名只收标准键与 custom.*;旧配置照旧通过', () => {
    const ok = validatePageConfig(page([numCard(), fixedCard(), lineCard({ source: 'context', key: 'timeRange' })]))
    expect(ok.ok).toBe(true)
    expect(validatePageConfig(page([lineCard({ from: 1, to: 2 })])).ok).toBe(true)
    const badKey = numCard({
      bindings: { value: { mode: 'ts', entity: { source: 'context', key: 'whatever' }, key: 'P' } },
    })
    expect(validatePageConfig(page([badKey])).ok).toBe(false)
    const custom = numCard({
      bindings: { value: { mode: 'ts', entity: { source: 'context', key: 'custom.selectedTu' }, key: 'P' } },
    })
    expect(validatePageConfig(page([custom])).ok).toBe(true)
  })

  it('whenMissing: fallback 却没给 fallback → 注册表校验报错', () => {
    const w = numCard({
      bindings: { value: { mode: 'ts', entity: { ...SEL, whenMissing: 'fallback' }, key: 'P' } },
    })
    expect(validateWidgetAgainstRegistry(w).some(i => i.code === 'context-fallback-missing')).toBe(true)
    expect(validateWidgetAgainstRegistry(numCard()).filter(i => i.level === 'error')).toEqual([])
  })
})

describe('<ScadaWidget> 跟随上下文', () => {
  it('没选设备:空态、零订阅、不抛 bindError;选了就订;换设备 = 退一订一;置空回到空态', async () => {
    const ds = createMockDataSource()
    const ctx = reactive<BindingContext>({ selectedDevice: null })
    const w = mount(ScadaWidget, { props: { config: numCard(), dataSource: ds, bindingContext: ctx } })
    await nextTick()
    expect(ds.calls).toHaveLength(0)
    expect(w.find('[data-role="ctx-state"]').text()).toBe('未选择设备')
    expect(w.find('[data-ctx-state="empty"]').exists()).toBe(true)
    expect(w.emitted('bindError')).toBeUndefined()
    expect(w.vm.contextKeys).toEqual(['selectedDevice'])

    ctx.selectedDevice = D1
    await nextTick()
    expect(ds.calls.map(c => c.entity?.id)).toEqual(['d1'])
    expect(w.find('[data-role="ctx-state"]').exists()).toBe(false)

    ctx.selectedDevice = D2
    await nextTick()
    expect(ds.calls.map(c => c.entity?.id)).toEqual(['d1', 'd2'])
    expect(ds.unsubscribed()).toBe(1)
    ds.pushTs(D2, 'P', 42)
    await nextTick()
    expect(w.text()).toContain('42')

    ctx.selectedDevice = null
    await nextTick()
    expect(ds.unsubscribed()).toBe(2)
    expect(w.find('[data-role="ctx-state"]').text()).toBe('未选择设备')
    w.unmount()
    expect(w.vm.stats()).toMatchObject({ subscriptions: 2, unsubscribed: 2 })
  })

  it('同一个设备重复赋值(新对象、同 id)不重订', async () => {
    const ds = createMockDataSource()
    const ctx = reactive<BindingContext>({ selectedDevice: { ...D1 } })
    mount(ScadaWidget, { props: { config: numCard(), dataSource: ds, bindingContext: ctx } })
    await nextTick()
    ctx.selectedDevice = { ...D1 }
    await nextTick()
    expect(ds.calls).toHaveLength(1)
    expect(ds.unsubscribed()).toBe(0)
  })

  it('hide:整张卡不显示;error:错误态 + bindError', async () => {
    const ds = createMockDataSource()
    const hide = numCard({ bindings: { value: { mode: 'ts', entity: { ...SEL, whenMissing: 'hide' }, key: 'P' } } })
    const w1 = mount(ScadaWidget, { props: { config: hide, dataSource: ds }, attachTo: document.body })
    await nextTick()
    expect((w1.element as HTMLElement).style.display).toBe('none')
    w1.unmount()

    const err = numCard({ bindings: { value: { mode: 'ts', entity: { ...SEL, whenMissing: 'error' }, key: 'P' } } })
    const w2 = mount(ScadaWidget, { props: { config: err, dataSource: ds } })
    await nextTick()
    expect(w2.find('[data-ctx-state="error"]').exists()).toBe(true)
    expect(w2.emitted('bindError')![0]).toEqual(['w_ctx', '(context)', expect.stringContaining('未选择设备')])
    expect(ds.calls).toHaveLength(0)
  })

  it('provideBindingContext 注入;prop 优先于注入', async () => {
    const ds = createMockDataSource()
    const Host = defineComponent({
      props: { own: { type: Object, default: undefined } },
      setup(p) {
        provideBindingContext(reactive({ selectedDevice: D1 }))
        return () => h(ScadaWidget, { config: numCard(), dataSource: ds, bindingContext: p.own as BindingContext })
      },
    })
    mount(Host)
    await nextTick()
    expect(ds.calls.map(c => c.entity?.id)).toEqual(['d1'])
    mount(Host, { props: { own: { selectedDevice: D2 } } })
    await nextTick()
    expect(ds.calls.map(c => c.entity?.id)).toEqual(['d1', 'd2'])
  })

  it('design 态不看上下文:照旧用 sampleData,不订阅', async () => {
    const ds = createMockDataSource()
    const w = mount(ScadaWidget, { props: { config: numCard(), dataSource: ds, design: true } })
    await nextTick()
    expect(ds.calls).toHaveLength(0)
    expect(w.find('[data-role="ctx-state"]').exists()).toBe(false)
  })
})

describe('<ScadaPage>:只重订受影响的组件', () => {
  it('换设备时固定绑定的卡订阅不动、数值不丢;timeRange 只影响引用它的曲线', async () => {
    const ds = createMockDataSource()
    const ctx = reactive<BindingContext>({ selectedDevice: D1, timeRange: '24h' })
    const cfg = page([numCard(), fixedCard(), lineCard({ source: 'context', key: 'timeRange' })])
    const w = mount(ScadaPage, { props: { config: cfg, dataSource: ds, bindingContext: ctx } })
    await flushPromises()
    ds.pushTs(SITE, 'P_total', 777)
    await nextTick()
    const subsOf = (id: string) => ds.calls.filter(c => c.method === 'subscribeTs' && c.entity?.id === id).length
    expect(subsOf('site1')).toBe(1)
    expect(subsOf('d1')).toBe(2) // 数字卡 + 曲线的实时追加

    ctx.selectedDevice = D2
    await flushPromises()
    expect(subsOf('site1')).toBe(1) // 固定绑定没被重订
    expect(subsOf('d2')).toBe(2)
    expect(ds.unsubscribed()).toBe(2)
    expect(w.vm.values['w_fixed']!.value).toBe(777) // 值还在,没闪

    const histBefore = ds.calls.filter(c => c.method === 'getHistory').length
    ctx.timeRange = '7d'
    await flushPromises()
    const hist = ds.calls.filter(c => c.method === 'getHistory')
    expect(hist.length).toBe(histBefore + 1)
    expect(hist[hist.length - 1]!.window).toBe('7d')
    expect(subsOf('d2')).toBe(3) // 只有曲线重订;数字卡没动
    expect(w.vm.contextKeys).toEqual(['selectedDevice', 'timeRange'])
    w.unmount()
    const s = w.vm.stats()!
    expect(s.unsubscribed).toBe(s.subscriptions)
  })

  it('绝对时间区间:只拉历史,不追加实时', async () => {
    const ds = createMockDataSource()
    const ctx = reactive<BindingContext>({ selectedDevice: D1, timeRange: { from: 1000, to: 5000 } })
    mount(ScadaPage, {
      props: { config: page([lineCard({ source: 'context', key: 'timeRange' })]), dataSource: ds, bindingContext: ctx },
    })
    await flushPromises()
    expect(ds.calls.find(c => c.method === 'getHistory')!.window).toEqual({ from: 1000, to: 5000 })
    expect(ds.calls.filter(c => c.method === 'subscribeTs')).toHaveLength(0)
  })

  it('只改 props(标题)不重订;旧页面(无上下文引用)不传上下文照常工作', async () => {
    const ds = createMockDataSource()
    const cfg = reactive(page([fixedCard()])) as PageConfig
    mount(ScadaPage, { props: { config: cfg, dataSource: ds } })
    await nextTick()
    expect(ds.calls).toHaveLength(1)
    cfg.widgets[0]!.props = { title: '改了标题' }
    await nextTick()
    expect(ds.calls).toHaveLength(1)
    expect(ds.unsubscribed()).toBe(0)
  })
})

describe('联动事件', () => {
  it('整卡 click:只绑了一个实体时 detail.entity 给出(已解析成具体实体);design 态不抛', async () => {
    const ds = createMockDataSource()
    const w = mount(ScadaWidget, {
      props: { config: numCard(), dataSource: ds, bindingContext: { selectedDevice: D2 } },
    })
    await nextTick()
    await w.find('.sr-widget').trigger('click')
    expect(w.emitted('widget-event')![0]![0]).toEqual({
      widgetId: 'w_ctx',
      type: 'number-card',
      name: 'click',
      detail: { entity: D2 },
    })
    const d = mount(ScadaWidget, { props: { config: numCard(), design: true } })
    await d.find('.sr-widget').trigger('click')
    expect(d.emitted('widget-event')).toBeUndefined()
  })

  it('表格 row-click 带该行的实体与测点;告警列表 alarm-click 带告警与来源实体', async () => {
    const ds = createMockDataSource()
    const table: WidgetConfig = {
      id: 'w_tbl',
      slot: 'g1',
      type: 'table',
      props: { title: '一览' },
      bindings: {
        rows: [
          { mode: 'ts', entity: D1, key: 'P' },
          { mode: 'ts', entity: D2, key: 'P' },
        ],
      },
    }
    const t = mount(ScadaWidget, { props: { config: table, dataSource: ds } })
    await nextTick()
    await t.findAll('[data-role="row"]')[1]!.trigger('click')
    const evs = t.emitted('widget-event')!.map(e => e[0] as { name: string; detail: Record<string, unknown> })
    expect(evs[0]).toMatchObject({ name: 'row-click', detail: { index: 1, key: 'P', entity: D2 } })
    expect(evs[1]).toMatchObject({ name: 'click', detail: {} }) // 两个实体 → 整卡点击不带 entity

    const alarms: WidgetConfig = {
      id: 'w_al',
      slot: 'g2',
      type: 'alarm-list',
      bindings: { alarms: { mode: 'alarm', entity: SITE } },
    }
    const a = mount(ScadaWidget, { props: { config: alarms, dataSource: ds } })
    await nextTick()
    ds.pushAlarms([
      { id: 'a1', type: '过温', severity: 'MAJOR', status: 'ACTIVE_UNACK', startTs: Date.now(), originator: D1 },
    ])
    await nextTick()
    await a.find('[data-role="alarm-row"]').trigger('click')
    expect((a.emitted('widget-event')![0]![0] as { name: string; detail: { entity: unknown } }).name).toBe(
      'alarm-click'
    )
    expect((a.emitted('widget-event')![0]![0] as { detail: { entity: unknown } }).detail.entity).toEqual(D1)
  })
})
