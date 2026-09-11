// 名称显示约定(2026-09-11):网关、设备、测点「中文(英文)」,没有中文只显示英文。
import { describe, expect, it } from 'vitest'
import { deviceCn, dual, hasCn, isKeyDictAsset, keyCnFrom, parseKeyDict } from '../src/naming'

describe('名称显示:中文(英文)', () => {
  it('有中文:中文在前、英文用全角括号包住;没有中文或中文就是英文本身:只显示英文', () => {
    expect(dual('有功功率', 'P')).toBe('有功功率（P）')
    expect(dual('  仙人山服务区  ', 'mgcc_xrs')).toBe('仙人山服务区（mgcc_xrs）')
    expect(dual('', 'P')).toBe('P')
    expect(dual(null, 'P')).toBe('P')
    expect(dual('Gateway', 'xrs_fileserver')).toBe('xrs_fileserver') // 标签是英文,不算中文名
    expect(dual('温度', '温度')).toBe('温度') // 键名本身就是中文
  })

  it('设备 / 网关的中文名:标签优先,其次描述;都不含汉字就没有', () => {
    expect(deviceCn({ label: '仙人山服务区北区一级开闭所', additionalInfo: { description: '别的' } })).toBe(
      '仙人山服务区北区一级开闭所'
    )
    expect(deviceCn({ label: 'Gateway', additionalInfo: { description: '润扬大桥储能' } })).toBe('润扬大桥储能')
    expect(deviceCn({ label: 'Gateway', desc: 'Gateway for project' })).toBe('')
    expect(deviceCn({})).toBe('')
    expect(hasCn('SSP1')).toBe(false)
  })

  it('测点中文名:字典直查、派生测点合成、去掉 calc_ 前缀再认;字典解析跳过坏条目', () => {
    const dict = parseKeyDict([
      { key: 'P', value: '{"name":"有功功率","unit":"kW","type":"YC"}' },
      { key: 'Ua', value: { name: 'A相电压', unit: 'V' } },
      { key: 'bad', value: '{oops' },
      { key: 'noname', value: '{"unit":"V"}' },
    ])
    expect(Object.keys(dict)).toEqual(['P', 'Ua'])
    expect(keyCnFrom(dict, 'P')).toBe('有功功率')
    expect(keyCnFrom(dict, 'PAvg5m')).toBe('有功功率 · 均值(5分钟)')
    expect(keyCnFrom(dict, 'calc_PAvg5m')).toBe('有功功率 · 均值(5分钟)')
    expect(keyCnFrom(dict, 'calc_P')).toBe('有功功率')
    expect(keyCnFrom(dict, 'PUsed1h')).toBe('有功功率 · 区间用量(1小时)')
    expect(keyCnFrom(dict, 'revenue5mIncomeDaily')).toBe('收益 · 放电收入·当日累计')
    expect(keyCnFrom(dict, 'totalP')).toBe('全站合计 · 有功功率')
    expect(keyCnFrom(dict, 'temperature')).toBe('')
    expect(dual(keyCnFrom(dict, 'Ua'), 'Ua')).toBe('A相电压（Ua）')
    expect(isKeyDictAsset({ name: '遥测单位名称匹配接口' })).toBe(true)
    expect(isKeyDictAsset({ name: 'x', type: '单位名称匹配表' })).toBe(true)
    expect(isKeyDictAsset({ name: 'x', type: 'tbsite' })).toBe(false)
  })
})
