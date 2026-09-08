// live:发布后自检在真实 TB 上确实能抓到「节点配置字段不对 → actor 起不来 → 消息被静默丢弃」。
// 自建一条临时链承载故障,不碰任何现有站点的链;afterAll 兜底删除。
// 复刻 2026-09-08 P0-1:建告警节点写了 propagateRelationTypes,TB CE 4.3.1 只认 relationTypes。
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { checkChainHealth, type TbApi } from '../../src/index'
import { hasCreds, makeApi, TB_BASE } from './env'

const CHAIN = `自检 live 临时链 ${Date.now().toString(36).slice(-5)}(可删)`
const BAD_NODE = '故意写错字段的告警节点'
const GOOD_NODE = '正常的过滤节点'

const alarmNode = (configuration: Record<string, unknown>) => ({
  type: 'org.thingsboard.rule.engine.action.TbCreateAlarmNode',
  name: BAD_NODE,
  configuration: {
    alarmType: '自检验证',
    severity: 'WARNING',
    useMessageAlarmData: false,
    overwriteAlarmDetails: false,
    dynamicSeverity: false,
    scriptLang: 'JS',
    alarmDetailsBuildJs: 'return {};',
    ...configuration,
  },
  additionalInfo: { layoutX: 100, layoutY: 100 },
})
const goodNode = {
  type: 'org.thingsboard.rule.engine.filter.TbJsFilterNode',
  name: GOOD_NODE,
  configuration: { scriptLang: 'JS', jsScript: 'return true;' },
  additionalInfo: { layoutX: 320, layoutY: 100 },
}

describe.skipIf(!hasCreds)(`发布后自检(live @ ${TB_BASE})`, () => {
  let api: TbApi
  let chainId = ''
  const saveNodes = async (nodes: unknown[]) => {
    const since = Date.now()
    await api('/api/ruleChain/metadata', {
      ruleChainId: { entityType: 'RULE_CHAIN', id: chainId },
      firstNodeIndex: 0,
      connections: [],
      nodes,
    })
    return since
  }

  beforeAll(async () => {
    api = await makeApi()
    const c = await api('/api/ruleChain', { name: CHAIN, type: 'CORE', debugMode: false, root: false })
    chainId = c.id.id
  })
  afterAll(async () => {
    if (chainId) await api(`/api/ruleChain/${chainId}`, null, 'DELETE').catch(() => {})
  })

  it('坏字段的节点起不来 → 抓到,报出节点名、类型与根因;同链的正常节点不误报', async () => {
    // TB 4.3.1 的 TbCreateAlarmNodeConfiguration 没有 propagateRelationTypes 这个字段
    const since = await saveNodes([alarmNode({ propagate: true, propagateRelationTypes: ['Contains'] }), goodNode])
    const r = await checkChainHealth(api, [{ name: CHAIN }], { since, waitMs: 8000 })
    expect(r.skipped).toBeUndefined()
    expect(r.problems.map(p => p.node)).toEqual([BAD_NODE])
    const p = r.problems[0]!
    expect(p.chain).toBe(CHAIN)
    expect(p.nodeType).toBe('TbCreateAlarmNode')
    // 根因里有错的字段名,也有 TB 认得的字段名——照着就能改
    expect(p.error).toContain('propagateRelationTypes')
    expect(p.error).toContain('relationTypes')
    expect(p.error).not.toContain('\n')
    expect(r.checked).toBe(2)
  }, 30000)

  it('把字段名改对再存一次 → 同一条链自检通过(证明判据取的是最近一次 STARTED)', async () => {
    const since = await saveNodes([alarmNode({ propagate: true, relationTypes: ['Contains'] }), goodNode])
    const r = await checkChainHealth(api, [{ name: CHAIN }], { since, waitMs: 8000 })
    expect(r.skipped).toBeUndefined()
    expect(r.problems).toEqual([])
    expect(r.checked).toBe(2)
  }, 30000)

  it('链不存在时给出跳过原因,不当成失败', async () => {
    const r = await checkChainHealth(api, [{ name: '这条链不存在-' + Date.now() }], { since: Date.now(), waitMs: 0 })
    expect(r.problems).toEqual([])
    expect(r.skipped).toBeTruthy()
  }, 20000)
})
