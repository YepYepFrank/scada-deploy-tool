// T3.4 绑定选择器:元数据树(纯函数 + 虚拟滚动)、BindingRow(mode 受限、产出契约形状)、BindingsPanel(必填红 / 类型黄 / 多序列)。
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

import { getWidget, registerBuiltins, type Binding, type WidgetConfig } from '@grid/scada-renderer'
import { buildMetaTree, countEntities, flattenTree, MetaClient, type TbDevice } from '../src/meta/MetaNode'
import EntityTree from '../src/editor/EntityTree.vue'
import BindingRow from '../src/editor/BindingRow.vue'
import BindingsPanel from '../src/editor/BindingsPanel.vue'
import { checkSlot, isComplete } from '../src/editor/binding-check'

registerBuiltins()

const dev = (name: string, gw?: string, type = 'IED'): TbDevice => ({
  id: { id: `id-${name}` },
  name,
  type,
  additionalInfo: gw ? { lastConnectedGateway: `id-${gw}` } : undefined,
})
const gateway = (name: string): TbDevice => ({
  id: { id: `id-${name}` },
  name,
  type: 'gateway',
  additionalInfo: { gateway: true },
})

/** 231 台设备:2 个网关各 110 台子设备 + 9 台直连 + 2 网关 */
function bigSite() {
  const devices: TbDevice[] = [gateway('GW1'), gateway('GW2')]
  for (let i = 1; i <= 110; i++) devices.push(dev(`SSP_${i}`, 'GW1'), dev(`PDR_${i}`, 'GW2'))
  for (let i = 1; i <= 9; i++) devices.push(dev(`DIRECT_${i}`))
  return buildMetaTree('仙人山', devices, [{ id: { id: 'a1' }, name: 'xrs-mirror-test', type: 'tbsite' }])
}

/** 内存版 MetaClient:两台设备的 key 与最近值 */
const fakeApi = async (url: string) => {
  if (url.includes('/keys/timeseries')) return ['P', 'Q', 'name', 'calc_total_p', 'CB']
  if (url.includes('/values/timeseries'))
    return {
      P: [{ value: '44.8' }],
      Q: [{ value: '1.2' }],
      name: [{ value: 'PCS-1' }],
      calc_total_p: [{ value: '99' }],
      CB: [{ value: 'true' }],
    }
  if (url.includes('/keys/attributes/')) return ['soh', 'model']
  if (url.includes('/api/alarm/')) return { data: [{ type: '过温' }, { type: '通讯' }, { type: '过温' }] }
  throw new Error('unknown ' + url)
}
const fakeClient = () => new MetaClient(fakeApi)
const D1 = { type: 'DEVICE', id: 'id-SSP_1', name: 'SSP_1' } as const

describe('元数据树', () => {
  it('buildMetaTree:设备归到最后连接的网关下,直连设备 / 资产各成一组;排序自然序', () => {
    const t = bigSite()
    expect(t.children.map(c => `${c.kind}:${c.name}:${c.children.length}`)).toEqual([
      'gateway:GW1:110',
      'gateway:GW2:110',
      'group:直连 / 未归网关设备:9',
      'group:资产:1',
    ])
    expect(t.children[0]!.children.slice(0, 3).map(n => n.name)).toEqual(['SSP_1', 'SSP_2', 'SSP_3'])
    expect(countEntities(t)).toBe(231 + 1)
    expect(t.children[3]!.children[0]!.entity).toEqual({ type: 'ASSET', id: 'a1', name: 'xrs-mirror-test' })
  })

  it('flattenTree:按展开状态拍平;过滤时命中节点的祖先全部展开', () => {
    const t = bigSite()
    expect(flattenTree(t, new Set(['site'])).map(r => r.node.name)).toEqual([
      '仙人山',
      'GW1',
      'GW2',
      '直连 / 未归网关设备',
      '资产',
    ])
    const rows = flattenTree(t, new Set(['site', 'id-GW1']))
    expect(rows).toHaveLength(5 + 110)
    const hit = flattenTree(t, new Set(), 'pdr_7')
    expect(hit.map(r => r.node.name)).toEqual([
      '仙人山',
      'GW2',
      'PDR_7',
      'PDR_70',
      'PDR_71',
      'PDR_72',
      'PDR_73',
      'PDR_74',
      'PDR_75',
      'PDR_76',
      'PDR_77',
      'PDR_78',
      'PDR_79',
    ])
  })

  it('EntityTree:231 台设备全部展开时只渲染视口内的行;点设备 emit 实体,点网关折叠', async () => {
    const t = bigSite()
    const w = mount(EntityTree, { props: { root: t, height: 260, rowHeight: 26 } })
    // 默认展开根与一级:5 + 110 + 110 + 9 + 1 行
    expect(w.text()).toContain('235 行')
    const rendered = w.findAll('.et-row')
    expect(rendered.length).toBeLessThan(40)
    expect(rendered.length).toBeGreaterThanOrEqual(10)
    await w.find('[data-id="id-SSP_1"]').trigger('click')
    expect(w.emitted('select')![0]![0]).toEqual({ type: 'DEVICE', id: 'id-SSP_1', name: 'SSP_1' })
    await w.find('[data-id="id-GW1"] .et-fold').trigger('click')
    await nextTick()
    expect(w.text()).toContain('125 行')
    await w.find('.et-q').setValue('direct_3')
    await nextTick()
    expect(w.findAll('.et-row').map(r => r.attributes('data-id'))).toEqual(['site', 'group:direct', 'id-DIRECT_3'])
  })

  it('MetaClient:key 带最近值类型,calc_ 也在;告警类型去重;缓存只请求一次', async () => {
    const calls: string[] = []
    const c = new MetaClient(async url => {
      calls.push(url)
      return fakeApi(url)
    })
    const keys = await c.tsKeys(D1)
    expect(keys.map(k => `${k.key}:${k.kind}`).sort()).toEqual([
      'CB:boolean',
      'P:number',
      'Q:number',
      'calc_total_p:number',
      'name:string',
    ])
    await c.tsKeys(D1)
    expect(calls.filter(u => u.includes('/keys/timeseries'))).toHaveLength(1)
    expect(await c.alarmTypes(D1)).toEqual(['过温', '通讯']) // 默认 sort 按码位
    expect(await c.attrKeys(D1, 'SERVER_SCOPE')).toEqual(['model', 'soh'])
  })
})

describe('binding-check', () => {
  it('isComplete / checkSlot:必填未绑红、未填完整红、数值槽位选文本 key 黄', () => {
    expect(isComplete({ mode: 'ts', entity: { type: 'DEVICE', id: '', name: '' }, key: 'P' })).toBe(false)
    expect(isComplete({ mode: 'ts-history', entity: D1, keys: ['P'], window: '24h' })).toBe(true)
    expect(isComplete({ mode: 'alarm', entity: D1 })).toBe(true)
    const num = { name: 'value', valueType: 'number', required: true } as const
    expect(checkSlot(num, undefined, () => undefined)).toEqual({ level: 'error', message: '必填槽位未绑定' })
    expect(checkSlot(num, { mode: 'ts', entity: D1, key: '' }, () => undefined)?.level).toBe('error')
    expect(checkSlot(num, { mode: 'ts', entity: D1, key: 'name' }, () => 'string')).toMatchObject({ level: 'warning' })
    expect(checkSlot(num, { mode: 'ts', entity: D1, key: 'P' }, () => 'number')).toBeNull()
    expect(checkSlot({ name: 'x', valueType: 'series', multiple: true }, [], () => undefined)).toBeNull()
  })
})

describe('BindingRow', () => {
  const tree = bigSite()
  it('mode 下拉只列槽位允许的 modes;选 ts 后产出 {mode, entity, key} 形状;换实体清 key', async () => {
    const spec = getWidget('number-card')!.bindingSlots[0]! // value:ts / attr / const
    const w = mount(BindingRow, { props: { spec, modelValue: null, tree, client: fakeClient() } })
    const opts = w.findAll('select[data-role="mode"] option').map(o => o.attributes('value'))
    expect(opts).toEqual(['', 'ts', 'attr', 'const'])
    await w.find('select[data-role="mode"]').setValue('ts')
    expect(w.emitted('update:modelValue')!.at(-1)![0]).toEqual({
      mode: 'ts',
      entity: { type: 'DEVICE', id: '', name: '' },
      key: '',
    })
    await w.setProps({ modelValue: { mode: 'ts', entity: D1, key: 'P' } as Binding })
    await w.find('[data-role="entity"]').trigger('click')
    await w.find('[data-id="id-SSP_2"]').trigger('click')
    expect(w.emitted('update:modelValue')!.at(-1)![0]).toEqual({
      mode: 'ts',
      entity: { type: 'DEVICE', id: 'id-SSP_2', name: 'SSP_2' },
      key: '',
    })
  })

  it('ts-history:多 key + window + agg;alarm:类型 chip 多选,空则不写 types', async () => {
    const spec = getWidget('line')!.bindingSlots[0]!
    const w = mount(BindingRow, {
      props: {
        spec,
        modelValue: { mode: 'ts-history', entity: D1, keys: ['P'], window: '24h' } as Binding,
        tree,
        client: fakeClient(),
      },
    })
    await w.find('.br-mini').trigger('click') // + 再加一个测点
    expect((w.emitted('update:modelValue')!.at(-1)![0] as { keys: string[] }).keys).toEqual(['P', ''])
    await w.find('select[data-role="window"]').setValue('7d')
    expect((w.emitted('update:modelValue')!.at(-1)![0] as { window: string }).window).toBe('7d')
    await w.find('select[data-role="agg"]').setValue('MAX')
    expect((w.emitted('update:modelValue')!.at(-1)![0] as { agg: string }).agg).toBe('MAX')

    const aspec = getWidget('alarm-list')!.bindingSlots[0]!
    const a = mount(BindingRow, {
      props: { spec: aspec, modelValue: { mode: 'alarm', entity: D1 } as Binding, tree, client: fakeClient() },
    })
    await new Promise(r => setTimeout(r, 0))
    await nextTick()
    expect(a.findAll('.br-chip').map(c => c.text())).toEqual(['过温', '通讯'])
    await a.find('[data-type="过温"]').trigger('click')
    expect(a.emitted('update:modelValue')!.at(-1)![0]).toEqual({ mode: 'alarm', entity: D1, types: ['过温'] })
    await a.setProps({ modelValue: { mode: 'alarm', entity: D1, types: ['过温'] } as Binding })
    await a.find('[data-type="过温"]').trigger('click')
    expect(a.emitted('update:modelValue')!.at(-1)![0]).toEqual({ mode: 'alarm', entity: D1 })
  })
})

describe('BindingsPanel', () => {
  it('line 的 series 多序列:三条来自不同设备;必填未绑标红;数值槽位选文本 key 标黄', async () => {
    const def = getWidget('line')!
    const widget: WidgetConfig = { id: 'l', slot: 'g1', type: 'line', bindings: {} }
    const w = mount(BindingsPanel, { props: { def, widget, tree: bigSite(), client: fakeClient() } })
    expect(w.find('[data-slot="series"]').classes()).toContain('bad')
    expect(w.find('[data-slot="series"] .bp-flag').text()).toBe('必填槽位未绑定')
    await w.find('.bp-add').trigger('click')
    expect((w.emitted('update')!.at(-1)![0] as { series: unknown[] }).series).toHaveLength(1)
    const three = ['SSP_1', 'PDR_2', 'DIRECT_3'].map(n => ({
      mode: 'ts-history',
      entity: { type: 'DEVICE', id: `id-${n}`, name: n },
      keys: ['P'],
      window: '24h',
    })) as Binding[]
    await w.setProps({ widget: { ...widget, bindings: { series: three } } })
    expect(w.findAll('[data-slot="series"] .bp-item')).toHaveLength(3)
    expect(w.find('[data-slot="series"]').classes()).not.toContain('bad')
    expect(w.emitted('flags')!.at(-1)![0]).toEqual({ series: null })

    const nc = getWidget('number-card')!
    const p = mount(BindingsPanel, {
      props: {
        def: nc,
        widget: {
          id: 'n',
          slot: 's1',
          type: 'number-card',
          bindings: { value: { mode: 'ts', entity: D1, key: 'name' } },
        },
        tree: bigSite(),
        client: fakeClient(),
      },
    })
    await new Promise(r => setTimeout(r, 0))
    await nextTick()
    expect(p.find('[data-slot="value"]').classes()).toContain('warn')
    expect(p.find('[data-slot="value"] .bp-flag').text()).toContain('文本')
  })
})
