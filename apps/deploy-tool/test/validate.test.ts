// T3.5 校验层:四层各至少 1 个坏配置 + warning,全部定位到 widget id / slot name;error 阻止发布。
import { describe, expect, it } from 'vitest'
import { registerBuiltins, type Binding, type PageConfig } from '@grid/scada-renderer'
import { buildMetaTree, type TbDevice } from '../src/meta/MetaNode'
import {
  canPublish,
  indexTree,
  resolveEntity,
  sortIssues,
  validateBindingsLayer,
  validatePage,
  validateStatic,
  type MetaLookup,
} from '../src/editor/validate'

registerBuiltins()

const dev = (name: string, id = `id-${name}`): TbDevice => ({ id: { id }, name, type: 'IED' })
const tree = buildMetaTree('仙人山', [dev('SSP_1'), dev('PDR_1')], [{ id: { id: 'a1' }, name: 'xrs-mirror-test' }])
const client: MetaLookup['client'] = {
  async tsKeys(e) {
    if (e.id === 'id-SSP_1') return ['P', 'Q', 'CB'].map(key => ({ key, kind: 'number' as const }))
    if (e.id === 'id-PDR_1') throw new Error('HTTP 403')
    return []
  },
  async attrKeys(e, scope) {
    return e.id === 'id-SSP_1' && scope === 'SERVER_SCOPE' ? ['soh'] : []
  },
}
const meta: MetaLookup = { tree, client }

const SSP = { type: 'DEVICE', id: 'id-SSP_1', name: 'SSP_1' } as const
const good = (): PageConfig => ({
  schemaVersion: 1,
  template: 'overview-a',
  title: 't',
  widgets: [
    {
      id: 'w-g1',
      type: 'line',
      slot: 'g1',
      bindings: { series: [{ mode: 'ts-history', entity: SSP, keys: ['P'], window: '24h' }] },
    },
    { id: 'w-s1', type: 'number-card', slot: 's1', bindings: { value: { mode: 'ts', entity: SSP, key: 'Q' } } },
  ],
})

const only = <T extends { layer: string }>(list: T[], layer: string): T[] => list.filter(i => i.layer === layer)

describe('校验层', () => {
  it('好配置:四层全过,可发布,bindingChecked=true', async () => {
    const r = await validatePage(good(), meta)
    expect(r.issues).toEqual([])
    expect(r.bindingChecked).toBe(true)
    expect(canPublish(r)).toBe(true)
  })

  it('① schema:mode 非法 → 定位到组件 id 而非下标', () => {
    const cfg = good()
    ;(cfg.widgets[1]!.bindings as Record<string, unknown>).value = { mode: 'bogus', entity: SSP, key: 'Q' }
    const s = only(validateStatic(cfg), 'schema')
    expect(s.length).toBeGreaterThan(0)
    expect(s.every(i => i.level === 'error' && i.widgetId === 'w-s1' && i.slot === 'value')).toBe(true)
    expect(s[0]!.path.startsWith('/widgets/w-s1/bindings/value')).toBe(true)
  })

  it('① schema:没填完的 ts 绑定(oneOf 联合冒出 20 多条分支错误)折叠成一条,只提示本 mode 缺的字段;② 层不重复报', async () => {
    const cfg = good()
    cfg.widgets[1]!.bindings.value = { mode: 'ts', entity: { type: 'DEVICE', id: '', name: '' }, key: '' }
    const s = only(validateStatic(cfg), 'schema')
    expect(s).toHaveLength(1)
    expect([s[0]!.widgetId, s[0]!.slot, s[0]!.path]).toEqual(['w-s1', 'value', '/widgets/w-s1/bindings/value'])
    expect(s[0]!.message).toMatch(/^「ts」绑定未填完整:/)
    expect(s[0]!.message).toMatch(/key/)
    expect(s[0]!.message).not.toMatch(/keys|window|scope|source/)
    expect(await validateBindingsLayer(cfg, meta)).toEqual([])
    // 多序列槽位里的第 2 条没填完:路径带下标
    cfg.widgets[1]!.bindings.value = { mode: 'ts', entity: SSP, key: 'Q' }
    cfg.widgets[0]!.bindings.series = [
      { mode: 'ts-history', entity: SSP, keys: ['P'], window: '24h' },
      { mode: 'ts-history', entity: { type: 'DEVICE', id: '', name: '' }, keys: [], window: '24h' },
    ]
    const s2 = only(validateStatic(cfg), 'schema')
    expect(s2.map(i => [i.path, i.slot])).toEqual([['/widgets/w-g1/bindings/series/1', 'series']])
    expect(s2[0]!.message).toMatch(/^「ts-history」绑定未填完整:/)
    // mode 不是六种之一
    cfg.widgets[0]!.bindings.series = [{ mode: 'ts-history', entity: SSP, keys: ['P'], window: '24h' }]
    ;(cfg.widgets[1]!.bindings as Record<string, unknown>).value = { mode: 'bogus' }
    expect(only(validateStatic(cfg), 'schema').map(i => i.message)).toEqual(['mode「bogus」不是六种绑定之一'])
  })

  it('② 绑定:实体不存在 → error;遥测 key 不存在 → error;calc_ key 不存在 → warning;都定位到槽位', async () => {
    const cfg = good()
    cfg.widgets[1]!.bindings.value = { mode: 'ts', entity: { type: 'DEVICE', id: 'x', name: 'GHOST' }, key: 'P' }
    cfg.widgets[0]!.bindings.series = [
      { mode: 'ts-history', entity: SSP, keys: ['NOPE'], window: '24h' },
      { mode: 'ts-history', entity: SSP, keys: ['calc_total_p'], window: '24h' },
    ]
    const b = await validateBindingsLayer(cfg, meta)
    expect(b.map(i => [i.level, i.widgetId, i.slot, i.path])).toEqual([
      ['error', 'w-g1', 'series', '/widgets/w-g1/bindings/series/0'],
      ['warning', 'w-g1', 'series', '/widgets/w-g1/bindings/series/1'],
      ['error', 'w-s1', 'value', '/widgets/w-s1/bindings/value'],
    ])
    expect(b[0]!.message).toContain('NOPE')
    expect(b[1]!.message).toContain('规则尚未发布')
    expect(b[2]!.message).toContain('GHOST')
  })

  it('① 注册表:一条历史曲线绑定绑了多个测点 → error;不连 TB 也要拦(审查 R3)', async () => {
    const cfg = good()
    cfg.widgets[0]!.bindings.series = [{ mode: 'ts-history', entity: SSP, keys: ['P', 'Q'], window: '24h' }]
    const b = validateStatic(cfg)
    const multi = b.filter(i => i.message.includes('只画一条序列'))
    expect(multi.map(i => [i.level, i.widgetId, i.slot, i.path])).toEqual([
      ['error', 'w-g1', 'series', '/widgets/w-g1/bindings/series/0'],
    ])
    expect(multi[0]!.message).toContain('Q')
    expect(multi[0]!.message).toContain('添加一条')
    // 单个测点不报
    cfg.widgets[0]!.bindings.series = [{ mode: 'ts-history', entity: SSP, keys: ['P'], window: '24h' }]
    expect(validateStatic(cfg).filter(i => i.message.includes('只画一条序列'))).toEqual([])
  })

  it('② 绑定:属性 key 按 scope 查;key 列表读不到(403)降级为 warning;alarm 只查实体', async () => {
    const cfg = good()
    cfg.widgets[1]!.bindings.value = { mode: 'attr', entity: SSP, scope: 'SHARED_SCOPE', key: 'soh' }
    cfg.widgets[0]!.bindings.series = [
      { mode: 'ts-history', entity: { type: 'DEVICE', id: 'id-PDR_1', name: 'PDR_1' }, keys: ['P'], window: '1h' },
    ]
    cfg.widgets.push({
      id: 'w-a',
      type: 'alarm-list',
      slot: 's2',
      bindings: { alarms: { mode: 'alarm', entity: { type: 'ASSET', id: 'a1', name: 'xrs-mirror-test' } } },
    })
    const b = await validateBindingsLayer(cfg, meta)
    expect(b.map(i => [i.level, i.widgetId])).toEqual([
      ['warning', 'w-g1'],
      ['error', 'w-s1'],
    ])
    expect(b[0]!.message).toContain('403')
    expect(b[1]!.message).toContain('SHARED_SCOPE')
  })

  it('② 绑定:ADR-002 按名称优先;id 不一致 / 缺 name / 名称改过 都是 warning 且仍能解析', () => {
    const idx = indexTree(tree)
    const at = { path: '/x', widgetId: 'w', slot: 's' }
    const r1 = resolveEntity({ type: 'DEVICE', id: 'stale-id', name: 'SSP_1' }, idx, at)
    expect('node' in r1 && r1.node.name === 'SSP_1' && r1.issue?.level === 'warning').toBe(true)
    const r2 = resolveEntity({ type: 'DEVICE', id: 'id-SSP_1' }, idx, at)
    expect('node' in r2 && r2.issue?.message.includes('缺少 name')).toBe(true)
    const r3 = resolveEntity({ type: 'DEVICE', id: 'id-SSP_1', name: 'RENAMED' }, idx, at)
    expect('node' in r3 && r3.issue?.message.includes('RENAMED')).toBe(true)
    // 类型不同不算命中(ASSET 的 id 去找 DEVICE)
    const r4 = resolveEntity({ type: 'DEVICE', id: 'a1', name: 'xrs-mirror-test' }, idx, at)
    expect('level' in r4 && r4.level === 'error').toBe(true)
  })

  it('③ 模板:必填槽位 g1 未放组件 → error 带槽位名;组件必填绑定槽位缺失 → error 定位到 widget/slot', () => {
    const cfg = good()
    cfg.widgets.shift() // 去掉 g1
    cfg.widgets[0]!.bindings = {}
    const t = only(validateStatic(cfg), 'template')
    expect(t.map(i => [i.level, i.widgetId, i.slot])).toEqual([
      ['error', undefined, 'g1'],
      ['error', 'w-s1', 'value'],
    ])
    // 注册表层不重复报这两条
    expect(only(validateStatic(cfg), 'registry')).toEqual([])
  })

  it('④ actions:存在即 warning「二期启用」;绑非 DEVICE → error;都定位到 action 名', async () => {
    const cfg = good()
    cfg.widgets[1]!.actions = {
      reset: { kind: 'rpc', entity: { type: 'DEVICE', id: 'id-SSP_1' }, method: 'reset' },
      bad: { kind: 'attr', entity: { type: 'ASSET' as 'DEVICE', id: 'a1' }, scope: 'SHARED_SCOPE', key: 'k' },
    }
    const a = only(sortIssues(validateStatic(cfg)), 'actions')
    expect(a.map(i => [i.level, i.widgetId, i.slot])).toEqual([
      ['error', 'w-s1', 'bad'],
      ['warning', 'w-s1', 'bad'],
      ['warning', 'w-s1', 'reset'],
    ])
    expect(a[0]!.message).toMatch(/DEVICE/)
    // 只报一条 DEVICE 错(schema 层对同一 action 的一串 oneOf 错误已折叠进第 ④ 层)
    expect(validateStatic(cfg).filter(i => i.level === 'error')).toHaveLength(1)
    // DEVICE 但缺字段:折叠成该 action 的一条形状错
    cfg.widgets[1]!.actions = { m: { kind: 'rpc', entity: { type: 'DEVICE', id: 'id-SSP_1' } } as never }
    const a2 = only(validateStatic(cfg), 'actions')
    expect(a2.map(i => [i.level, i.slot])).toEqual([
      ['error', 'm'],
      ['warning', 'm'],
    ])
    expect(a2[0]!.message).toContain('method')
    const r = await validatePage(cfg, meta)
    expect(canPublish(r)).toBe(false)
  })

  it('props 层:越界属性 → error;未连接时第 ② 层跳过且 bindingChecked=false,warning 不阻止发布', async () => {
    const cfg = good()
    cfg.widgets[1]!.props = { decimals: 99 }
    const r = await validatePage(cfg, null)
    expect(r.bindingChecked).toBe(false)
    expect(only(r.issues, 'binding')).toEqual([])
    expect(only(r.issues, 'props').map(i => [i.widgetId, i.path])).toEqual([['w-s1', '/widgets/w-s1/props/decimals']])
    cfg.widgets[1]!.props = {}
    cfg.widgets[1]!.actions = { a: { kind: 'rpc', entity: { type: 'DEVICE', id: 'id-SSP_1' }, method: 'm' } }
    const r2 = await validatePage(cfg, meta)
    expect(r2.errors).toBe(0)
    expect(r2.warnings).toBe(1)
    expect(canPublish(r2)).toBe(true)
  })

  it('排序:error 在前,再按层序,再按路径', () => {
    const cfg = good()
    cfg.widgets[1]!.actions = { a: { kind: 'rpc', entity: { type: 'DEVICE', id: 'id-SSP_1' }, method: 'm' } }
    cfg.widgets[0]!.bindings = {}
    const list = validateStatic(cfg)
    expect(list.map(i => i.level)).toEqual(['error', 'warning'])
  })
})

// kz 的站点标识实测就是 TB 里 gateway 设备的 id(镜像 bs_1_ems),所以站点也能在树里点选
const gwTree = buildMetaTree(
  '仙人山',
  [dev('SSP_1'), { id: { id: 'id-GW1' }, name: 'GW1', type: 'gateway' }],
  [{ id: { id: 'a1' }, name: 'xrs-mirror-test' }]
)
const gwMeta: MetaLookup = { tree: gwTree, client }
const extHist = (params: Record<string, unknown>): Binding => ({
  mode: 'ext',
  source: 'kz',
  window: '30d',
  interval: '1d',
  params,
})

describe('校验层 · ext(kz)绑定', () => {
  it('① 静态:params 形状不连 TB 也要拦,定位到 /params 下的具体字段', () => {
    const cfg = good()
    cfg.widgets[0]!.bindings.series = [
      extHist({ entity: SSP, keys: ['P', 'Q'] }),
      { mode: 'ext', source: 'kz', params: { foo: 1 } },
    ]
    const s = only(validateStatic(cfg), 'schema')
    expect(s.map(i => [i.level, i.widgetId, i.slot, i.path])).toEqual([
      ['error', 'w-g1', 'series', '/widgets/w-g1/bindings/series/0/params/keys'],
      ['error', 'w-g1', 'series', '/widgets/w-g1/bindings/series/1/params'],
    ])
    expect(s[0]!.message).toContain('只会用第一个测点「P」')
    expect(s[1]!.message).toContain('无法分派')
  })

  it('① 静态:收益趋势没选指标只给 warning(默认画第一条),不挡发布', async () => {
    const cfg = good()
    cfg.widgets[0]!.bindings.series = [{ mode: 'ext', source: 'kz', interval: '1d', params: { stationId: 'id-GW1' } }]
    const r = await validatePage(cfg, gwMeta)
    expect(r.errors).toBe(0)
    expect(canPublish(r)).toBe(true)
    expect(r.issues.map(i => [i.level, i.path])).toEqual([['warning', '/widgets/w-g1/bindings/series/0/params/metric']])
  })

  it('② 存在性:归档历史的实体与测点照样查 —— kz 只是 TB 同一份遥测的归档', async () => {
    const cfg = good()
    cfg.widgets[0]!.bindings.series = [
      extHist({ entity: { type: 'DEVICE', id: 'x', name: 'GHOST' }, keys: ['P'] }),
      extHist({ entity: SSP, keys: ['NOPE'] }),
    ]
    const b = await validateBindingsLayer(cfg, gwMeta)
    expect(b.map(i => [i.level, i.widgetId, i.path])).toEqual([
      ['error', 'w-g1', '/widgets/w-g1/bindings/series/0/params/entity'],
      ['warning', 'w-g1', '/widgets/w-g1/bindings/series/1/params/keys'],
    ])
    expect(b[0]!.message).toContain('GHOST')
    // TB 侧没有的 key 只给 warning:kz 是独立归档库,停更的点位仍可能有历史
    expect(b[1]!.message).toContain('只剩归档')
  })

  it('② 存在性:收益趋势的站点必须是网关设备,否则 kz 只会回「该站点下无设备」', async () => {
    const cfg = good()
    cfg.widgets[0]!.bindings.series = [
      { mode: 'ext', source: 'kz', params: { stationId: 'id-GW1', metric: 'net' } },
      { mode: 'ext', source: 'kz', params: { stationId: 'id-SSP_1', metric: 'net' } },
      { mode: 'ext', source: 'kz', params: { stationId: '11111111-2222-3333-4444-555555555555', metric: 'net' } },
    ]
    const b = await validateBindingsLayer(cfg, gwMeta)
    // 第 0 条是网关,通过
    expect(b.map(i => [i.level, i.path])).toEqual([
      ['warning', '/widgets/w-g1/bindings/series/1/params/stationId'],
      ['warning', '/widgets/w-g1/bindings/series/2/params/stationId'],
    ])
    expect(b[0]!.message).toContain('不是 gateway')
    expect(b[1]!.message).toContain('找不到对应设备')
  })
})
