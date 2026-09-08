// 发布后自检(2026-09-08 P0-1 的教训):TB 的规则节点若配置字段名不对,init 会抛异常、actor 起不来,
// 之后所有进入该节点的消息被静默丢弃 —— 非调试模式下 TB 不记录任何事件、节点错误计数也是 0,
// 唯一的痕迹是节点的 LC_EVENT 里一条 `STARTED success=false`。镜像上「建告警节点」就这样静默失败了一天多,
// 直到里程碑 C 做 24 小时采样才发现。这里在写完规则链之后把它读回来核对。
//
// 判据只有一条:某节点最近一次 STARTED 的 success === false → 失败。
// 读不到事件(接口报错、租户 id 取不到、事件还没落库)一律不算失败 —— 宁可漏报也不能误报把发布挡住。
import type { TbApi } from './api'

/** 要核对的链:按名字找,或 Root 链;nodes 给了就只查这几个节点(Root 链只查我们加的那条转发节点) */
export interface ChainTarget {
  name?: string
  root?: boolean
  nodes?: string[]
}

export interface NodeHealthProblem {
  chain: string
  node: string
  nodeType: string
  error: string
}

export interface ChainHealthReport {
  /** 确证启动失败的节点 */
  problems: NodeHealthProblem[]
  /** 读到了 STARTED 事件的节点数 */
  checked: number
  /** 等到超时仍无事件的节点(证明不了它坏,不计失败) */
  pending: string[]
  /** 整个核对没能进行时的原因 */
  skipped?: string
}

export interface HealthOptions {
  /** 发布开始的时刻;只看这之后的事件 */
  since: number
  /** 等事件落库的总时长,默认 4 秒 */
  waitMs?: number
  /** 轮询间隔,默认 500 毫秒 */
  pollMs?: number
  tenantId?: string
  sleep?: (ms: number) => Promise<void>
  now?: () => number
}

/** 本机与 TB 的时钟未必一致:窗口起点多留 5 分钟,免得时钟快几秒就把刚落库的事件筛掉了 */
const CLOCK_SLACK_MS = 5 * 60_000

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e))

/**
 * Java 异常整段有二三十行,绝大多数是线程池栈帧。真正有用的是首行(哪个节点、什么类型的错)
 * 和最后一层 `Caused by:`(通常直接点名字段,并列出该配置类认得的全部字段)。
 */
export function summarizeNodeError(raw: unknown): string {
  const text = String(raw ?? '').trim()
  if (!text) return '(TB 未给出异常内容)'
  const lines = text.split('\n').map(l => l.trim())
  const head = lines[0] || text
  const causes = lines.filter(l => l.startsWith('Caused by:'))
  const root = causes[causes.length - 1]
  const cut = (s: string, n: number) => (s.length > n ? s.slice(0, n) + '…' : s)
  if (!root || root === head) return cut(head, 500)
  return `${cut(head, 180)} ← 根因:${cut(root.replace(/^Caused by:\s*/, ''), 500)}`
}

/** 事件接口的排序参数各版本不一,不依赖它:自己按 createdTime 取最近一条 */
function latestStarted(page: unknown): { success?: boolean; error?: unknown } | null {
  const rows = (page as { data?: { createdTime?: number; body?: Record<string, unknown> }[] } | null)?.data
  if (!Array.isArray(rows)) return null
  let best: { createdTime: number; body: Record<string, unknown> } | null = null
  for (const r of rows) {
    if (!r?.body || r.body.event !== 'STARTED') continue
    const ts = Number(r.createdTime ?? 0)
    if (!best || ts >= best.createdTime) best = { createdTime: ts, body: r.body }
  }
  return best ? (best.body as { success?: boolean; error?: unknown }) : null
}

export async function checkChainHealth(
  api: TbApi,
  targets: ChainTarget[],
  opts: HealthOptions
): Promise<ChainHealthReport> {
  const { since, waitMs = 4000, pollMs = 500 } = opts
  const now = opts.now ?? (() => Date.now())
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>(r => setTimeout(r, ms)))
  const problems: NodeHealthProblem[] = []
  const pending: string[] = []
  const done = (skipped?: string): ChainHealthReport => ({ problems, checked, pending, skipped })
  let checked = 0
  if (!targets.length) return done('没有需要核对的规则链')

  let tenantId = opts.tenantId
  if (!tenantId) {
    try {
      tenantId = (await api('/api/auth/user'))?.tenantId?.id
    } catch (e) {
      return done('读 /api/auth/user 失败:' + msg(e))
    }
    if (!tenantId) return done('取不到 tenantId,事件接口用不了')
  }

  type Target = { chain: string; node: string; nodeType: string; nodeId: string }
  const queue: Target[] = []
  try {
    const chains: { id: { id: string }; name: string; root?: boolean }[] =
      (await api('/api/ruleChains?pageSize=100&page=0'))?.data || []
    for (const t of targets) {
      const c = t.root ? chains.find(x => x.root) : chains.find(x => x.name === t.name)
      if (!c) continue // 该链本来就不该存在(没声明对应运算),不是问题
      const meta = await api(`/api/ruleChain/${c.id.id}/metadata`)
      for (const n of meta?.nodes || []) {
        if (t.nodes && !t.nodes.includes(n.name)) continue
        if (!n?.id?.id) continue
        queue.push({
          chain: c.name,
          node: n.name,
          nodeType:
            String(n.type || '')
              .split('.')
              .pop() || '',
          nodeId: n.id.id,
        })
      }
    }
  } catch (e) {
    return done('读规则链节点失败:' + msg(e))
  }
  if (!queue.length) return done('规则链里没有可核对的节点')

  const left = new Map(queue.map(t => [t.nodeId, t]))
  const startTime = Math.max(0, since - CLOCK_SLACK_MS)
  const deadline = now() + waitMs
  for (;;) {
    for (const [id, t] of [...left]) {
      let page: unknown
      try {
        page = await api(
          `/api/events/RULE_NODE/${id}/LC_EVENT?tenantId=${tenantId}&pageSize=20&page=0` +
            `&startTime=${startTime}&endTime=${now()}`
        )
      } catch (e) {
        return done('读节点生命周期事件失败:' + msg(e))
      }
      const started = latestStarted(page)
      if (!started) continue // 还没落库,下一轮再看
      left.delete(id)
      checked++
      if (started.success === false)
        problems.push({ chain: t.chain, node: t.node, nodeType: t.nodeType, error: summarizeNodeError(started.error) })
    }
    if (!left.size || now() >= deadline) break
    await sleep(pollMs)
  }
  for (const t of left.values()) pending.push(`${t.chain} · ${t.node}`)
  return done()
}
