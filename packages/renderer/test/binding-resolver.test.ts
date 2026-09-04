/**
 * 绑定解析器(T1.2 完成标准):给一份含全部 mode 的 JSON + MockDataSource,
 * 断言 subscribeTs 的 (entity, keys) 集合、getHistory 的 window / agg、ext 的 query,
 * 卸载后 unsubscribe 次数 == 订阅次数;值按 valueType 整形;多序列槽位为数组。
 */
import { describe, it, expect } from 'vitest'
import { resolveBindings } from '../src/binding-resolver'
import type { PageConfig } from '../src/schema/page-config'
import { createMockDataSource } from './mock-data-source'

const DEV = { type: 'DEVICE', id: 'd1' } as const
const AST = { type: 'ASSET', id: 'a1' } as const

const config: PageConfig = {
  schemaVersion: 1,
  template: 'overview-a',
  widgets: [
    { id: 'w-num', slot: 's1', type: 'number-card', bindings: { value: { mode: 'ts', entity: DEV, key: 'P' } } },
    {
      id: 'w-attr',
      slot: 's2',
      type: 'text',
      bindings: { value: { mode: 'attr', entity: DEV, scope: 'SERVER_SCOPE', key: 'CB' } },
    },
    {
      id: 'w-alarm',
      slot: 's3',
      type: 'alarm-list',
      bindings: { alarms: { mode: 'alarm', entity: AST, types: ['通讯中断'] } },
    },
    { id: 'w-const', slot: 's4', type: 'image', bindings: { src: { mode: 'const', value: '/a.png' } } },
    {
      id: 'w-line',
      slot: 'g1',
      type: 'line',
      bindings: {
        series: [
          { mode: 'ts-history', entity: AST, keys: ['calc_total_p'], window: '24h', agg: 'AVG' },
          { mode: 'ts-history', entity: AST, keys: ['calc_total_load'], window: '2h' },
        ],
      },
    },
    {
      id: 'w-ext',
      slot: 'g2',
      type: 'table',
      bindings: {
        rows: [
          { mode: 'ext', source: 'kz', window: '30d', interval: '1d', params: { stationId: 'x', metric: 'revenue' } },
        ],
      },
    },
  ],
}

const flush = () => new Promise(r => setTimeout(r, 0))

describe('resolveBindings', () => {
  it('按 mode 分派到 DataSource,并记录订阅集合', async () => {
    const ds = createMockDataSource({ withExt: true })
    const seen: string[] = []
    const h = resolveBindings(config, ds, {
      onValue: (w, s) => seen.push(`${w}.${s}`),
      slotSpec: (w, slot) =>
        w.type === 'number-card' && slot === 'value' ? { name: 'value', valueType: 'number' } : undefined,
    })
    await flush()
    await flush()

    const ts = ds.calls.filter(c => c.method === 'subscribeTs').map(c => `${c.entity!.id}:${c.keys!.join(',')}`)
    expect(ts).toEqual(expect.arrayContaining(['d1:P', 'a1:calc_total_p', 'a1:calc_total_load']))
    expect(ds.calls.filter(c => c.method === 'subscribeAttr')).toHaveLength(1)
    expect(ds.calls.find(c => c.method === 'subscribeAlarms')?.types).toEqual(['通讯中断'])
    const hist = ds.calls.filter(c => c.method === 'getHistory')
    expect(hist.map(c => [c.keys![0], c.window, c.agg])).toEqual([
      ['calc_total_p', '24h', 'AVG'],
      ['calc_total_load', '2h', undefined],
    ])
    expect(ds.calls.find(c => c.method === 'ext')?.query).toMatchObject({
      source: 'kz',
      window: '30d',
      interval: '1d',
      params: { metric: 'revenue' },
    })

    // 值整形
    expect(h.values['w-num']!.value).toBe(1) // 首包 value 1 → number
    expect(h.values['w-attr']!.value).toBe('v0')
    expect(h.values['w-alarm']!.alarms).toEqual([])
    expect(h.values['w-const']!.src).toBe('/a.png')
    const series = h.values['w-line']!.series as { name: string; points: unknown[] }[]
    expect(Array.isArray(series)).toBe(true)
    expect(series.map(s => s.name)).toEqual(['calc_total_p', 'calc_total_load'])
    expect(series[0]!.points).toHaveLength(3) // 历史 2 点 + 订阅首包最新值 1 点
    const rows = h.values['w-ext']!.rows as { name: string; points: unknown[] }[]
    expect(rows[0]!.name).toBe('revenue')
    expect(rows[0]!.points).toHaveLength(2)

    // 推送追加
    ds.pushTs(DEV, 'P', '43.2')
    expect(h.values['w-num']!.value).toBe(43.2)
    ds.pushTs(AST, 'calc_total_p', 30)
    expect((h.values['w-line']!.series as { points: unknown[] }[])[0]!.points).toHaveLength(4)

    // 退订对账
    const subs = h.stats.subscriptions
    expect(subs).toBe(ds.calls.filter(c => c.method.startsWith('subscribe')).length)
    h.dispose()
    expect(h.stats.unsubscribed).toBe(subs)
    expect(ds.unsubscribed()).toBe(subs)
    // dispose 后推送不再影响
    ds.pushTs(DEV, 'P', 99)
    expect(h.values['w-num']!.value).toBe(43.2)
    expect(seen.length).toBeGreaterThan(0)
  })

  it('DataSource 未实现 ext 时报错到 onError,其余绑定不受影响', async () => {
    const ds = createMockDataSource({ withExt: false })
    const errors: string[] = []
    const h = resolveBindings(config, ds, {
      onValue: () => {},
      onError: (w, s, e) => errors.push(`${w}.${s}:${(e as Error).message}`),
    })
    await flush()
    expect(errors).toEqual(['w-ext.rows:DataSource 未实现 ext()'])
    expect(h.values['w-num']!.value).toBe(1)
    h.dispose()
  })

  it('历史点数超过 maxPoints 时丢弃最早的', async () => {
    const ds = createMockDataSource({ history: { k: Array.from({ length: 5 }, (_, i) => ({ ts: i, value: i })) } })
    const cfg: PageConfig = {
      schemaVersion: 1,
      template: 'overview-a',
      widgets: [
        {
          id: 'w',
          slot: 'g1',
          type: 'line',
          bindings: { series: [{ mode: 'ts-history', entity: AST, keys: ['k'], window: '1h' }] },
        },
      ],
    }
    const h = resolveBindings(cfg, ds, { onValue: () => {}, maxPoints: 6 })
    await flush()
    await flush()
    ds.pushTs(AST, 'k', 5)
    ds.pushTs(AST, 'k', 6)
    const pts = (h.values['w']!.series as { points: { value: unknown }[] }[])[0]!.points
    // 历史 5 点(值 0–4)+ 首包(值 1)+ 推送 2 点 = 8,保留最后 6 → 首个值为 2
    expect(pts).toHaveLength(6)
    expect(pts[0]!.value).toBe(2)
    h.dispose()
  })
})
