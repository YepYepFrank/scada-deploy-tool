// live(R1,2026-09-08;2026-09-11 改):声明里删掉运算之后再发布,对应的站点规则链要真的从 TB 上消失,
// Root 上本站点的转发节点也要摘掉。用独立命名的临时站点跑,不碰 xrs-mirror-test;afterAll 兜底清理。
//
// 背景:08-31 发布过的收益链在声明里去掉 revenue 之后一直没人清,链内两个 generator 每 5 分钟
// 自跑一次往旧资产写数,直到 09-08 才被发现。这条用例就是防它再来一次。
//
// 2026-09-11:Root 链由高潮维护,工具只能动自己配的那部分(本站点的转发节点)。这里逐一核对:
// 接线、摘线前后,Root 上「别人的节点与连线」一字不差。
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { chainNames, cleanup, publish, resolveDeviceIds, type TbApi, type TbsiteConfig } from '../../src/index'
import { hasCreds, makeApi, TB_BASE } from './env'

const DEV = 'SSP1_GP1_IED1'
const TAG = `prune${Date.now().toString(36).slice(-4)}`
const SITE = `${TAG}-live`
const FLOW = chainNames.rootFlow(SITE)

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

type Node = { id?: { id: string }; type: string; name: string; configuration?: unknown; additionalInfo?: unknown }
type Conn = { fromIndex: number; toIndex: number; type: string }

describe.skipIf(!hasCreds)(`发布时清理旧链(live @ ${TB_BASE})`, () => {
  let api: TbApi
  let devIds: Record<string, string> = {}
  let othersBefore = ''
  const log: string[] = []
  const report = (s: string, st: string, d?: string) => log.push(`${s}:${st}${d ? ' ' + d : ''}`)

  const listChains = async () =>
    (((await api('/api/ruleChains?pageSize=200&page=0'))?.data ?? []) as { name: string; root?: boolean }[]).map(
      c => c.name
    )
  const rootMeta = async () => {
    const chains = ((await api('/api/ruleChains?pageSize=200&page=0'))?.data ?? []) as {
      id: { id: string }
      root?: boolean
    }[]
    const root = chains.find(c => c.root)!
    return (await api(`/api/ruleChain/${root.id.id}/metadata`)) as { nodes: Node[]; connections: Conn[] }
  }
  /** Root 上除本临时站点转发节点以外的全部节点(原样)与它们之间的连线 */
  const rootOthers = async () => {
    const m = await rootMeta()
    const own = (i: number) => m.nodes[i]!.name === FLOW
    return JSON.stringify({
      nodes: m.nodes.filter((_, i) => !own(i)),
      connections: (m.connections ?? [])
        .filter(c => !own(c.fromIndex) && !own(c.toIndex))
        .map(c => `${m.nodes[c.fromIndex]!.id?.id}>${m.nodes[c.toIndex]!.id?.id}:${c.type}`)
        .sort(),
    })
  }
  const ourFlows = async () => (await rootMeta()).nodes.filter(n => n.name === FLOW)

  beforeAll(async () => {
    api = await makeApi()
    const r = await resolveDeviceIds(api, [DEV])
    if (r.missing.length) throw new Error(`镜像上缺设备:${DEV}`)
    devIds = r.devIds
    othersBefore = await rootOthers()
  })
  afterAll(async () => {
    // 无论断言成败都不给镜像留垃圾
    if (api) await cleanup(cfgWith([alarm, cascade]), devIds, api).catch(() => {})
  })

  it('先发布带告警 + 多级归档的临时站点:两条链都在;Root 上接了本站点的转发节点(带标记),别人的部分一字不差', async () => {
    const failures = await publish(cfgWith([alarm, cascade]), devIds, api, report, { publishedBy: 'live-R1' })
    expect(failures).toEqual([])
    const names = await listChains()
    expect(names).toContain(chainNames.alarm(SITE))
    expect(names).toContain(chainNames.rollup(SITE))
    const flows = await ourFlows()
    expect(flows).toHaveLength(1)
    expect(flows[0]!.additionalInfo).toMatchObject({ managedBy: 'deploy-tool', site: SITE })
    expect(await rootOthers()).toBe(othersBefore)
  }, 120000)

  it('声明里去掉全部运算再发布:两条链从 TB 上消失,本站点的转发节点被摘,别人的链与 Root 上别人的部分一字不差', async () => {
    const before = (await listChains()).filter(n => !n.startsWith(TAG) && !n.includes(SITE))
    log.length = 0
    const failures = await publish(cfgWith([]), devIds, api, report, { publishedBy: 'live-R1' })
    expect(failures).toEqual([])

    const names = await listChains()
    expect(names).not.toContain(chainNames.alarm(SITE))
    expect(names).not.toContain(chainNames.rollup(SITE))
    expect(await ourFlows()).toEqual([])
    // 与本站点无关的链原样保留(同事的链、xrs-mirror-test 的链都在这里面)
    expect(names.filter(n => !n.startsWith(TAG) && !n.includes(SITE)).sort()).toEqual(before.sort())
    expect(await rootOthers()).toBe(othersBefore)

    expect(log.find(l => l.startsWith('alarm:ok'))).toContain('已删上一版的')
    expect(log.find(l => l.startsWith('alarm:ok'))).toContain('已摘除 Root 上本站点的转发节点')
    expect(log.find(l => l.startsWith('rollup:ok'))).toContain('已删上一版的')
  }, 120000)

  it('再发布一次(仍然没有运算):幂等,不报错也没有可删的了,也不写 Root', async () => {
    log.length = 0
    expect(await publish(cfgWith([]), devIds, api, report, { publishedBy: 'live-R1' })).toEqual([])
    expect(log.find(l => l.startsWith('alarm:ok'))).toBe('alarm:ok 无')
    expect(log.find(l => l.startsWith('rollup:ok'))).toBe('rollup:ok 无')
    expect(await rootOthers()).toBe(othersBefore)
  }, 120000)
})
