// ext(kz)绑定的形状判定与静态检查:编辑器表单与校验层共用这一份规则。
import { describe, expect, it } from 'vitest'
import {
  checkExt,
  emptyExtParams,
  extAgg,
  extComplete,
  extEntity,
  extKeys,
  extKind,
  extMetric,
  extStationId,
} from '../src/editor/ext-params'

const SSP = { type: 'DEVICE', id: 'id-SSP_1', name: 'SSP_1' } as const
const hist = (over: Record<string, unknown> = {}) => ({
  mode: 'ext' as const,
  source: 'kz',
  window: '30d',
  interval: '1d',
  params: { entity: SSP, keys: ['P'], ...over },
})
const rev = (over: Record<string, unknown> = {}) => ({
  mode: 'ext' as const,
  source: 'kz',
  interval: '1d',
  params: { stationId: 'id-GW1', metric: 'net', ...over },
})
const msgs = (b: unknown) => checkExt(b).map(i => `${i.level} ${i.sub} ${i.message}`)

describe('ext(kz)参数形状', () => {
  it('分支判定与 tbClient 的分派条件一致:params.keys 是数组 → 归档历史,否则看 stationId', () => {
    expect(extKind(hist())).toBe('history')
    // keys 空数组也是数组:tbClient 会走通用查询然后报「keys 为空」,编辑器得跟它站在同一边
    expect(extKind(hist({ keys: [] }))).toBe('history')
    expect(extKind(rev())).toBe('revenue')
    expect(extKind({ source: 'kz', params: {} })).toBe('unknown')
    expect(extKind({ source: 'kz' })).toBe('unknown')
    // stationId 与 keys 都在时,以 keys 为准 —— tbClient 就是这么判的
    expect(extKind({ source: 'kz', params: { keys: ['P'], stationId: 'x' } })).toBe('history')
  })

  it('取值助手对残缺 params 不抛', () => {
    expect(extEntity(hist())).toEqual(SSP)
    expect(extKeys(hist({ keys: ['P', 'Q'] }))).toEqual(['P', 'Q'])
    expect(extAgg(hist({ agg: 'MAX' }))).toBe('MAX')
    expect(extStationId(rev())).toBe('id-GW1')
    expect(extMetric(rev())).toBe('net')
    for (const bad of [null, undefined, 42, 'x', {}, { params: null }, { params: [] }]) {
      expect(extEntity(bad)).toBeUndefined()
      expect(extKeys(bad)).toEqual([])
      expect(extStationId(bad)).toBe('')
    }
  })

  it('emptyExtParams:换查询类型时带上当前实体,收益趋势只认设备', () => {
    expect(emptyExtParams('history', SSP)).toEqual({ entity: SSP, keys: [] })
    expect(emptyExtParams('revenue', SSP)).toEqual({ stationId: 'id-SSP_1' })
    // 资产不能当站点(kz 的站点是网关设备)
    expect(emptyExtParams('revenue', { type: 'ASSET', id: 'a1', name: 'a1' })).toEqual({ stationId: '' })
    expect(emptyExtParams('history')).toEqual({ entity: { type: 'DEVICE', id: '', name: '' }, keys: [] })
  })

  it('extComplete:两种形状各自的必填', () => {
    expect(extComplete(hist())).toBe(true)
    expect(extComplete(hist({ keys: [] }))).toBe(false)
    expect(extComplete(hist({ entity: { type: 'DEVICE', id: '', name: '' } }))).toBe(false)
    expect(extComplete(rev())).toBe(true)
    expect(extComplete(rev({ stationId: '' }))).toBe(false)
    expect(extComplete({ source: '', params: { keys: ['P'], entity: SSP } })).toBe(false)
    expect(extComplete({ source: 'kz', params: {} })).toBe(false)
  })

  it('好的配置一条不报', () => {
    expect(checkExt(hist())).toEqual([])
    expect(checkExt(hist({ agg: 'ZD' }))).toEqual([])
    expect(checkExt(rev())).toEqual([])
  })

  it('源 / 粒度:非 kz 与不认识的粒度都是 error', () => {
    expect(msgs({ ...hist(), source: 'influx' })[0]).toMatch(/error \/source .*influx.*只有 kz/)
    expect(msgs({ ...hist(), source: '' })[0]).toMatch(/error \/source/)
    expect(msgs({ ...hist(), interval: '10m' })[0]).toMatch(/error \/interval .*10m/)
  })

  it('归档历史:实体 / 测点必填,多测点按「一条绑定一条序列」拦住,聚合限 kz 支持的', () => {
    expect(msgs(hist({ entity: undefined }))[0]).toMatch(/error \/params\/entity/)
    expect(msgs(hist({ keys: [] }))[0]).toMatch(/error \/params\/keys .*为空/)
    const multi = msgs(hist({ keys: ['P', 'Q', 'CB'] }))
    expect(multi[0]).toMatch(/error \/params\/keys/)
    expect(multi[0]).toContain('只会用第一个测点「P」')
    expect(multi[0]).toContain('Q、CB')
    expect(multi[0]).toContain('添加一条')
    expect(msgs(hist({ agg: 'SUM' }))[0]).toMatch(/error \/params\/agg .*SUM/)
    // 年桶只回单点:不拦,给个提醒
    expect(msgs({ ...hist(), interval: '1y' })).toEqual([expect.stringMatching(/^warning \/interval .*年桶只回单点/)])
  })

  it('收益趋势:站点必填;指标没选是 warning(默认只画第一条),写错是 error', () => {
    expect(msgs(rev({ stationId: '' }))[0]).toMatch(/error \/params\/stationId/)
    const noMetric = msgs(rev({ metric: undefined }))
    expect(noMetric).toHaveLength(1)
    expect(noMetric[0]).toMatch(/^warning \/params\/metric/)
    expect(noMetric[0]).toContain('放电收益')
    expect(msgs(rev({ metric: 'profit' }))[0]).toMatch(/error \/params\/metric .*profit/)
  })

  it('params 两种形状都不像 → error,说清 kz 无法分派', () => {
    const m = msgs({ mode: 'ext', source: 'kz', params: { foo: 1 } })
    expect(m).toEqual([expect.stringMatching(/^error \/params .*无法分派/)])
  })
})
