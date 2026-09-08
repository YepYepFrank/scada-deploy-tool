// ADR-001 二期导出:站点阈值告警 → 同事 JSON(模板数组 + 设备清单);写入 JIZHAN_ALARM_CONFIG 属性(默认不覆盖)
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  ALARM_CONFIG_ASSET,
  expandConfig,
  exportAlarmConfig,
  writeAlarmConfig,
  type TbApi,
  type TbsiteConfig,
} from '../src/index'

const xrs = (): TbsiteConfig =>
  JSON.parse(readFileSync(resolve(__dirname, 'fixtures/xrs-mirror-test.tbsite.json'), 'utf8'))

describe('exportAlarmConfig', () => {
  it('xrs 夹具:模板告警 P>500 展开成 1 条模板 + 32 台 IED 清单,字段与同事样例一致', () => {
    const cfg = xrs()
    const { computations } = expandConfig(cfg)
    const exp = exportAlarmConfig(cfg, computations, { deviceIds: { SSP1_GP1_IED1: 'id-1' } })
    expect(exp.alarm_config).toEqual([
      { title: '功率越限告警', alarm_severity: 'WARNING', operator: '>', key: 'P', value: 500 },
    ])
    expect(exp.alarm_devices.length).toBe(32)
    expect(exp.alarm_devices[0]).toEqual({ entityId: 'id-1', entityName: 'SSP1_GP1_IED1', labelName: 'SSP1_GP1_IED1' })
    expect(Object.keys(exp.alarm_devices[0]!)).toEqual(['entityId', 'entityName', 'labelName'])
    // 31 台没给 id → 一条 note;边沿触发 + 文案各一条
    expect(exp.notes.some(n => n.includes('31 台设备没有 TB id'))).toBe(true)
    expect(exp.notes.some(n => n.includes('边沿触发'))).toBe(true)
    expect(exp.notes.some(n => n.includes('文案'))).toBe(true)
  })

  it('同一模板多处出现只导出一次;规则只覆盖部分设备时提示「全乘」;label 优先用传入的 TB label', () => {
    const cfg: TbsiteConfig = {
      schema: 'tbsite/v2',
      site: { name: 's' },
      devices: [{ name: 'A', label: '甲机' }, { name: 'B' }, { name: 'C' }],
    }
    const comps = [
      {
        template: 'alarm.threshold',
        name: 'Ua 低',
        key: 'Ua',
        condition: { op: 'lt' as const, value: 200 },
        severity: 'WARNING',
        devices: ['A', 'B', 'C'],
      },
      {
        template: 'alarm.threshold',
        name: 'Ua 低',
        key: 'Ua',
        condition: { op: 'lt' as const, value: 200 },
        severity: 'WARNING',
        device: 'A',
      },
      { template: 'alarm.threshold', key: 'Ua', condition: { op: 'gte' as const, value: 240 }, device: 'B' },
      { template: 'expr', device: 'A' },
    ]
    const exp = exportAlarmConfig(cfg, comps, { labels: { B: '乙机(TB)' } })
    expect(exp.alarm_config).toEqual([
      { title: 'Ua 低', alarm_severity: 'WARNING', operator: '<', key: 'Ua', value: 200 },
      { title: 'Ua >= 240', alarm_severity: 'WARNING', operator: '>=', key: 'Ua', value: 240 },
    ])
    expect(exp.alarm_devices.map(d => d.labelName)).toEqual(['甲机', '乙机(TB)', 'C'])
    expect(exp.notes.filter(n => n.includes('只声明在')).length).toBe(2)
  })

  it('没有阈值告警 → 空导出 + 提示', () => {
    const exp = exportAlarmConfig({ schema: 'tbsite/v2', site: { name: 's' }, devices: [] }, [])
    expect(exp.alarm_config).toEqual([])
    expect(exp.alarm_devices).toEqual([])
    expect(exp.notes).toEqual(['站点声明里没有阈值告警,导出为空'])
  })
})

/** 极简 TB:资产查找 / 新建 + SERVER_SCOPE 属性读写 */
function fakeTb(seed: { name: string; attrs?: Record<string, unknown> }[] = []) {
  let seq = 0
  const uid = () => `00000000-0000-0000-0000-${String(++seq).padStart(12, '0')}`
  const assets = seed.map(s => ({ id: { id: uid(), entityType: 'ASSET' }, name: s.name, type: 'default' }))
  const attrs: Record<string, Record<string, unknown>> = {}
  for (const [i, s] of seed.entries()) if (s.attrs) attrs[assets[i]!.id.id] = { ...s.attrs }
  const calls: string[] = []
  const api: TbApi = async (url, data, method) => {
    calls.push(`${method || (data ? 'POST' : 'GET')} ${url}`)
    let m: RegExpMatchArray | null
    if (url.startsWith('/api/tenant/assets?')) {
      const q = decodeURIComponent(url.split('textSearch=')[1] || '')
      return { data: assets.filter(a => a.name.includes(q)) }
    }
    if (url === '/api/asset') {
      const a = { id: { id: uid(), entityType: 'ASSET' }, ...(data as { name: string; type: string }) }
      assets.push(a)
      return a
    }
    if ((m = url.match(/^\/api\/plugins\/telemetry\/ASSET\/([^/]+)\/values\/attributes\/SERVER_SCOPE\?keys=(.+)$/))) {
      const bag = attrs[m[1]!] || {}
      return m[2]!
        .split(',')
        .filter(k => k in bag)
        .map(k => ({ key: k, value: bag[k] }))
    }
    if ((m = url.match(/^\/api\/plugins\/telemetry\/ASSET\/([^/]+)\/attributes\/SERVER_SCOPE$/))) {
      attrs[m[1]!] = { ...(attrs[m[1]!] || {}), ...(data as Record<string, unknown>) }
      return null
    }
    throw new Error('fakeTb: unhandled ' + url)
  }
  return { api, assets, attrs, calls }
}

const sample = () => ({
  alarm_config: [{ title: 'Ua 低', alarm_severity: 'WARNING', operator: '<', key: 'Ua', value: 200 }],
  alarm_devices: [{ entityId: 'x', entityName: 'A', labelName: '甲' }],
  notes: [],
})

describe('writeAlarmConfig', () => {
  it('资产不存在 → 新建 JIZHAN_ALARM_CONFIG 并写 alarm_config / alarm_devices', async () => {
    const tb = fakeTb()
    const r = await writeAlarmConfig(tb.api, sample())
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.created).toBe(true)
    expect(r.previous).toBeNull()
    expect(tb.assets.map(a => a.name)).toEqual([ALARM_CONFIG_ASSET])
    expect(tb.attrs[r.assetId]).toEqual({ alarm_config: sample().alarm_config, alarm_devices: sample().alarm_devices })
  })

  it('已有非空 alarm_config → 默认拒绝并返回现有值;force 才覆盖并把旧值带回', async () => {
    const old = { alarm_config: [{ title: '他们的', alarm_severity: 'MAJOR', operator: '>', key: 'Ia', value: 1 }] }
    const tb = fakeTb([{ name: ALARM_CONFIG_ASSET, attrs: old }])
    const r1 = await writeAlarmConfig(tb.api, sample())
    expect(r1).toMatchObject({ ok: false, reason: 'exists', existing: old })
    expect(tb.attrs[tb.assets[0]!.id.id]).toEqual(old)
    const r2 = await writeAlarmConfig(tb.api, sample(), { force: true })
    expect(r2).toMatchObject({ ok: true, created: false, previous: old })
    expect(tb.attrs[tb.assets[0]!.id.id]!.alarm_config).toEqual(sample().alarm_config)
  })

  it('已有但为空(空数组 / 空串)→ 视为没有,直接写', async () => {
    const tb = fakeTb([{ name: ALARM_CONFIG_ASSET, attrs: { alarm_config: '[]' } }])
    const r = await writeAlarmConfig(tb.api, sample())
    expect(r.ok).toBe(true)
  })
})
