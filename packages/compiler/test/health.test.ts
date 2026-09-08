// 发布后自检:节点最近一次 STARTED success=false 才算失败;读不到事件一律不判定(宁可漏报不可误报)。
// 复刻的是 2026-09-08 那次真实故障:建告警节点写了 propagateRelationTypes,TB 4.3.1 只认 relationTypes。
import { describe, expect, it } from 'vitest'
import { checkChainHealth, summarizeNodeError, type ChainTarget, type TbApi } from '../src/index'

const REAL_ERROR = `org.thingsboard.rule.engine.api.TbNodeException: java.lang.IllegalArgumentException: Can't convert value: {"alarmType":"功率越限告警","propagateRelationTypes":["Contains"]}
	at org.thingsboard.rule.engine.api.util.TbNodeUtils.convert(TbNodeUtils.java:48)
	at java.base/java.util.concurrent.ForkJoinWorkerThread.run(ForkJoinWorkerThread.java:165)
Caused by: java.lang.IllegalArgumentException: Can't convert value: {"alarmType":"功率越限告警"}
	at org.thingsboard.common.util.JacksonUtil.treeToValue(JacksonUtil.java:242)
Caused by: com.fasterxml.jackson.databind.exc.UnrecognizedPropertyException: Unrecognized field "propagateRelationTypes" (class org.thingsboard.rule.engine.action.TbCreateAlarmNodeConfiguration), not marked as ignorable (12 known properties: "alarmType", "propagate", "relationTypes")
	at com.fasterxml.jackson.databind.exc.UnrecognizedPropertyException.from(UnrecognizedPropertyException.java:61)`

type NodeSpec = { name: string; type: string; started?: { ts: number; success: boolean; error?: string }[] }

/** 极简 TB:一条链、若干节点,每个节点给一串 LC_EVENT */
function fakeTb(chains: { name: string; root?: boolean; nodes: NodeSpec[] }[], opts: { noEvents?: boolean } = {}) {
  const calls: string[] = []
  const idOf = (chain: string, node?: string) => `id-${chain}${node ? '-' + node : ''}`
  const api: TbApi = async url => {
    calls.push(url)
    if (url === '/api/auth/user') return { tenantId: { id: 'tenant-1' } }
    if (url.startsWith('/api/ruleChains'))
      return { data: chains.map(c => ({ id: { id: idOf(c.name) }, name: c.name, root: !!c.root })) }
    let m = url.match(/^\/api\/ruleChain\/id-(.+)\/metadata$/)
    if (m) {
      const c = chains.find(x => x.name === m![1])!
      return { nodes: c.nodes.map(n => ({ id: { id: idOf(c.name, n.name) }, name: n.name, type: n.type })) }
    }
    m = url.match(/^\/api\/events\/RULE_NODE\/id-([^/]+)\/LC_EVENT/)
    if (m) {
      if (opts.noEvents) return { data: [] }
      const [chain, node] = m[1]!.split(/-(.*)/)
      const spec = chains.find(x => x.name === chain)?.nodes.find(n => n.name === node)
      return {
        data: (spec?.started ?? [{ ts: 1000, success: true }]).map(s => ({
          createdTime: s.ts,
          body: { event: 'STARTED', success: s.success, error: s.error },
        })),
      }
    }
    throw new Error('fakeTb 不认识 ' + url)
  }
  return { api, calls }
}

const run = (api: TbApi, targets: ChainTarget[]) =>
  checkChainHealth(api, targets, { since: 0, waitMs: 0, pollMs: 0, sleep: async () => {} })

describe('summarizeNodeError', () => {
  it('从几十行 Java 栈里留下首行 + 最后一层 Caused by(点名字段与该配置类认得的字段)', () => {
    const s = summarizeNodeError(REAL_ERROR)
    expect(s).toContain('TbNodeException')
    expect(s).toContain('根因:')
    expect(s).toContain('Unrecognized field "propagateRelationTypes"')
    expect(s).toContain('"relationTypes"') // TB 认得的字段名,照着改就行
    expect(s).not.toContain('ForkJoinWorkerThread') // 线程池栈帧不留
    expect(s.split('\n')).toHaveLength(1)
  })
  it('没有 Caused by 就只留首行;空异常给出占位', () => {
    expect(summarizeNodeError('java.lang.NullPointerException')).toBe('java.lang.NullPointerException')
    expect(summarizeNodeError('')).toBe('(TB 未给出异常内容)')
    expect(summarizeNodeError(undefined)).toBe('(TB 未给出异常内容)')
  })
})

describe('checkChainHealth', () => {
  it('节点启动失败 → 报出链名、节点名、节点类型与根因', async () => {
    const tb = fakeTb([
      {
        name: 'Site Alarms · s',
        nodes: [
          { name: 'P > 45?', type: 'org.thingsboard.rule.engine.filter.TbJsFilterNode' },
          {
            name: '告警: 功率越限告警',
            type: 'org.thingsboard.rule.engine.action.TbCreateAlarmNode',
            started: [{ ts: 2000, success: false, error: REAL_ERROR }],
          },
        ],
      },
    ])
    const r = await run(tb.api, [{ name: 'Site Alarms · s' }])
    expect(r.problems).toHaveLength(1)
    expect(r.problems[0]).toMatchObject({
      chain: 'Site Alarms · s',
      node: '告警: 功率越限告警',
      nodeType: 'TbCreateAlarmNode',
    })
    expect(r.problems[0]!.error).toContain('propagateRelationTypes')
    expect(r.checked).toBe(2)
    expect(r.pending).toEqual([])
  })

  it('修好后重发:同一节点新的一条 STARTED success=true 覆盖旧的失败记录', async () => {
    const tb = fakeTb([
      {
        name: 'Site Alarms · s',
        nodes: [
          {
            name: '告警: x',
            type: 'a.TbCreateAlarmNode',
            started: [
              { ts: 3000, success: true },
              { ts: 2000, success: false, error: REAL_ERROR },
            ],
          },
        ],
      },
    ])
    expect((await run(tb.api, [{ name: 'Site Alarms · s' }])).problems).toEqual([])
  })

  it('Root 链只查我们那条转发节点,别人的节点不判定', async () => {
    const tb = fakeTb([
      {
        name: 'Root Rule Chain',
        root: true,
        nodes: [
          { name: '同事的节点', type: 'a.TbX', started: [{ ts: 2000, success: false, error: '别人的问题' }] },
          { name: 'site alarms flow · s', type: 'flow.TbRuleChainInputNode' },
        ],
      },
    ])
    const r = await run(tb.api, [{ root: true, nodes: ['site alarms flow · s'] }])
    expect(r.problems).toEqual([])
    expect(r.checked).toBe(1)
  })

  it('链不存在(没声明对应运算)不算问题;所有目标都不在就给出跳过原因', async () => {
    const tb = fakeTb([{ name: 'Site Alarms · s', nodes: [{ name: 'n', type: 'a.TbX' }] }])
    const r = await run(tb.api, [{ name: 'Site Revenue · s' }])
    expect(r.problems).toEqual([])
    expect(r.skipped).toContain('没有可核对的节点')
  })

  it('事件还没落库:超时后计入 pending,不算失败', async () => {
    const tb = fakeTb([{ name: 'Site Alarms · s', nodes: [{ name: 'n', type: 'a.TbX' }] }], { noEvents: true })
    const r = await run(tb.api, [{ name: 'Site Alarms · s' }])
    expect(r.problems).toEqual([])
    expect(r.checked).toBe(0)
    expect(r.pending).toEqual(['Site Alarms · s · n'])
  })

  it('事件接口不可用(旧版 TB / 权限不足)→ 整体跳过,绝不误判为失败', async () => {
    const dead: TbApi = async url => {
      if (url === '/api/auth/user') return { tenantId: { id: 't' } }
      throw new Error('HTTP 403')
    }
    const r = await run(dead, [{ name: 'Site Alarms · s' }])
    expect(r.problems).toEqual([])
    expect(r.skipped).toContain('403')
  })

  it('取不到 tenantId 就跳过(事件接口必须带 tenantId)', async () => {
    const noUser: TbApi = async () => {
      throw new Error('401')
    }
    expect((await run(noUser, [{ name: 'x' }])).skipped).toContain('/api/auth/user')
  })

  it('等待期内事件才落库:轮询到就判定', async () => {
    let round = 0
    const late: TbApi = async url => {
      if (url === '/api/auth/user') return { tenantId: { id: 't' } }
      if (url.startsWith('/api/ruleChains')) return { data: [{ id: { id: 'c1' }, name: 'C' }] }
      if (url.includes('/metadata')) return { nodes: [{ id: { id: 'n1' }, name: 'n', type: 'a.TbX' }] }
      // 前两轮还没落库,第三轮才出现
      return {
        data: round++ < 2 ? [] : [{ createdTime: 9, body: { event: 'STARTED', success: false, error: 'boom' } }],
      }
    }
    const r = await checkChainHealth(late, [{ name: 'C' }], {
      since: 0,
      waitMs: 10,
      pollMs: 1,
      now: () => 0, // 时钟不推进,靠 left 清空退出
      sleep: async () => {},
    })
    expect(r.problems).toHaveLength(1)
    expect(r.problems[0]!.error).toBe('boom')
  })
})
