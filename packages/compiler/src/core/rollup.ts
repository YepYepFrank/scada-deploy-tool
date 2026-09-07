// 定时聚合链:window.aggregate / window.delta / window.integrate 按「设备@@窗口」分组成流水线,
// window.cascade 生成 5m → 1h → 1d 三级归档管线(分级保留期)。
import type {
  AggName,
  Computation,
  RollupGroupSpec,
  RuleChainMetadata,
  RuleConnection,
  RuleNode,
  Window,
} from '../types'
import { AGG_SUFFIX, CASCADE_LEVELS, WINDOW_SECONDS } from './constants'
import { AGG_JS, AGG_JS_PREFIXED, CASCADE_JS, CASCADE_TICK_JS, ROLLUP_TICK_JS, withSpec } from './scripts'

const blank = (): RollupGroupSpec => ({ avg: [], min: [], max: [], sum: [], delta: {}, integrate: {} })

/** 把窗口类运算项归并为 `${device}@@${window}` → 规格(同一设备同一窗口共用一条流水线) */
export function rollupGroups(comps: Computation[]): Record<string, RollupGroupSpec> {
  const groups: Record<string, RollupGroupSpec> = {}
  const at = (c: Computation) => (groups[`${c.device}@@${c.window}`] ||= blank())
  for (const c of comps) {
    if (c.template === 'window.aggregate') {
      const g = at(c)
      for (const a of c.aggs || []) for (const k of c.keys || []) if (!g[a].includes(k)) g[a].push(k)
    } else if (c.template === 'window.delta') {
      at(c).delta[c.key as string] = c.output as string
    } else if (c.template === 'window.integrate') {
      at(c).integrate[c.key as string] = c.output as string
    }
  }
  return groups
}

const tsNode = (name: string, defaultTTL: number, x: number, y: number): RuleNode => ({
  type: 'org.thingsboard.rule.engine.telemetry.TbMsgTimeseriesNode',
  name,
  configuration: { defaultTTL },
  additionalInfo: { layoutX: x, layoutY: y },
})
const genNode = (
  name: string,
  period: number,
  originatorId: string,
  jsScript: string,
  x: number,
  y: number
): RuleNode => ({
  type: 'org.thingsboard.rule.engine.debug.TbMsgGeneratorNode',
  name,
  configuration: {
    msgCount: 0,
    periodInSeconds: period,
    originatorId,
    originatorType: 'DEVICE',
    queueName: null,
    jsScript,
  },
  additionalInfo: { layoutX: x, layoutY: y },
})
const fetchNode = (name: string, keys: string[], period: number, x: number, y: number): RuleNode => ({
  type: 'org.thingsboard.rule.engine.metadata.TbGetTelemetryNode',
  name,
  configuration: {
    latestTsKeyNames: keys,
    fetchMode: 'ALL',
    orderBy: 'ASC',
    aggregation: 'NONE',
    limit: 1000,
    useMetadataIntervalPatterns: false,
    startInterval: period,
    startIntervalTimeUnit: 'SECONDS',
    endInterval: 1,
    endIntervalTimeUnit: 'SECONDS',
  },
  additionalInfo: { layoutX: x, layoutY: y },
})
export const transformNode = (name: string, jsScript: string, x: number, y: number): RuleNode => ({
  type: 'org.thingsboard.rule.engine.transform.TbTransformMsgNode',
  name,
  configuration: { scriptLang: 'JS', jsScript },
  additionalInfo: { layoutX: x, layoutY: y },
})

export function rollupMetadata(
  chainId: string,
  groups: Record<string, RollupGroupSpec>,
  devIds: Record<string, string>,
  cascades: Computation[] = [],
  /** 输出前缀(ADR-003):派生名 PAvg5m → calc_PAvg5m;级联下一级读的也是带前缀的上一级输出 */
  prefix = ''
): RuleChainMetadata {
  const pfx = (k: string) => (!prefix || k.startsWith(prefix) ? k : prefix + k)
  const nodes: RuleNode[] = []
  const connections: RuleConnection[] = []
  const add = (n: RuleNode) => nodes.push(n) - 1
  const save = add(tsNode('save rollups', 0, 1000, 300))
  // 多级归档:每级独立保存节点(分级保留期)
  const saveByTtl: Record<number, number> = {}
  const saveFor = (ttl: number) => {
    if (saveByTtl[ttl] === undefined)
      saveByTtl[ttl] = add(
        tsNode(`save ttl=${ttl ? ttl / 86400 + 'd' : '∞'}`, ttl, 1300, 60 + Object.keys(saveByTtl).length * 100)
      )
    return saveByTtl[ttl]!
  }
  let cy = 900
  for (const c of cascades) {
    const device = c.device as string
    CASCADE_LEVELS.forEach((lv, li) => {
      const entries: { src: string; out: string; fn: AggName }[] = []
      for (const k of c.keys || [])
        for (const a of c.aggs || []) {
          const src = li === 0 ? k : pfx(`${k}${AGG_SUFFIX[a]}${CASCADE_LEVELS[li - 1]!.id}`)
          entries.push({ src, out: pfx(`${k}${AGG_SUFFIX[a]}${lv.id}`), fn: a })
        }
      const fetchKeys = [...new Set(entries.map(e => e.src))]
      const g = add(
        genNode(`tick 级联 ${device} @${lv.id}`, lv.seconds, devIds[device] as string, CASCADE_TICK_JS, 100, cy)
      )
      const f = add(fetchNode(`fetch 级联 ${device} @${lv.id}`, fetchKeys, lv.seconds, 400, cy))
      const a = add(transformNode(`级联汇算 ${device} @${lv.id}`, withSpec(CASCADE_JS, { entries }), 700, cy))
      connections.push(
        { fromIndex: g, toIndex: f, type: 'Success' },
        { fromIndex: f, toIndex: a, type: 'Success' },
        { fromIndex: a, toIndex: saveFor(lv.ttl), type: 'Success' }
      )
      cy += 120
    })
  }
  let i = 0
  for (const [gk, spec] of Object.entries(groups)) {
    const [device, window] = gk.split('@@') as [string, Window]
    const y = 80 + i++ * 120
    const period = WINDOW_SECONDS[window]
    // 后缀含 sum:AGG_JS 读 spec.sfx.sum(原 publisher.js 漏了这一项,sum 窗口会输出 keyundefined)
    const sfx = { avg: 'Avg' + window, min: 'Min' + window, max: 'Max' + window, sum: 'Sum' + window }
    const fetch = [
      ...new Set([
        ...spec.avg,
        ...spec.min,
        ...spec.max,
        ...spec.sum,
        ...Object.keys(spec.delta),
        ...Object.keys(spec.integrate),
      ]),
    ].sort()
    const g = add(genNode(`tick ${device} @${window}`, period, devIds[device] as string, ROLLUP_TICK_JS, 100, y))
    const f = add(fetchNode(`fetch ${device} @${window}`, fetch, period, 400, y))
    const a = add(
      transformNode(
        `aggregate ${device} @${window}`,
        prefix ? withSpec(AGG_JS_PREFIXED, { ...spec, sfx, pfx: prefix }) : withSpec(AGG_JS, { ...spec, sfx }),
        700,
        y
      )
    )
    connections.push(
      { fromIndex: g, toIndex: f, type: 'Success' },
      { fromIndex: f, toIndex: a, type: 'Success' },
      { fromIndex: a, toIndex: save, type: 'Success' }
    )
  }
  return {
    ruleChainId: { entityType: 'RULE_CHAIN', id: chainId },
    firstNodeIndex: null,
    nodes,
    connections,
    ruleChainConnections: null,
  }
}
