// 向导第 3 步声明、第 4 步还没发布的输出:推导逻辑(见 src/editor/declared-keys.ts 头注释)
import { describe, expect, it } from 'vitest'
import { declaredAlarmsFor, declaredFromSiteConfig, declaredKeysFor } from '../src/editor/declared-keys'

const dev = (name: string, keys: string[], profile = 'PCS') => ({
  name,
  type: profile,
  profile,
  keys: keys.map(k => ({ key: k, label: k })),
})
const cfg = (extra: Record<string, unknown> = {}) => ({
  schema: 'tbsite/v2',
  site: { name: '仙人山' },
  outputPrefix: 'calc_',
  devices: [dev('A1', ['p', 'q']), dev('A2', ['p'])],
  ...extra,
})

describe('declaredFromSiteConfig', () => {
  it('推出各类运算的输出 key,带上输出前缀', () => {
    const d = declaredFromSiteConfig(
      cfg({
        computations: [
          { template: 'expr.add', device: 'A1', output: 'pq', inputs: { a: { key: 'p' }, b: { key: 'q' } } },
          { template: 'window.aggregate', device: 'A1', window: '5m', keys: ['p'], aggs: ['avg', 'max'] },
          { template: 'window.cascade', device: 'A2', keys: ['p'], aggs: ['avg'] },
        ],
      })
    )
    const a1 = declaredKeysFor(d, 'DEVICE', 'A1').map(k => k.key)
    expect(a1).toContain('calc_pq') // expr 输出
    expect(a1).toContain('calc_pAvg5m') // 窗口聚合
    expect(a1).toContain('calc_pMax5m')
    // 级联三级都要列出来:页面上画 30 天曲线绑的就是 1d 那一级
    expect(declaredKeysFor(d, 'DEVICE', 'A2').map(k => k.key)).toEqual(['calc_pAvg5m', 'calc_pAvg1h', 'calc_pAvg1d'])
  })

  it('设备模板展开后的输出也算(现场大多用模板批量配)', () => {
    const d = declaredFromSiteConfig(
      cfg({
        deviceTemplates: [
          {
            name: 'T',
            selector: { profiles: ['PCS'] },
            items: [{ template: 'expr.add', output: 'pq', inputs: { a: { key: 'p' }, b: { key: 'q' } } }],
          },
        ],
        computations: [],
      })
    )
    // 模板作用到 A1(有 p 也有 q);A2 只有 p,缺输入的设备不展开 —— 所以它没有这个输出
    expect(declaredKeysFor(d, 'DEVICE', 'A1').map(k => k.key)).toEqual(['calc_pq'])
    expect(declaredKeysFor(d, 'DEVICE', 'A2').map(k => k.key)).toEqual([])
  })

  it('跨设备汇聚落在资产上;超过 10 台时分层的分组键也列出来', () => {
    const many = Array.from({ length: 12 }, (_, i) => dev(`D${i}`, ['p']))
    const d = declaredFromSiteConfig(
      cfg({
        devices: many,
        computations: [
          {
            template: 'aggregate.crossEntity',
            name: 'Σ',
            selector: { profiles: ['PCS'] },
            key: 'p',
            agg: 'sum',
            asset: 'AGG',
            output: 'tot',
          },
        ],
      })
    )
    // output 在展开时就已经加过前缀了
    const agg = declaredKeysFor(d, 'ASSET', 'AGG').map(k => k.key)
    expect(agg).toContain('calc_tot')
    expect(agg).toContain('calc_tot__p0') // 分层分组键
    expect(declaredKeysFor(d, 'DEVICE', 'AGG')).toEqual([]) // 资产的别串到设备上
  })

  it('告警类型单独推:挂在作用设备上;propagate 时站点资产也给', () => {
    const d = declaredFromSiteConfig(
      cfg({
        alarm: { propagate: true },
        computations: [
          {
            template: 'alarm.threshold',
            device: 'A1',
            devices: ['A1', 'A2'],
            key: 'p',
            name: '功率越限告警',
            condition: { op: 'gt', value: 45 },
            severity: 'WARNING',
            message: 'p={value}',
          },
        ],
      })
    )
    expect(declaredAlarmsFor(d, 'DEVICE', 'A1')).toEqual(['功率越限告警'])
    expect(declaredAlarmsFor(d, 'DEVICE', 'A2')).toEqual(['功率越限告警'])
    // 页面的「告警列表」通常绑站点资产,propagate 后全站告警都到这儿
    expect(declaredAlarmsFor(d, 'ASSET', '仙人山')).toEqual(['功率越限告警'])
    // 告警不产生遥测 key
    expect(declaredKeysFor(d, 'DEVICE', 'A1')).toEqual([])
  })

  it('不 propagate 时站点资产上没有告警类型', () => {
    const d = declaredFromSiteConfig(
      cfg({
        computations: [
          {
            template: 'alarm.threshold',
            device: 'A1',
            key: 'p',
            name: '过载',
            condition: { op: 'gt', value: 1 },
            severity: 'MINOR',
            message: 'm',
          },
        ],
      })
    )
    expect(declaredAlarmsFor(d, 'DEVICE', 'A1')).toEqual(['过载'])
    expect(declaredAlarmsFor(d, 'ASSET', '仙人山')).toEqual([])
  })

  it('半成品 / 坏配置不抛,回空 —— 用户正在填的时候编辑器不能崩', () => {
    for (const bad of [null, undefined, 42, 'x', {}, { schema: 'tbsite/v2' }, cfg({ computations: [{}] })])
      expect(() => declaredFromSiteConfig(bad)).not.toThrow()
    expect(declaredFromSiteConfig(null)).toEqual({ keys: [], alarms: [] })
    expect(declaredKeysFor(null, 'DEVICE', 'A1')).toEqual([])
    expect(declaredAlarmsFor(undefined, 'DEVICE', 'A1')).toEqual([])
    expect(declaredKeysFor(declaredFromSiteConfig(cfg()), 'DEVICE', '')).toEqual([])
  })
})
