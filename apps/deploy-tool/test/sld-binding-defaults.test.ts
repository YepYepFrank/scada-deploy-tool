// T5.6 从设备树拖设备进画布的默认规则:图元选择 / 默认测点
import { describe, expect, it } from 'vitest'
import { getSldSymbol, registerBuiltinSldSymbols } from '@grid/scada-renderer'
import {
  FALLBACK_SYMBOL,
  MAX_DEFAULT_LABELS,
  SYMBOL_RULES,
  defaultPoints,
  matchKeyword,
  pickSymbol,
} from '../src/sld-editor/device-defaults'

registerBuiltinSldSymbols()

describe('pickSymbol', () => {
  it.each([
    ['PDR1_LP1_IED1', 'breaker'],
    ['1# 进线保护', 'breaker'],
    ['QF3', 'breaker'],
    ['母联断路器', 'breaker'],
    ['PDR1_METER2', 'meter'],
    ['关口电表', 'meter'],
    ['ESS_PCS1', 'pcs'],
    ['BMS_01', 'battery'],
    ['1# 电池簇', 'battery'],
    ['PV_INV3', 'inverter'],
    ['光伏逆变器 2', 'inverter'],
    ['1# 充电桩', 'charger'],
    ['1# 主变压器', 'transformer-2w'],
    ['TR1', 'transformer-2w'],
    ['除湿机', FALLBACK_SYMBOL],
  ])('%s → %s', (name, symbol) => {
    expect(pickSymbol({ name })).toBe(symbol)
  })

  it('ASCII 关键字按词匹配:TR 不命中 CONTROL', () => {
    expect(matchKeyword('CONTROL_BOX', 'TR')).toBe(false)
    expect(matchKeyword('1#TR', 'TR')).toBe(true)
    expect(matchKeyword('pcs_1', 'PCS')).toBe(true)
    expect(pickSymbol({ name: 'CONTROL_BOX' })).toBe(FALLBACK_SYMBOL)
  })

  it('名字看不出来时看设备类型;名字优先', () => {
    expect(pickSymbol({ name: 'DEV_07', deviceType: 'PCS' })).toBe('pcs')
    expect(pickSymbol({ name: 'DEV_07_METER', deviceType: 'PCS' })).toBe('meter')
    expect(pickSymbol({ name: 'DEV_07', deviceType: 'default' })).toBe(FALLBACK_SYMBOL)
  })

  it('规则表里的图元都在内置图元库里', () => {
    for (const r of SYMBOL_RULES) expect(getSldSymbol(r.symbol), r.symbol).toBeDefined()
    expect(getSldSymbol(FALLBACK_SYMBOL)).toBeDefined()
  })
})

describe('defaultPoints', () => {
  it('断路器:挑状态测点(默认 1 合 0 分)+ P / Q', () => {
    const r = defaultPoints('breaker', ['foo', 'switch_state', 'P', 'Q'])
    expect(r.state).toEqual({ key: 'switch_state', map: { '1': 'closed', '0': 'open' } })
    expect(r.labels.map(l => l.key)).toEqual(['P', 'Q'])
    expect(r.labels[0]).toMatchObject({ title: 'P', unit: 'kW', digits: 1 })
  })

  it('分位信号的映射取反', () => {
    expect(defaultPoints('breaker', ['分闸位置']).state).toEqual({
      key: '分闸位置',
      map: { '1': 'open', '0': 'closed' },
    })
  })

  it('没有 stateBody 的图元不挑状态', () => {
    expect(defaultPoints('meter', ['switch_state', 'P']).state).toBeUndefined()
  })

  it('三相电流 / 线电压自动配 A / B / C 相色', () => {
    const r = defaultPoints('meter', ['Ia', 'Ib', 'Ic', 'Uab', 'Ubc', 'Uca'])
    expect(r.labels.map(l => [l.title, l.color])).toEqual([
      ['Ia', 'a'],
      ['Ib', 'b'],
      ['Ic', 'c'],
      ['Uab', 'a'],
      ['Ubc', 'b'],
      ['Uca', 'c'],
    ])
  })

  it('三相不齐不加;超过上限的整组跳过、单个量继续补', () => {
    expect(defaultPoints('meter', ['Ia', 'Ib']).labels).toEqual([])
    const r = defaultPoints('meter', ['P', 'Q', 'Ia', 'Ib', 'Ic', 'Uab', 'Ubc', 'Uca', 'F'])
    expect(r.labels.map(l => l.title)).toEqual(['P', 'Q', 'Ia', 'Ib', 'Ic', 'F'])
    expect(r.labels.length).toBeLessThanOrEqual(MAX_DEFAULT_LABELS)
  })

  it('电池优先 SOC', () => {
    expect(defaultPoints('battery', ['P', 'SOC', 'U']).labels.map(l => l.title)).toEqual(['SOC', 'U', 'P'])
  })

  it('key 不存在就不加', () => {
    expect(defaultPoints('breaker', [])).toEqual({ labels: [] })
    expect(defaultPoints('pcs', ['temperature', 'fault_code'])).toEqual({ labels: [] })
  })
})
