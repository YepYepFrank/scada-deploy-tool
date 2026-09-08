// 第 7 项:严格 PagePayload、按站点漂移检测、迁移表执行(纯函数 + 内存 TB)
import { describe, expect, it } from 'vitest'
import {
  applyRenameTable,
  collectEntityRefs,
  detectSiteDrift,
  diffJson,
  normalizeEntityRefs,
  rewritePageKeys,
  summarizeDiff,
  type PagePayload,
  type RenameEntry,
  type TbApi,
  type TbsiteConfig,
} from '../src/index'

const page = (): PagePayload => ({
  schemaVersion: 1,
  template: 'overview-a',
  title: '总览',
  widgets: [
    {
      id: 'w-a',
      slot: 'a',
      type: 'number-card',
      bindings: { value: { mode: 'ts', entity: { type: 'DEVICE', id: '', name: 'D1' }, key: 'PAvg5m' } },
    },
    {
      id: 'w-b',
      slot: 'b',
      type: 'line-chart',
      bindings: {
        series: [
          { mode: 'ts-history', entity: { type: 'DEVICE', id: '', name: 'D1' }, keys: ['PAvg5m', 'P'], window: '24h' },
          {
            mode: 'ext',
            source: 'kz',
            window: '30d',
            params: { entity: { type: 'ASSET', id: '', name: 'AGG' }, keys: ['totalP'] },
          },
        ],
      },
    },
    { id: 'w-c', slot: 'c', type: 'text', bindings: { text: { mode: 'const', value: 'hi' } } },
  ],
})

describe('严格 PagePayload · collectEntityRefs', () => {
  it('收集 ts / ts-history 的 entity 与 ext.params.entity;const 不算', () => {
    const refs = collectEntityRefs(page())
    expect(refs.map(r => `${r.at}:${r.ref.type}/${r.ref.name}`)).toEqual([
      'w-a/value:DEVICE/D1',
      'w-b/series/0:DEVICE/D1',
      'w-b/series/1/params:ASSET/AGG',
    ])
  })
})

describe('diffJson / normalizeEntityRefs', () => {
  it('对象按键、数组按 name 对齐、叶子按值;ignore 键跳过', () => {
    const a = {
      site: { name: 's', publishedAt: 1 },
      devices: [{ name: 'D1', type: 'IED' }, { name: 'D2' }],
      outputPrefix: 'calc_',
    }
    const b = { site: { name: 's', publishedAt: 2 }, devices: [{ name: 'D1', type: 'METER' }, { name: 'D3' }] }
    const d = diffJson(a, b, { ignore: ['publishedAt'] })
    expect(d).toEqual([
      { path: 'devices[D1].type', kind: 'changed', local: 'IED', remote: 'METER' },
      { path: 'devices[D2]', kind: 'added', local: '{1 字段}' },
      { path: 'devices[D3]', kind: 'removed', remote: '{1 字段}' },
      { path: 'outputPrefix', kind: 'added', local: 'calc_' },
    ])
    expect(summarizeDiff(d)[0]).toContain('devices[D1].type')
    expect(diffJson(a, a)).toEqual([])
  })
  it('实体引用归一后,本地按名 / 线上按 id 不算差异', () => {
    const local = page()
    const remote = JSON.parse(JSON.stringify(local)) as PagePayload
    const b = remote.widgets[0]!.bindings.value as { entity: { id: string } }
    b.entity.id = 'real-id'
    expect(diffJson(local, remote).length).toBe(1)
    expect(diffJson(normalizeEntityRefs(local), normalizeEntityRefs(remote))).toEqual([])
  })
})

describe('rewritePageKeys', () => {
  it('按实体名 + 旧 key 改名:ts.key、ts-history.keys、ext.params.keys;别的实体同名 key 不动', () => {
    const rows: RenameEntry[] = [
      { entityType: 'DEVICE', entity: 'D1', old: 'PAvg5m', new: 'calc_PAvg5m', since: 't' },
      { entityType: 'ASSET', entity: 'AGG', old: 'totalP', new: 'calc_totalP', since: 't' },
      { entityType: 'DEVICE', entity: 'D9', old: 'P', new: 'calc_P', since: 't' },
    ]
    const src = page()
    const { page: out, changes } = rewritePageKeys(src, rows)
    expect(changes).toEqual([
      { at: 'w-a/value', entity: 'D1', old: 'PAvg5m', new: 'calc_PAvg5m' },
      { at: 'w-b/series/0', entity: 'D1', old: 'PAvg5m', new: 'calc_PAvg5m' },
      { at: 'w-b/series/1', entity: 'AGG', old: 'totalP', new: 'calc_totalP' },
    ])
    expect((out.widgets[0]!.bindings.value as { key: string }).key).toBe('calc_PAvg5m')
    const s = out.widgets[1]!.bindings.series as unknown as [{ keys: string[] }, { params: { keys: string[] } }]
    expect(s[0].keys).toEqual(['calc_PAvg5m', 'P'])
    expect(s[1].params.keys).toEqual(['calc_totalP'])
    // 原对象不动
    expect((src.widgets[0]!.bindings.value as { key: string }).key).toBe('PAvg5m')
  })
})

/** 内存 TB:设备 / 资产按名查、时序按 key 存、CF 列表 / 删除、时序删除 */
function fakeTb() {
  const devices = [{ id: { id: 'dev-1' }, name: 'D1' }]
  const assets = [{ id: { id: 'site-1' }, name: 'S1', type: 'tbsite' }]
  const ts: Record<string, Record<string, { ts: number; value: unknown }[]>> = { 'dev-1': {} }
  const cfs: Record<string, { id: { id: string }; name: string }[]> = {
    'dev-1': [{ id: { id: 'cf-old' }, name: 'PAvg5m' }],
  }
  const attrs: Record<string, Record<string, unknown>> = {}
  const calls: string[] = []
  const api: TbApi = async (url, data, method) => {
    calls.push(`${method || (data ? 'POST' : 'GET')} ${url}`)
    let m: RegExpMatchArray | null
    if (url.startsWith('/api/tenant/devices?')) {
      const q = decodeURIComponent(url.split('textSearch=')[1] || '')
      return { data: devices.filter(d => d.name.includes(q)) }
    }
    if (url.startsWith('/api/tenant/assets?')) {
      const q = decodeURIComponent(url.split('textSearch=')[1] || '')
      return { data: assets.filter(a => a.name.includes(q)) }
    }
    if ((m = url.match(/^\/api\/plugins\/telemetry\/(\w+)\/([^/]+)\/values\/timeseries\?(.+)$/))) {
      const p = new URLSearchParams(m[3])
      const key = p.get('keys')!
      const start = Number(p.get('startTs')),
        end = Number(p.get('endTs')),
        limit = Number(p.get('limit'))
      const desc = p.get('orderBy') === 'DESC'
      let pts = (ts[m[2]!]?.[key] ?? []).filter(x => x.ts >= start && x.ts <= end).sort((a, b) => a.ts - b.ts)
      if (desc) pts = pts.reverse()
      return { [key]: pts.slice(0, limit) }
    }
    if ((m = url.match(/^\/api\/plugins\/telemetry\/(\w+)\/([^/]+)\/timeseries\/ANY$/))) {
      const bag = (ts[m[2]!] ||= {})
      for (const e of data as { ts: number; values: Record<string, unknown> }[])
        for (const [k, v] of Object.entries(e.values)) (bag[k] ||= []).push({ ts: e.ts, value: v })
      return null
    }
    if ((m = url.match(/^\/api\/plugins\/telemetry\/(\w+)\/([^/]+)\/timeseries\/delete\?keys=([^&]+)/))) {
      delete ts[m[2]!]?.[decodeURIComponent(m[3]!)]
      return null
    }
    if ((m = url.match(/^\/api\/(\w+)\/([^/]+)\/calculatedFields/))) return { data: cfs[m[2]!] ?? [] }
    if ((m = url.match(/^\/api\/calculatedField\/(.+)$/)) && method === 'DELETE') {
      for (const k of Object.keys(cfs)) cfs[k] = cfs[k]!.filter(c => c.id.id !== m![1])
      return null
    }
    if ((m = url.match(/^\/api\/plugins\/telemetry\/ASSET\/([^/]+)\/values\/attributes\/SERVER_SCOPE\?keys=(.+)$/))) {
      const bag = attrs[m[1]!] || {}
      return m[2]!
        .split(',')
        .filter(k => k in bag)
        .map(k => ({ key: k, value: bag[k] }))
    }
    if (url.startsWith('/api/relations?')) return []
    throw new Error('fakeTb: unhandled ' + url)
  }
  return { api, ts, cfs, attrs, calls }
}

describe('applyRenameTable', () => {
  const row: RenameEntry = { entityType: 'DEVICE', entity: 'D1', old: 'PAvg5m', new: 'calc_PAvg5m', since: 't' }
  const seed = (tb: ReturnType<typeof fakeTb>) => {
    tb.ts['dev-1']!.PAvg5m = [100, 200, 300, 400, 500].map(t => ({ ts: t, value: String(t / 10) }))
    tb.ts['dev-1']!.calc_PAvg5m = [
      { ts: 400, value: 40 },
      { ts: 500, value: 50 },
    ] // 新 key 从 400 起
  }
  it('dry-run:只统计新 key 首点之前的旧点,不写', async () => {
    const tb = fakeTb()
    seed(tb)
    const r = await applyRenameTable(tb.api, [row], { pageSize: 2 })
    expect(r[0]).toMatchObject({ entityId: 'dev-1', points: 3, range: { from: 100, to: 300 }, newFirstTs: 400 })
    expect(tb.ts['dev-1']!.calc_PAvg5m!.length).toBe(2)
    expect(tb.calls.some(c => c.startsWith('POST'))).toBe(false)
  })
  it('apply:分批写到新 key(数值字符串转数字),重叠段不覆盖;deleteOld 删同名 CF 与旧数据', async () => {
    const tb = fakeTb()
    seed(tb)
    const lines: string[] = []
    const r = await applyRenameTable(tb.api, [row], {
      apply: true,
      deleteOld: true,
      pageSize: 2,
      batchSize: 2,
      report: l => lines.push(l),
    })
    expect(r[0]).toMatchObject({ points: 3, deletedCf: true, deletedOld: true })
    const got = tb.ts['dev-1']!.calc_PAvg5m!.sort((a, b) => a.ts - b.ts)
    expect(got).toEqual([
      { ts: 100, value: 10 },
      { ts: 200, value: 20 },
      { ts: 300, value: 30 },
      { ts: 400, value: 40 },
      { ts: 500, value: 50 },
    ])
    expect(tb.ts['dev-1']!.PAvg5m).toBeUndefined()
    expect(tb.cfs['dev-1']).toEqual([])
    expect(tb.calls.filter(c => c.includes('/timeseries/ANY')).length).toBe(2) // 3 点按 2 一批
    expect(lines.join('\n')).toContain('3 点')
  })
  it('实体不存在 → skipped;新 key 没数据 → 复制到 now', async () => {
    const tb = fakeTb()
    tb.ts['dev-1']!.PAvg5m = [
      { ts: 1, value: 1 },
      { ts: 2, value: 2 },
    ]
    const r = await applyRenameTable(tb.api, [{ ...row, entity: 'NOPE' }, row], { now: 10 })
    expect(r[0]!.skipped).toContain('不存在')
    expect(r[1]).toMatchObject({ points: 2, newFirstTs: null })
  })
})

describe('detectSiteDrift', () => {
  it('线上没有站点资产 → remoteExists=false、无 diff;有则比较 siteConfig 并按标题对页面', async () => {
    const tb = fakeTb()
    const cfg: TbsiteConfig = {
      schema: 'tbsite/v2',
      site: { name: 'S1' },
      devices: [{ name: 'D1' }],
      outputPrefix: 'calc_',
    }
    const none = await detectSiteDrift(tb.api, { ...cfg, site: { name: 'NOPE' } })
    expect(none).toMatchObject({ remoteExists: false, siteDiff: [], pages: [] })
    tb.attrs['site-1'] = {
      siteConfig: JSON.stringify({ ...cfg, devices: [{ name: 'D1' }, { name: 'D2' }], outputPrefix: undefined }),
    }
    const r = await detectSiteDrift(tb.api, cfg, [{ file: 'p.json', config: page() }])
    expect(r.remoteExists).toBe(true)
    expect(r.siteDiff.map(d => `${d.kind} ${d.path}`)).toEqual(['removed devices[D2]', 'added outputPrefix'])
    expect(r.pages[0]).toMatchObject({ file: 'p.json', title: '总览', pageName: null, diff: null })
  })
})
