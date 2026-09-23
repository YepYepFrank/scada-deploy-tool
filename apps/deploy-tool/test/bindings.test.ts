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
const settle = async () => {
  await new Promise(r => setTimeout(r, 0))
  await nextTick()
}
/** 数据源面板(2026-09-23 起取代内联实体树 + 测点下拉):点格子打开,面板里的设备 / 测点行 */
type Row = ReturnType<typeof mount>
const openSrc = async (w: Row) => {
  await w.find('[data-role="entity"]').trigger('click')
  await settle()
}
const srcDevice = (w: Row, id: string) => w.find(`[data-role="source-device"][data-name="${id}"]`)
const srcRows = (w: Row) => w.findAll('[data-role="source-point"]')
const srcKeys = (w: Row) => srcRows(w).map(r => r.attributes('data-value')!.split('||')[1])

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
  it('mode 下拉只列槽位允许的 modes;选 ts 后产出 {mode, entity, key} 形状;面板里点一行实体和测点一起定', async () => {
    const spec = getWidget('number-card')!.bindingSlots[0]! // value:ts / attr / const
    const w = mount(BindingRow, {
      props: { spec, modelValue: null, tree, client: fakeClient() },
      global: { stubs: { Teleport: true } },
    })
    const opts = w.findAll('select[data-role="mode"] option').map(o => o.attributes('value'))
    expect(opts).toEqual(['', 'ts', 'attr', 'const'])
    await w.find('select[data-role="mode"]').setValue('ts')
    expect(w.emitted('update:modelValue')!.at(-1)![0]).toEqual({
      mode: 'ts',
      entity: { type: 'DEVICE', id: '', name: '' },
      key: '',
    })
    await w.setProps({ modelValue: { mode: 'ts', entity: D1, key: 'P' } as Binding })
    expect(w.find('[data-role="entity"]').text()).toContain('SSP_1')
    await openSrc(w)
    // 停在当前实体上,当前测点高亮
    expect(w.find('.dsd-dev.on').attributes('data-name')).toBe('id-SSP_1')
    expect(w.find('.dsd-row.cur').attributes('data-value')).toBe('id-SSP_1||P')
    await srcDevice(w, 'id-SSP_2').trigger('click')
    await settle()
    await w.find('[data-role="source-point"][data-value="id-SSP_2||Q"]').trigger('click')
    expect(w.emitted('update:modelValue')!.at(-1)![0]).toEqual({
      mode: 'ts',
      entity: { type: 'DEVICE', id: 'id-SSP_2', name: 'SSP_2' },
      key: 'Q',
    })
    expect(w.find('[data-role="source-drawer"]').exists()).toBe(false)
  })

  it('属性绑定:面板列属性;范围在格子下面选', async () => {
    const spec = getWidget('number-card')!.bindingSlots[0]!
    const w = mount(BindingRow, {
      props: {
        spec,
        modelValue: { mode: 'attr', entity: D1, scope: 'SERVER_SCOPE', key: '' } as Binding,
        tree,
        client: fakeClient(),
      },
      global: { stubs: { Teleport: true } },
    })
    expect(w.find('select[data-role="attr-scope"]').exists()).toBe(true)
    await openSrc(w)
    expect(w.find('.dsd-title b').text()).toContain('属性')
    expect(srcKeys(w)).toEqual(['model', 'soh'])
    await w.find('[data-role="source-point"][data-value="id-SSP_1||soh"]').trigger('click')
    expect(w.emitted('update:modelValue')!.at(-1)![0]).toEqual({
      mode: 'attr',
      entity: D1,
      scope: 'SERVER_SCOPE',
      key: 'soh',
    })
  })

  it('ts-history:一条绑定只选一个测点(审查 R3);window + agg;alarm:类型 chip 多选,空则不写 types', async () => {
    const spec = getWidget('line')!.bindingSlots[0]!
    const w = mount(BindingRow, {
      props: {
        spec,
        modelValue: { mode: 'ts-history', entity: D1, keys: ['P'], window: '24h' } as Binding,
        tree,
        client: fakeClient(),
      },
    })
    // 单 key 时既没有「再加一个测点」,也没有多 key 提示
    expect(w.find('[data-role="multi-key-warning"]').exists()).toBe(false)
    expect(w.findAll('[data-role="entity"]')).toHaveLength(1)
    await w.find('select[data-role="window"]').setValue('7d')
    expect((w.emitted('update:modelValue')!.at(-1)![0] as { window: string }).window).toBe('7d')
    await w.find('select[data-role="agg"]').setValue('MAX')
    expect((w.emitted('update:modelValue')!.at(-1)![0] as { agg: string }).agg).toBe('MAX')

    // 早期配置留下的多 key:原样提示,给出「拆成多条」与「只留第一个」两个出口
    const legacy = mount(BindingRow, {
      props: {
        spec,
        modelValue: { mode: 'ts-history', entity: D1, keys: ['P', 'Q'], window: '24h' } as Binding,
        tree,
        client: fakeClient(),
      },
    })
    const warn = legacy.find('[data-role="multi-key-warning"]')
    expect(warn.exists()).toBe(true)
    expect(warn.text()).toContain('Q')
    const btns = warn.findAll('button')
    expect(btns.map(b => b.text())).toEqual(['拆成 2 条绑定', '只留第一个'])
    await btns[0]!.trigger('click')
    expect(legacy.emitted('split')![0]![0]).toEqual(['P', 'Q'])
    await btns[1]!.trigger('click')
    expect((legacy.emitted('update:modelValue')!.at(-1)![0] as { keys: string[] }).keys).toEqual(['P'])

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

describe('BindingRow · 第 3 步声明的输出(还没发布)', () => {
  const tree = bigSite()
  const declared = {
    keys: [
      { entityType: 'DEVICE' as const, entity: 'SSP_1', key: 'calc_total_p', kind: 'cf' }, // TB 上已有
      { entityType: 'DEVICE' as const, entity: 'SSP_1', key: 'calc_pqSum', kind: 'cf' }, // 还没发布
      { entityType: 'DEVICE' as const, entity: 'SSP_1', key: 'calc_PAvg1d', kind: 'cascade' }, // 还没发布
      { entityType: 'DEVICE' as const, entity: 'SSP_2', key: 'calc_other', kind: 'cf' }, // 别的设备的
    ],
    alarms: [{ entityType: 'DEVICE' as const, entity: 'SSP_1', type: '功率越限告警' }],
  }
  const mountRow = (spec: unknown, modelValue: unknown, withDeclared = true) =>
    mount(BindingRow, {
      props: {
        spec: spec as never,
        modelValue: modelValue as Binding,
        tree,
        client: fakeClient(),
        ...(withDeclared ? { declared } : {}),
      },
      global: { stubs: { Teleport: true } },
    })

  it('声明的输出置顶;TB 上还没有的标「待发布」,照样能选;别的设备的不串过来', async () => {
    const w = mountRow(getWidget('number-card')!.bindingSlots[0]!, { mode: 'ts', entity: D1, key: '' })
    await openSrc(w)
    expect(srcKeys(w).slice(0, 3)).toEqual(['calc_total_p', 'calc_pqSum', 'calc_PAvg1d'])
    const texts = srcRows(w).map(r => r.text())
    expect(texts[0]).toContain('99')
    expect(texts[1]).toContain('待发布')
    expect(texts[2]).toContain('待发布')
    expect(texts.join(' ')).not.toContain('calc_other')
    // 未发布的也能选中,写进绑定 —— 这正是「先绑后发布」要的
    await w.find('[data-role="source-point"][data-value="id-SSP_1||calc_PAvg1d"]').trigger('click')
    expect((w.emitted('update:modelValue')!.at(-1)![0] as { key: string }).key).toBe('calc_PAvg1d')
  })

  it('已发布的 calc_ 只出现一次;不传 declared 时 calc_ 仍排在遥测前面', async () => {
    const w = mountRow(getWidget('number-card')!.bindingSlots[0]!, { mode: 'ts', entity: D1, key: '' })
    await openSrc(w)
    expect(srcKeys(w).filter(k => k === 'calc_total_p')).toHaveLength(1)
    const plain = mountRow(getWidget('number-card')!.bindingSlots[0]!, { mode: 'ts', entity: D1, key: '' }, false)
    await openSrc(plain)
    expect(srcKeys(plain)).toEqual(['calc_total_p', 'CB', 'name', 'P', 'Q'])
    expect(srcRows(plain)[0]!.text()).toContain('99')
  })

  it('告警类型:声明过但还没触发过的也列出来并标「待发布」', async () => {
    const w = mountRow(getWidget('alarm-list')!.bindingSlots[0]!, { mode: 'alarm', entity: D1 })
    await new Promise(r => setTimeout(r, 0))
    await nextTick()
    const chips = w.findAll('.br-chip').map(c => c.text())
    expect(chips).toEqual(['过温', '通讯', '功率越限告警待发布'])
    await w.find('[data-type="功率越限告警"]').trigger('click')
    expect(w.emitted('update:modelValue')!.at(-1)![0]).toEqual({
      mode: 'alarm',
      entity: D1,
      types: ['功率越限告警'],
    })
  })
})

describe('BindingRow · ext(kz)', () => {
  const tree = bigSite()
  const spec = () => getWidget('line')!.bindingSlots[0]! // series:ts-history / ext / const
  // KeyPicker 的面板是 Teleport 出去的,测试里拉回本地才找得到
  const mountExt = (modelValue: unknown) =>
    mount(BindingRow, {
      props: { spec: spec(), modelValue: modelValue as Binding, tree, client: fakeClient() },
      global: { stubs: { Teleport: true } },
    })
  const last = (w: ReturnType<typeof mountExt>) => w.emitted('update:modelValue')!.at(-1)![0] as Record<string, unknown>

  it('选 ext 就开出归档历史的表单(不再是空 params 让人手写 JSON)', async () => {
    const w = mount(BindingRow, { props: { spec: spec(), modelValue: null, tree, client: fakeClient() } })
    await w.find('select[data-role="mode"]').setValue('ext')
    expect(last(w)).toEqual({
      mode: 'ext',
      source: 'kz',
      window: '30d',
      interval: '1d',
      params: { entity: { type: 'DEVICE', id: '', name: '' }, keys: [] },
    })
  })

  it('归档历史:实体和测点在数据源面板里一起点、聚合选下拉 —— 全程不碰 JSON', async () => {
    const w = mountExt({ mode: 'ext', source: 'kz', window: '30d', interval: '1d', params: { entity: D1, keys: [] } })
    // params JSON 默认收起
    expect(w.find('textarea').exists()).toBe(false)
    // 格子显示的是当前实体,点开是同一套 站 → 网关 → 设备 → 测点
    expect(w.find('[data-role="entity"]').text()).toContain('SSP_1')
    await openSrc(w)
    await srcDevice(w, 'id-SSP_2').trigger('click')
    await settle()
    // calc_ 结果排在前面,与 ts / ts-history 一样
    expect(srcKeys(w)).toEqual(['calc_total_p', 'CB', 'name', 'P', 'Q'])
    await w.find('[data-role="source-point"][data-value="id-SSP_2||P"]').trigger('click')
    expect(last(w).params).toEqual({ entity: { type: 'DEVICE', id: 'id-SSP_2', name: 'SSP_2' }, keys: ['P'] })

    await w.setProps({ modelValue: { mode: 'ext', source: 'kz', params: { entity: D1, keys: ['P'] } } as Binding })
    await w.find('select[data-role="ext-agg"]').setValue('MAX')
    expect(last(w).params).toEqual({ entity: D1, keys: ['P'], agg: 'MAX' })
  })

  it('换成收益趋势:params 整套换掉,站点在树里点(kz 的站点 = 网关设备),指标是下拉', async () => {
    const w = mountExt({
      mode: 'ext',
      source: 'kz',
      window: '30d',
      interval: '1d',
      params: { entity: D1, keys: ['P'] },
    })
    await w.find('select[data-role="ext-kind"]').setValue('revenue')
    // 当前实体是设备,顺手带成站点
    expect(last(w).params).toEqual({ stationId: 'id-SSP_1' })

    await w.setProps({
      modelValue: { mode: 'ext', source: 'kz', interval: '1d', params: { stationId: '' } } as Binding,
    })
    expect(w.find('[data-role="entity"]').text()).toContain('选择站点')
    // 归档历史那一套控件都不见了,换成周期 + 指标
    expect(w.find('select[data-role="ext-agg"]').exists()).toBe(false)
    // 站点只选实体:面板是设备模式,没有测点栏
    await openSrc(w)
    expect(w.find('.dsd-points').exists()).toBe(false)
    await srcDevice(w, 'id-GW1').trigger('click')
    expect(last(w).params).toEqual({ stationId: 'id-GW1' })

    await w.setProps({
      modelValue: { mode: 'ext', source: 'kz', interval: '1d', params: { stationId: 'id-GW1' } } as Binding,
    })
    expect(w.find('[data-role="entity"]').text()).toContain('GW1')
    await w.find('select[data-role="ext-metric"]').setValue('net')
    expect(last(w).params).toEqual({ stationId: 'id-GW1', metric: 'net' })
    await w.find('select[data-role="ext-period"]').setValue('1M')
    expect(last(w).interval).toBe('1M')
  })

  it('遗留配置:多测点给出口;params 形状不认识时自动展开 JSON 后路', async () => {
    const multi = mountExt({ mode: 'ext', source: 'kz', params: { entity: D1, keys: ['P', 'Q'] } })
    const warn = multi.find('[data-role="ext-multi-key-warning"]')
    expect(warn.exists()).toBe(true)
    expect(warn.text()).toContain('Q')
    await warn.find('button').trigger('click')
    expect((last(multi).params as { keys: string[] }).keys).toEqual(['P'])

    const odd = mountExt({ mode: 'ext', source: 'kz', params: { foo: 1 } })
    expect(odd.find('textarea').exists()).toBe(true)
    // 新建绑定时的 ts-history 半成品不该把 JSON 后路顶开(它压根不是 ext)
    const fresh = mountExt({ mode: 'ts-history', entity: D1, keys: [], window: '24h' })
    await fresh.find('select[data-role="mode"]').setValue('ext')
    await fresh.setProps({ modelValue: last(fresh) as unknown as Binding })
    expect(fresh.find('textarea').exists()).toBe(false)
    expect(odd.find('[data-role="entity"]').exists()).toBe(false)
    await odd.find('select[data-role="ext-kind"]').setValue('history')
    expect(last(odd).params).toEqual({ entity: { type: 'DEVICE', id: '', name: '' }, keys: [] })
  })
})

describe('BindingsPanel', () => {
  it('遗留的多测点绑定可以一键拆成多条,每条一个测点(审查 R3)', async () => {
    const def = getWidget('line')!
    const legacy = {
      mode: 'ts-history',
      entity: { type: 'DEVICE', id: 'id-SSP_1', name: 'SSP_1' },
      keys: ['P', 'Q', 'F'],
      window: '24h',
      agg: 'AVG',
    } as Binding
    const widget: WidgetConfig = { id: 'l', slot: 'g1', type: 'line', bindings: { series: [legacy] } }
    const w = mount(BindingsPanel, { props: { def, widget, tree: bigSite(), client: fakeClient() } })
    const warn = w.find('[data-slot="series"] [data-role="multi-key-warning"]')
    expect(warn.exists()).toBe(true)
    await warn.findAll('button')[0]!.trigger('click') // 拆成 3 条绑定
    const series = (w.emitted('update')!.at(-1)![0] as { series: { keys: string[]; window: string; agg: string }[] })
      .series
    expect(series.map(b => b.keys)).toEqual([['P'], ['Q'], ['F']])
    // 其余字段照抄,不用重配
    expect(series.every(b => b.window === '24h' && b.agg === 'AVG')).toBe(true)
  })

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
