/**
 * 跟随页面上下文的绑定(渲染器 0.9.0 BindingContext)在部署工具这一侧:
 * - context-binding 纯函数:固定 ⇄ 跟随的来回切换不丢样例;whenMissing 一处设置全条生效;样例视图;
 * - 完整性:键名合法即算填完整,样例不是必填;选了「用样例值」必须给样例;
 * - BindingRow:实体来源下拉 / 测点跟随 / 窗口跟随 产出契约形状,通过 JSON Schema;
 * - 校验层:提示「需要渲染器 ≥ 0.9.0」;引用文本带上要喂的上下文键;
 * - 预览:出现「上下文模拟」条,初值取样例,切设备后组件换订阅,选「(不选)」显示空态。
 */
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

import { getWidget, registerBuiltins, validatePageConfig, type Binding, type PageConfig } from '@grid/scada-renderer'
import type { DataSource, EntityRef } from '@grid/tb-client'
import { buildMetaTree, MetaClient, type TbDevice } from '../src/meta/MetaNode'
import BindingRow from '../src/editor/BindingRow.vue'
import PreviewPane from '../src/editor/PreviewPane.vue'
import { isComplete } from '../src/editor/binding-check'
import {
  contextProblems,
  sampleBinding,
  sampleContext,
  setEntityFollows,
  setKeyFollows,
  setWhenMissing,
  setWindowFollows,
  usesContext,
  whenMissingOf,
} from '../src/editor/context-binding'
import { refSnippet } from '../src/editor/widget-ref'
import { validateStatic } from '../src/editor/validate'

registerBuiltins()

const D1: EntityRef = { type: 'DEVICE', id: 'id-PCS_1', name: 'PCS_1' }
const D2: EntityRef = { type: 'DEVICE', id: 'id-PCS_2', name: 'PCS_2' }
const ts = (): Binding => ({ mode: 'ts', entity: D1, key: 'P' })
const hist = (): Binding => ({ mode: 'ts-history', entity: D1, keys: ['P'], window: '24h' })
const pageOf = (bindings: Record<string, Binding | Binding[]>, type = 'number-card'): PageConfig => ({
  schemaVersion: 1,
  template: 'overview-a',
  widgets: [{ id: 'w_1', slot: type === 'line' ? 'g1' : 's1', type, bindings }],
})

describe('context-binding 纯函数', () => {
  it('实体:固定 → 跟随(当前实体留作样例)→ 固定(样例变回实体),来回不丢', () => {
    const f = setEntityFollows(ts(), 'selectedDevice')
    expect(f).toEqual({
      mode: 'ts',
      entity: { source: 'context', key: 'selectedDevice', type: 'DEVICE', fallback: D1 },
      key: 'P',
    })
    expect(usesContext(f)).toBe(true)
    expect(setEntityFollows(f, null)).toEqual(ts())
    // selectedSite 不限定类型(站点可能是网关设备也可能是资产);自定义键同理
    expect((setEntityFollows(ts(), 'selectedSite') as { entity: { type?: string } }).entity.type).toBeUndefined()
    expect((setEntityFollows(ts(), 'custom.selectedTu') as { entity: { key: string } }).entity.key).toBe(
      'custom.selectedTu'
    )
  })

  it('测点 / 窗口跟随:样例保留;ext 的测点写在 params.keys', () => {
    const k = setKeyFollows(hist(), true) as { keys: unknown[] }
    expect(k.keys).toEqual([{ source: 'context', key: 'selectedMeasurePoint', fallback: 'P' }])
    expect(setKeyFollows(k as unknown as Binding, false)).toEqual(hist())
    const w = setWindowFollows(hist(), true) as { window: unknown }
    expect(w.window).toEqual({ source: 'context', key: 'timeRange', fallback: '24h' })
    expect(setWindowFollows(w as unknown as Binding, false)).toEqual(hist())
    const ext: Binding = { mode: 'ext', source: 'kz', window: '30d', params: { entity: D1, keys: ['P'] } }
    const e = setKeyFollows(setEntityFollows(ext, 'selectedDevice'), true) as unknown as {
      params: { entity: unknown; keys: unknown[] }
    }
    expect(e.params.entity).toMatchObject({ source: 'context', key: 'selectedDevice', fallback: D1 })
    expect(e.params.keys[0]).toMatchObject({ source: 'context', key: 'selectedMeasurePoint', fallback: 'P' })
  })

  it('whenMissing:一处设置,整条绑定的引用都跟着;empty 是缺省不落字段', () => {
    const b = setWindowFollows(setKeyFollows(setEntityFollows(hist(), 'selectedDevice'), true), true)
    const hidden = setWhenMissing(b, 'hide')
    expect(whenMissingOf(hidden)).toBe('hide')
    expect(JSON.stringify(hidden).match(/"whenMissing":"hide"/g)).toHaveLength(3)
    expect(JSON.stringify(setWhenMissing(hidden, 'empty'))).not.toContain('whenMissing')
  })

  it('样例视图 sampleBinding:老代码看到的还是「具体的实体 + 测点 + 窗口」', () => {
    const b = setWindowFollows(setKeyFollows(setEntityFollows(hist(), 'selectedDevice'), true), true)
    expect(sampleBinding(b)).toEqual(hist())
    expect(sampleBinding(ts())).toEqual(ts()) // 没有上下文引用:原样
  })

  it('完整性:键名合法即可,样例不是必填;「用样例值」必须给样例;自定义键写法要对', () => {
    const noSample: Binding = { mode: 'ts', entity: { source: 'context', key: 'selectedDevice' }, key: 'P' }
    expect(isComplete(noSample)).toBe(true)
    expect(isComplete({ ...noSample, key: '' } as Binding)).toBe(false) // 固定的测点没填,照旧不完整
    const needs = setWhenMissing(noSample, 'fallback')
    expect(contextProblems(needs)[0]).toContain('还没给样例')
    expect(isComplete(needs)).toBe(false)
    expect(isComplete(setWhenMissing(setEntityFollows(ts(), 'selectedDevice'), 'fallback'))).toBe(true)
    expect(isComplete(setEntityFollows(ts(), 'custom.'))).toBe(false)
    expect(isComplete(setEntityFollows(ts(), 'custom.selectedTu'))).toBe(true)
  })

  it('sampleContext:用各绑定的样例拼出预览的初始上下文', () => {
    const b = setWindowFollows(setKeyFollows(setEntityFollows(hist(), 'selectedDevice'), true), true)
    const custom = setEntityFollows({ mode: 'ts', entity: D2, key: 'Q' }, 'custom.selectedTu')
    expect(sampleContext([{ bindings: { series: [b], value: custom } }])).toEqual({
      selectedDevice: D1,
      selectedMeasurePoint: 'P',
      timeRange: '24h',
      custom: { selectedTu: D2 },
    })
  })
})

describe('产出的配置符合契约', () => {
  it('跟随设备 + 测点 + 时间范围的曲线通过 JSON Schema;校验层提示需要 0.9.0;引用文本带上下文键', () => {
    const b = setWindowFollows(setKeyFollows(setEntityFollows(hist(), 'selectedDevice'), true), true)
    const cfg = pageOf({ series: [setWhenMissing(b, 'hide')] }, 'line')
    expect(validatePageConfig(cfg).ok).toBe(true)
    const issues = validateStatic(cfg)
    expect(issues.filter(i => i.level === 'error')).toEqual([])
    expect(issues.some(i => i.level === 'warning' && i.message.includes('≥ 0.9.0'))).toBe(true)
    expect(validateStatic(pageOf({ value: ts() })).some(i => i.message.includes('0.9.0'))).toBe(false)
    const snippet = refSnippet('page-1', cfg.widgets[0]!)
    expect(snippet).toContain('selectedDevice、selectedMeasurePoint、timeRange')
    expect(snippet).toContain(':binding-context="ctx"')
    expect(refSnippet('page-1', pageOf({ value: ts() }).widgets[0]!)).not.toContain('binding-context')
  })
})

describe('BindingRow:跟随页面上下文', () => {
  const tree = buildMetaTree('站', [
    { id: { id: D1.id }, name: D1.name, type: 'PCS' },
    { id: { id: D2.id }, name: D2.name, type: 'PCS' },
  ] as TbDevice[])
  const client = new MetaClient(async (url: string) => {
    if (url.includes('/keys/timeseries')) return ['P', 'Q']
    if (url.includes('/values/timeseries')) return { P: [{ value: '1' }], Q: [{ value: '2' }] }
    return []
  })
  const spec = getWidget('line')!.bindingSlots.find(s => s.name === 'series')!
  const last = (w: ReturnType<typeof mount>) => {
    const all = w.emitted('update:modelValue') as [Binding][]
    return all[all.length - 1]![0]
  }

  it('实体来源选「跟随当前设备」→ 当前实体成了样例;按钮标「样例:」;测点 / 窗口可各自跟随;没选时可设', async () => {
    const w = mount(BindingRow, { props: { spec, modelValue: hist(), tree, client } })
    await nextTick()
    expect(w.find('[data-role="ctx-missing"]').exists()).toBe(false)
    await w.find('[data-role="ctx-entity"]').setValue('selectedDevice')
    let b = last(w)
    expect((b as { entity: unknown }).entity).toEqual({
      source: 'context',
      key: 'selectedDevice',
      type: 'DEVICE',
      fallback: D1,
    })
    await w.setProps({ modelValue: b })
    expect(w.find('[data-role="entity"]').text()).toContain('样例')
    expect(w.find('[data-role="ctx-hint"]').text()).toContain('selectedDevice')

    await w.find('[data-role="ctx-key"]').setValue(true)
    b = last(w)
    await w.setProps({ modelValue: b })
    await w.find('[data-role="window"]').setValue('@ctx')
    b = last(w)
    await w.setProps({ modelValue: b })
    await w.find('[data-role="ctx-missing"]').setValue('hide')
    b = last(w)
    expect(sampleBinding(b)).toEqual(hist())
    expect(whenMissingOf(b)).toBe('hide')
    expect(validatePageConfig(pageOf({ series: [b] }, 'line')).ok).toBe(true)

    // 切回固定:样例变回实体
    await w.setProps({ modelValue: b })
    await w.find('[data-role="ctx-entity"]').setValue('')
    expect((last(w) as { entity: unknown }).entity).toEqual(D1)
  })

  it('自定义键:custom.<名字>,写法不对时标红', async () => {
    const w = mount(BindingRow, { props: { spec, modelValue: hist(), tree, client } })
    await w.find('[data-role="ctx-entity"]').setValue('custom')
    await w.setProps({ modelValue: last(w) })
    expect(w.find('[data-role="ctx-custom"]').classes()).toContain('bad')
    await w.find('[data-role="ctx-custom"]').setValue('selectedTu')
    expect((last(w) as { entity: { key: string } }).entity.key).toBe('custom.selectedTu')
  })
})

describe('预览:上下文模拟', () => {
  const tree = buildMetaTree('站', [
    { id: { id: D1.id }, name: D1.name, type: 'PCS' },
    { id: { id: D2.id }, name: D2.name, type: 'PCS' },
  ] as TbDevice[])
  function fakeSource() {
    const subs: string[] = []
    const ds: DataSource & { dispose(): void; subs: string[] } = {
      status: 'live',
      onStatus: cb => {
        cb('live')
        return () => {}
      },
      subscribeTs: (entity, keys, cb) => {
        subs.push(entity.id)
        queueMicrotask(() => cb(keys.map(key => ({ key, points: [{ ts: 1, value: entity.id === D1.id ? 11 : 22 }] }))))
        return () => {}
      },
      subscribeAttr: () => () => {},
      subscribeAlarms: () => () => {},
      getHistory: async () => ({}),
      getLatest: async () => ({}),
      dispose: () => {},
      subs,
    }
    return ds
  }
  const flush = async () => {
    for (let i = 0; i < 6; i++) await Promise.resolve()
    await nextTick()
  }

  it('有上下文绑定才出现模拟条;初值取样例;切设备换订阅;选「(不选)」显示空态', async () => {
    const src = fakeSource()
    const config = pageOf({ value: setEntityFollows(ts(), 'selectedDevice') })
    const w = mount(PreviewPane, {
      props: { config, base: '/tbm', tenantToken: 't', tree, makeSource: () => src },
    })
    await flush()
    expect(w.find('[data-role="ctx-sim"]').exists()).toBe(true)
    expect(src.subs).toEqual([D1.id])
    expect(w.find('.sr-widget[data-widget="w_1"]').text()).toContain('11')

    await w.find('[data-ctx="selectedDevice"]').setValue(D2.id)
    await flush()
    expect(src.subs).toEqual([D1.id, D2.id])
    expect(w.find('.sr-widget[data-widget="w_1"]').text()).toContain('22')

    await w.find('[data-ctx="selectedDevice"]').setValue('')
    await flush()
    expect(w.find('[data-role="ctx-state"]').text()).toBe('未选择设备')
    w.unmount()
  })

  it('没有上下文绑定的页面:不出现模拟条', async () => {
    const w = mount(PreviewPane, {
      props: { config: pageOf({ value: ts() }), base: '/tbm', tenantToken: 't', makeSource: () => fakeSource() },
    })
    await flush()
    expect(w.find('[data-role="ctx-sim"]').exists()).toBe(false)
    w.unmount()
  })
})
