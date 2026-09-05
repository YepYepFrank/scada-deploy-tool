// T3.1 迁移函数:两份样本的 layout 全部迁成 PageConfig,过 schema(渲染器 src/schema)与注册表(渲染器 dist,CI 先 build)校验;
// 每种 card 映射与丢弃情形各有断言。
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { legacyHistoryWindow, migrateSiteConfig, type LegacySiteConfig, type WidgetLike } from '../src/index'

// 校验用渲染器的构建产物(pnpm build 先于 test;本包不依赖渲染器源码,避免 rootDir 交叉)
const rendererDist = resolve(__dirname, '../../renderer/dist')
if (!existsSync(resolve(rendererDist, 'schema/index.js')))
  throw new Error('缺少 packages/renderer/dist:请先 pnpm build')
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const schemaMod: any = await import(resolve(rendererDist, 'schema/index.js'))
const validatePageConfig = (c: unknown) => schemaMod.validatePageConfig(c) as { ok: boolean; issues?: unknown[] }

const fixtures = resolve(__dirname, 'fixtures')
const load = (f: string) => JSON.parse(readFileSync(resolve(fixtures, f), 'utf8')) as LegacySiteConfig
const idsFor = (cfg: LegacySiteConfig, assets: string[] = []) => ({
  devices: Object.fromEntries((cfg.devices ?? []).map(d => [d.name, `dev-${d.name}`])),
  assets: Object.fromEntries([cfg.site.name, ...assets].map(a => [a, `asset-${a}`])),
})
async function registryIssues(config: unknown) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const r: any = await import(resolve(rendererDist, 'index.js'))
  r.registerBuiltins()
  return r.validateAgainstRegistry(config) as { level: string; path: string; message: string }[]
}
const byId = (ws: WidgetLike[], id: string) => ws.find(w => w.id === id)!

describe('migrateSiteConfig · 样本整体', () => {
  it('demo-site:3 页(console / focus / console)全部过 schema 与注册表;focus 降级有提示', async () => {
    const cfg = load('demo-site.tbsite.json')
    const r = migrateSiteConfig(cfg, idsFor(cfg))
    expect(r.pages.map(p => [p.legacyId, p.legacyTemplate, p.config.template])).toEqual([
      ['p1', 'console', 'overview-a'],
      ['p2', 'focus', 'overview-a'],
      ['p3', 'console', 'overview-a'],
    ])
    expect(r.unresolved).toEqual([])
    for (const p of r.pages) {
      const v = validatePageConfig(p.config)
      expect(v.ok, JSON.stringify(v.issues)).toBe(true)
      const issues = await registryIssues(p.config)
      expect(
        issues.filter(i => i.level === 'error'),
        JSON.stringify(issues)
      ).toEqual([])
    }
    expect(r.notes.some(n => n.page === 'p2' && /focus/.test(n.message))).toBe(true)
    expect(r.notes.some(n => /layout\.header/.test(n.message))).toBe(true)
    expect(r.notes.some(n => /display/.test(n.message))).toBe(true)
    expect(r.pages[0]!.title).toBe('基站储能综合监控 · 储能总览')
  })

  it('xrs-mirror-test:agg 走资产、report 走 ext;缺资产 id 时列入 unresolved', async () => {
    const cfg = load('xrs-mirror-test.tbsite.json')
    const withAssets = migrateSiteConfig(cfg, idsFor(cfg, ['RT_TOTAL_P_TEST', 'RT_REVENUE_TEST']))
    expect(withAssets.unresolved).toEqual([])
    const p = withAssets.pages[0]!
    expect(validatePageConfig(p.config).ok).toBe(true)
    const issues = await registryIssues(p.config)
    expect(issues.filter(i => i.level === 'error')).toEqual([])
    const s1 = byId(p.config.widgets, 'w-s1')
    expect(s1.type).toBe('number-card')
    expect(s1.bindings.value).toEqual({
      mode: 'ts',
      entity: { type: 'ASSET', id: 'asset-RT_TOTAL_P_TEST', name: 'RT_TOTAL_P_TEST' },
      key: 'totalP',
    })
    const g4 = byId(p.config.widgets, 'w-g4')
    expect(g4.type).toBe('line')
    expect(g4.bindings.series).toEqual([
      {
        mode: 'ext',
        source: 'kz',
        window: '30d',
        interval: '1d',
        params: { stationId: '84a690c0-7381-11f1-8007-51b9f7714bbe', metric: 'kzRevDay' },
      },
    ])
    expect(withAssets.notes.some(n => n.slot === 'g4' && /ADR-004/.test(n.message))).toBe(true)
    // 收益键按旧规则取 90 天
    expect((byId(p.config.widgets, 'w-g2').bindings.series as { window: string }[])[0]!.window).toBe('90d')

    const noAssets = migrateSiteConfig(cfg, { devices: idsFor(cfg).devices })
    expect(noAssets.unresolved.sort()).toEqual(['RT_REVENUE_TEST', 'RT_TOTAL_P_TEST', 'xrs-mirror-test'])
    expect(
      (byId(noAssets.pages[0]!.config.widgets, 'w-s1').bindings.value as { entity: { id: string } }).entity.id
    ).toBe('unresolved:RT_TOTAL_P_TEST')
    expect(noAssets.notes.filter(n => n.level === 'error')).toHaveLength(2 + 3) // 每个引用槽位各记一次:总有功 s1/g1,收益 s2/g2/g3
  })
})

describe('migrateSiteConfig · 每种 card', () => {
  const base = (slots: Record<string, unknown>, template = 'console'): LegacySiteConfig => ({
    site: { name: 'S' },
    devices: [
      {
        name: 'D1',
        keys: [
          { key: 'P', label: '有功', unit: 'kW' },
          { key: 'Q', label: '无功', unit: 'kvar' },
          { key: 'T', unit: '℃' },
        ],
      },
      { name: 'D2', keys: [{ key: 'P', unit: 'kW' }] },
    ],
    layout: { pages: [{ id: 'p', title: 'T', template, slots: slots as Record<string, never> }] },
  })
  const ids = { devices: { D1: 'id1', D2: 'id2' }, assets: { S: 'idS', AGG: 'idA' } }
  const one = (slot: Record<string, unknown>, template?: string) => {
    const r = migrateSiteConfig(base({ g1: slot, s1: slot }, template), ids)
    return { r, w: r.pages[0]!.config.widgets, g1: byId(r.pages[0]!.config.widgets, 'w-g1') }
  }

  it('banner:有横幅的模板自动加站点告警横幅', () => {
    const { w } = one({ kind: 'metric', device: 'D1', key: 'P', card: 'stat' })
    expect(w[0]).toMatchObject({
      id: 'banner',
      slot: 'banner',
      type: 'alarm-list',
      bindings: { alarms: { mode: 'alarm', entity: { type: 'ASSET', id: 'idS', name: 'S' } } },
    })
  })
  it('stat → number-card(标题 / 中文名 / 单位)', () => {
    const { g1 } = one({ kind: 'metric', device: 'D1', key: 'P', card: 'stat', title: '进线' })
    expect(g1).toMatchObject({
      type: 'number-card',
      props: { title: '进线', subtitle: '有功', unit: 'kW', sub: 'D1 · P' },
      bindings: { value: { mode: 'ts', entity: { type: 'DEVICE', id: 'id1' }, key: 'P' } },
    })
  })
  it('gauge → gauge(max 保留,min 0)', () => {
    const { g1 } = one({ kind: 'metric', device: 'D1', key: 'T', card: 'gauge', max: 80 })
    expect(g1).toMatchObject({ type: 'gauge', props: { min: 0, max: 80, unit: '℃' } })
  })
  it('alarm → alarm-list 按类型过滤(计划的 status-light 无 alarm 模式,有提示)', () => {
    const { r, g1 } = one({ kind: 'alarm', device: 'D1', key: '过温', card: 'alarm', title: '过温监控' })
    expect(g1).toMatchObject({
      type: 'alarm-list',
      props: { title: '过温监控', compact: true },
      bindings: { alarms: { mode: 'alarm', entity: { id: 'id1' }, types: ['过温'] } },
    })
    expect(r.notes.some(n => /status-light/.test(n.message))).toBe(true)
  })
  it('line / bar → line 单序列,窗口按旧规则', () => {
    expect(one({ kind: 'metric', device: 'D1', key: 'P', card: 'line' }).g1).toMatchObject({
      type: 'line',
      props: { style: 'area' },
      bindings: { series: [{ mode: 'ts-history', keys: ['P'], window: '15m' }] },
    })
    expect(one({ kind: 'metric', device: 'D1', key: 'PEnergy5m', card: 'bar' }).g1).toMatchObject({
      props: { style: 'bar' },
      bindings: { series: [{ window: '24h' }] },
    })
    expect(legacyHistoryWindow('PAvg1h', 'line')).toBe('7d')
    expect(legacyHistoryWindow('revenueDaily', 'bar')).toBe('90d')
    expect(legacyHistoryWindow('P', 'bar')).toBe('3h')
  })
  it('multi → line 多序列(主 + extra)', () => {
    const { g1 } = one({
      kind: 'metric',
      device: 'D1',
      key: 'P',
      card: 'multi',
      extra: [{ kind: 'metric', device: 'D2', key: 'P' }],
    })
    expect(g1.type).toBe('line')
    expect((g1.bindings.series as unknown[]).length).toBe(2)
    expect(g1.props).toMatchObject({ subtitle: '2 序列', showLegend: true })
  })
  it('combo → dual-axis(主轴 + 副轴单位);无副轴时提示', () => {
    const { g1 } = one({
      kind: 'metric',
      device: 'D1',
      key: 'P',
      card: 'combo',
      extra: [{ kind: 'metric', device: 'D1', key: 'Q' }],
    })
    expect(g1).toMatchObject({
      type: 'dual-axis',
      props: { unitL: 'kW', unitR: 'kvar' },
      bindings: { primary: { keys: ['P'] }, secondary: { keys: ['Q'] } },
    })
    const { r, g1: g } = one({ kind: 'metric', device: 'D1', key: 'P', card: 'combo' })
    expect(g.bindings.secondary).toBeUndefined()
    expect(r.notes.some(n => /副轴/.test(n.message))).toBe(true)
  })
  it('overview → overview-card(items 标签 / 单位与绑定同序)', () => {
    const { g1 } = one({
      kind: 'metric',
      device: 'D1',
      key: 'P',
      card: 'overview',
      extra: [
        { kind: 'metric', device: 'D1', key: 'Q' },
        { kind: 'metric', device: 'D2', key: 'P' },
      ],
    })
    expect(g1).toMatchObject({
      type: 'overview-card',
      props: {
        items: [
          { label: '有功', unit: 'kW' },
          { label: '无功', unit: 'kvar' },
          { label: 'P', unit: 'kW' },
        ],
      },
    })
    expect((g1.bindings.items as unknown[]).length).toBe(3)
  })
  it('alarmlist → alarm-list 绑站点资产', () => {
    const { g1 } = one({ kind: 'alarmlist', device: '', key: '', card: 'alarmlist', title: '告警' })
    expect(g1).toMatchObject({ type: 'alarm-list', bindings: { alarms: { entity: { type: 'ASSET', id: 'idS' } } } })
  })
  it('agg → 资产实体', () => {
    const { g1 } = one({ kind: 'agg', device: 'AGG', key: 'totalP', card: 'stat' })
    expect((g1.bindings.value as { entity: { type: string; id: string } }).entity).toEqual({
      type: 'ASSET',
      id: 'idA',
      name: 'AGG',
    })
  })
  it('map → 留空并提示;未知 card 同样', () => {
    const { r, w } = one({ kind: 'metric', device: 'D1', key: 'latitude', card: 'map' })
    expect(w.find(x => x.id === 'w-g1')).toBeUndefined()
    expect(r.notes.filter(n => /地图/.test(n.message))).toHaveLength(2) // g1 与 s1
    expect(
      one({ kind: 'metric', device: 'D1', key: 'P', card: 'pie' }).r.notes.some(n => /未知卡片/.test(n.message))
    ).toBe(true)
  })
  it('monitor3 → monitor-3col 原位;未知模板 → overview-a 并提示', () => {
    const cfg = base(
      {
        l1: { kind: 'metric', device: 'D1', key: 'P', card: 'stat' },
        r3: { kind: 'metric', device: 'D1', key: 'P', card: 'line' },
      },
      'monitor3'
    )
    const r = migrateSiteConfig(cfg, ids)
    expect(r.pages[0]!.config.template).toBe('monitor-3col')
    expect(r.pages[0]!.config.widgets.map(w => w.slot)).toEqual(['banner', 'l1', 'r3'])
    expect(validatePageConfig(r.pages[0]!.config).ok).toBe(true)
    const u = migrateSiteConfig(base({}, 'weird'), ids)
    expect(u.pages[0]!.config.template).toBe('overview-a')
    expect(u.notes.some(n => /未知旧模板/.test(n.message))).toBe(true)
  })
  it('没有 layout 时不产出页面并提示', () => {
    const r = migrateSiteConfig({ site: { name: 'S' } }, ids)
    expect(r.pages).toEqual([])
    expect(r.notes[0]!.message).toMatch(/没有 layout\.pages/)
  })
})
