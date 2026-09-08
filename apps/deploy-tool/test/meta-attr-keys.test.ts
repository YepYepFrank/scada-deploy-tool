// T3.11 收尾:向导「元数据读取」的属性 key 列表(MetaClient.attrKeys)——按 scope 走对应接口、排序、缓存;
// 遥测 key 列表(tsKeys)带最新值与类型判断。Asset 树的用例在 meta-tree.test.ts。
import { describe, expect, it } from 'vitest'
import { MetaClient } from '../src/meta/MetaNode'

const dev = { type: 'DEVICE' as const, id: 'd1' }

describe('MetaClient.attrKeys / tsKeys', () => {
  it('attrKeys:按 scope 请求 /keys/attributes/<scope>,结果排序;同实体同 scope 只请求一次', async () => {
    const calls: string[] = []
    const api = async (url: string) => {
      calls.push(url)
      if (url.endsWith('/keys/attributes/SERVER_SCOPE')) return ['siteConfig', 'calcCascadeKeys', 'almState_P_gt']
      if (url.endsWith('/keys/attributes/SHARED_SCOPE')) return []
      return null
    }
    const mc = new MetaClient(api)
    expect(await mc.attrKeys(dev, 'SERVER_SCOPE')).toEqual(['almState_P_gt', 'calcCascadeKeys', 'siteConfig'])
    expect(await mc.attrKeys(dev, 'SERVER_SCOPE')).toEqual(['almState_P_gt', 'calcCascadeKeys', 'siteConfig'])
    expect(await mc.attrKeys(dev, 'SHARED_SCOPE')).toEqual([])
    expect(calls).toEqual([
      '/api/plugins/telemetry/DEVICE/d1/keys/attributes/SERVER_SCOPE',
      '/api/plugins/telemetry/DEVICE/d1/keys/attributes/SHARED_SCOPE',
    ])
    mc.clear()
    await mc.attrKeys(dev, 'SERVER_SCOPE')
    expect(calls.length).toBe(3)
  })

  it('attrKeys:接口返回 null(实体没属性)当空列表', async () => {
    const mc = new MetaClient(async () => null)
    expect(await mc.attrKeys(dev, 'CLIENT_SCOPE')).toEqual([])
  })

  it('tsKeys:key 按 localeCompare 排序,带最新值与 kind(数值字符串转 number;无值 kind 为 undefined)', async () => {
    const api = async (url: string) => {
      if (url.endsWith('/keys/timeseries')) return ['P', 'COM', 'calc_pqSum', 'noValue']
      if (url.includes('/values/timeseries?keys='))
        return { P: [{ ts: 1, value: '43.5' }], COM: [{ ts: 1, value: 12 }], calc_pqSum: [{ ts: 1, value: null }] }
      return null
    }
    const keys = await new MetaClient(api).tsKeys(dev)
    expect(keys.map(k => k.key)).toEqual(['calc_pqSum', 'COM', 'noValue', 'P']) // localeCompare:大小写不敏感
    expect(keys.find(k => k.key === 'P')).toMatchObject({ latest: 43.5, kind: 'number' })
    expect(keys.find(k => k.key === 'COM')).toMatchObject({ latest: 12, kind: 'number' })
    expect(keys.find(k => k.key === 'calc_pqSum')).toMatchObject({ latest: null, kind: 'null' })
    expect(keys.find(k => k.key === 'noValue')!.kind).toBeUndefined()
  })
})
