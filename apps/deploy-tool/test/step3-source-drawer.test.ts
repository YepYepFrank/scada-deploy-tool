/**
 * 第 3 步「数据源」面板(2026-09-23 YY:下拉太难用,点格子后右侧弹面板点选;站 → 网关 → 设备 → 测点):
 * 数据整理(纯函数)+ 面板三种用法(测点 / 设备 / 同名测点)、搜索、常数、键盘、最近设备。
 */
import { describe, expect, it } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { dual } from '../src/naming'
import {
  CONST_VALUE,
  ORPHAN_GROUP_LABEL,
  buildSourceGroups,
  filterGroups,
  joinPointValue,
  searchPoints,
  splitPointValue,
  type StepDevice,
} from '../src/provisioner/source-picker'
import DataSourceDrawer from '../src/provisioner/DataSourceDrawer.vue'
import SourceField from '../src/provisioner/SourceField.vue'

const k = (key: string, label = '', claimed = true, latest?: unknown, unit = '') => ({
  key,
  label,
  claimed,
  latest,
  unit,
})
const DEVICES: StepDevice[] = [
  { name: 'GW2', cn: '2# 网关', tbId: 'g2', isGateway: true, keys: [] },
  { name: 'GW1', cn: '1# 网关', tbId: 'g1', isGateway: true, keys: [k('COM', '通讯状态')] },
  {
    name: 'IED1',
    cn: '1# 出线保护',
    gwId: 'g1',
    keys: [k('P', '有功功率', true, 125.6, 'kW'), k('T1_CB', '开关位置'), k('Ub', '', false)],
  },
  { name: 'METER1', cn: '关口电表', gwId: 'g1', keys: [k('EPI', '正向有功电能', true, 12345)] },
  { name: 'PCS1', cn: '储能变流器', gwId: 'g2', keys: [k('CHG_E', '累计充电量'), k('DIS_E', '累计放电量')] },
  { name: 'EV1', cn: '充电桩', gwId: 'nope', keys: [k('P', '有功功率')] },
  { name: 'IDLE', cn: '没认领的', gwId: 'g2', keys: [k('X', '', false)] },
]
const opts = {
  keyCn: (x: { label?: string }) => x.label ?? '',
  dual,
  dict: { T1_CB: { type: 'YX' }, P: { type: 'YC', unit: 'kW' } },
}
const groups = buildSourceGroups(DEVICES, opts)

describe('整理成 站 → 网关 → 设备 → 测点', () => {
  it('网关按名排、网关本体认领了测点也能选、没挂网关的归直连组放最后;没认领的设备不列', () => {
    expect(groups.map(g => g.label)).toEqual(['1# 网关（GW1）', '2# 网关（GW2）', ORPHAN_GROUP_LABEL])
    expect(groups[0]!.self?.name).toBe('GW1')
    expect(groups[0]!.devices.map(d => d.name)).toEqual(['IED1', 'METER1'])
    expect(groups[1]!.self).toBeUndefined()
    expect(groups[1]!.devices.map(d => d.name)).toEqual(['PCS1'])
    expect(groups[2]!.devices.map(d => d.name)).toEqual(['EV1'])
  })
  it('测点行:只列认领的;中文名、遥测 / 遥信、单位、最近值', () => {
    const ied = groups[0]!.devices[0]!
    expect(ied.points).toEqual([
      { key: 'P', text: '有功功率（P）', kind: '遥测', unit: 'kW', latest: '125.6' },
      { key: 'T1_CB', text: '开关位置（T1_CB）', kind: '遥信', unit: '', latest: '' },
    ])
  })
  it('only / note:常用方案只列具备所需测点的设备,带「可用 n/m 项」', () => {
    const g = buildSourceGroups(DEVICES, { ...opts, only: new Set(['IED1']), note: () => '可用 3/3 项' })
    expect(g.map(x => x.devices.map(d => [d.name, d.note]))).toEqual([[['IED1', '可用 3/3 项']]])
  })
  it('搜索:测点名 / key 命中跨网关列出;设备名命中列它的全部测点;左侧树只留相关设备', () => {
    expect(searchPoints(groups, '电量').map(h => `${h.device.name}.${h.point.key}`)).toEqual([
      'PCS1.CHG_E',
      'PCS1.DIS_E',
    ])
    expect(searchPoints(groups, '关口').map(h => h.point.key)).toEqual(['EPI'])
    expect(searchPoints(groups, 'p', 2)).toHaveLength(2)
    expect(filterGroups(groups, '电量').map(g => g.devices.map(d => d.name))).toEqual([['PCS1']])
    expect(filterGroups(groups, '1# 网关')[0]!.devices).toHaveLength(2)
  })
  it('值的格式与原来的下拉一致:设备||测点', () => {
    expect(joinPointValue('IED1', 'P')).toBe('IED1||P')
    expect(splitPointValue('IED1||P')).toEqual({ device: 'IED1', key: 'P' })
    expect(splitPointValue('P')).toBeNull()
  })
})

describe('数据源面板', () => {
  const open = (props: Record<string, unknown>) =>
    mount(DataSourceDrawer, { props: { open: true, title: 't', groups, ...props }, attachTo: document.body })

  it('测点:停在当前值的设备上、它的网关展开;点一行交出「设备||测点」', async () => {
    const w = open({ value: 'METER1||EPI' })
    await flushPromises()
    expect(w.find('.dsd-dev.on').attributes('data-name')).toBe('METER1')
    expect(w.find('.dsd-row.cur').attributes('data-value')).toBe('METER1||EPI')
    await w.find('[data-role="source-device"][data-name="IED1"]').trigger('click')
    await w.find('[data-role="source-point"][data-value="IED1||T1_CB"]').trigger('click')
    expect(w.emitted('pick')).toEqual([['IED1||T1_CB']])
    w.unmount()
  })
  it('没有当前值:按 上下文设备 → 最近用过 → 第一台 的顺序停', async () => {
    let w = open({ ctxDevice: 'PCS1', recent: ['IED1'] })
    await flushPromises()
    expect(w.find('.dsd-dev.on').attributes('data-name')).toBe('PCS1')
    w.unmount()
    w = open({ recent: ['GONE', 'IED1'] })
    await flushPromises()
    expect(w.find('.dsd-dev.on').attributes('data-name')).toBe('IED1')
    expect(w.findAll('[data-role="source-recent"]').map(b => b.text())).toEqual(['1# 出线保护（IED1）'])
    w.unmount()
  })
  it('搜索跨网关出结果(带设备名);↓ 回车选中;Esc 关闭', async () => {
    const w = open({})
    await flushPromises()
    const q = w.find('[data-role="source-search"]')
    expect(document.activeElement).toBe(q.element)
    await q.setValue('电量')
    expect(w.findAll('[data-role="source-point"]').map(b => b.attributes('data-value'))).toEqual([
      'PCS1||CHG_E',
      'PCS1||DIS_E',
    ])
    await q.trigger('keydown', { key: 'ArrowDown' })
    await q.trigger('keydown', { key: 'Enter' })
    expect(w.emitted('pick')).toEqual([['PCS1||DIS_E']])
    await q.trigger('keydown', { key: 'Escape' })
    expect(w.emitted('close')).toHaveLength(1)
    w.unmount()
  })
  it('四则运算可以选「常数」', async () => {
    const w = open({ allowConst: true })
    await w.find('[data-role="source-const"]').trigger('click')
    expect(w.emitted('pick')).toEqual([[CONST_VALUE]])
    w.unmount()
  })
  it('设备:整个面板就是网关 → 设备树,点设备即选中;没设备时显示调用方的说明', async () => {
    const w = open({ mode: 'device' })
    await flushPromises()
    expect(w.find('.dsd-points').exists()).toBe(false)
    await w.find('[data-role="source-gw"][data-id="gw:GW2"]').trigger('click')
    await w.find('[data-role="source-device"][data-name="PCS1"]').trigger('click')
    expect(w.emitted('pick')).toEqual([['PCS1']])
    w.unmount()
    const e = open({ mode: 'device', groups: [], emptyText: '没有具备所需测点的设备' })
    expect(e.find('[data-role="source-empty"]').text()).toBe('没有具备所需测点的设备')
    e.unmount()
  })
  it('同名测点(设备模板 / 汇聚):只列 key 与覆盖台数,可搜', async () => {
    const w = open({
      mode: 'key',
      keyScope: '模板匹配的 2 台设备',
      keys: [
        { key: 'P', text: '有功功率（P）', note: '2/2 台' },
        { key: 'Q', text: '无功功率（Q）', note: '1/2 台' },
      ],
    })
    expect(w.text()).toContain('模板匹配的 2 台设备')
    await w.find('[data-role="source-search"]').setValue('无功')
    expect(w.findAll('[data-role="source-key"]').map(b => b.text())).toEqual(['无功功率（Q）1/2 台'])
    await w.find('[data-role="source-key"]').trigger('click')
    expect(w.emitted('pick')).toEqual([['Q']])
    w.unmount()
  })
})

describe('取数的格子', () => {
  it('显示已选内容;没选显示提示;点了发 open', async () => {
    const w = mount(SourceField, { props: { text: '', placeholder: '点击选择测点…' } })
    expect(w.text()).toContain('点击选择测点…')
    expect(w.classes()).toContain('empty')
    await w.trigger('click')
    expect(w.emitted('open')).toHaveLength(1)
    await w.setProps({ text: '关口电表 · 正向有功电能', active: true })
    expect(w.classes()).toEqual(expect.arrayContaining(['active']))
  })
})
