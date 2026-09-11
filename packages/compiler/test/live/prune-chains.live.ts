// live(R1,2026-09-08;2026-09-11 改):声明里删掉运算之后再发布,对应的站点规则链要真的从 TB 上消失。
// 用独立命名的临时站点跑,不碰 xrs-mirror-test;afterAll 兜底清理。
//
// 背景:08-31 发布过的收益链在声明里去掉 revenue 之后一直没人清,链内两个 generator 每 5 分钟
// 自跑一次往旧资产写数,直到 09-08 才被发现。这条用例就是防它再来一次。
//
// 2026-09-11 起 Root 链由高潮维护,部署工具永远不写它:临时站点的告警链在 Root 上没有转发节点,
// 发布时告警步骤按约定报出来;整个用例前后 Root 链的版本与节点数必须一点不变。
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { chainNames, cleanup, publish, resolveDeviceIds, type TbApi, type TbsiteConfig } from '../../src/index'
import { hasCreds, makeApi, TB_BASE } from './env'

const DEV = 'SSP1_GP1_IED1'
const TAG = `prune${Date.now().toString(36).slice(-4)}`
const SITE = `${TAG}-live`

const cfgWith = (computations: unknown[]): TbsiteConfig =>
  ({
    schema: 'tbsite/v2',
    site: { name: SITE, label: 'R1 live 临时站点(可删)' },
    devices: [{ name: DEV, type: 'IED', profile: 'IED', keys: [{ key: 'P' }, { key: 'Q' }] }],
    deviceTemplates: [],
    computations,
    rollup: {},
    alarm: {},
  }) as unknown as TbsiteConfig

const alarm = {
  template: 'alarm.threshold',
  device: DEV,
  name: `${TAG} 越限`,
  key: 'P',
  condition: { op: 'gt', value: 45 },
  severity: 'WARNING',
  trigger: 'edge',
  message: '越限:{value}',
}
const cascade = { template: 'window.cascade', device: DEV, keys: ['P'], aggs: ['avg'] }

describe.skipIf(!hasCreds)(`发布时清理旧链(live @ ${TB_BASE})`, () => {
  let api: TbApi
  let devIds: Record<string, string> = {}
  let rootBefore = { version: -1, nodes: -1 }
  const log: string[] = []
  const report = (s: string, st: string, d?: string) => log.push(`${s}:${st}${d ? ' ' + d : ''}`)

  const listChains = async () =>
    (((await api('/api/ruleChains?pageSize=200&page=0'))?.data ?? []) as { name: string; root?: boolean }[]).map(
      c => c.name
    )
  /** Root 链的版本号与节点数(只读) */
  const rootState = async () => {
    const chains = ((await api('/api/ruleChains?pageSize=200&page=0'))?.data ?? []) as {
      id: { id: string }
      root?: boolean
    }[]
    const root = chains.find(c => c.root)!
    const meta = await api(`/api/ruleChain/${root.id.id}/metadata`)
    return { version: meta?.version as number, nodes: (meta?.nodes ?? []).length as number }
  }

  beforeAll(async () => {
    api = await makeApi()
    const r = await resolveDeviceIds(api, [DEV])
    if (r.missing.length) throw new Error(`镜像上缺设备:${DEV}`)
    devIds = r.devIds
    rootBefore = await rootState()
  })
  afterAll(async () => {
    // 无论断言成败都不给镜像留垃圾
    if (api) await cleanup(cfgWith([alarm, cascade]), devIds, api).catch(() => {})
  })

  it('先发布带告警 + 多级归档的临时站点:两条链都在;Root 上没有转发节点 → 告警步骤报出来,Root 不写', async () => {
    const failures = await publish(cfgWith([alarm, cascade]), devIds, api, report, { publishedBy: 'live-R1' })
    expect(failures.map(f => [f.step, f.output])).toEqual([['alarm', chainNames.alarm(SITE)]])
    expect(failures[0]!.error).toContain('请高潮')
    const names = await listChains()
    expect(names).toContain(chainNames.alarm(SITE))
    expect(names).toContain(chainNames.rollup(SITE))
    expect(await rootState()).toEqual(rootBefore)
  }, 120000)

  it('声明里去掉全部运算再发布:两条链从 TB 上消失,别人的链一条没少,Root 一点没变', async () => {
    const before = (await listChains()).filter(n => !n.startsWith(TAG) && !n.includes(SITE))
    log.length = 0
    const failures = await publish(cfgWith([]), devIds, api, report, { publishedBy: 'live-R1' })
    expect(failures).toEqual([])

    const names = await listChains()
    expect(names).not.toContain(chainNames.alarm(SITE))
    expect(names).not.toContain(chainNames.rollup(SITE))
    // 与本站点无关的链原样保留(同事的链、xrs-mirror-test 的链都在这里面)
    expect(names.filter(n => !n.startsWith(TAG) && !n.includes(SITE)).sort()).toEqual(before.sort())

    expect(log.find(l => l.startsWith('alarm:ok'))).toContain('已删上一版的')
    expect(log.find(l => l.startsWith('rollup:ok'))).toContain('已删上一版的')
    expect(await rootState()).toEqual(rootBefore)
  }, 120000)

  it('再发布一次(仍然没有运算):幂等,不报错也没有可删的了', async () => {
    log.length = 0
    expect(await publish(cfgWith([]), devIds, api, report, { publishedBy: 'live-R1' })).toEqual([])
    expect(log.find(l => l.startsWith('alarm:ok'))).toBe('alarm:ok 无')
    expect(log.find(l => l.startsWith('rollup:ok'))).toBe('rollup:ok 无')
    expect(await rootState()).toEqual(rootBefore)
  }, 120000)
})
