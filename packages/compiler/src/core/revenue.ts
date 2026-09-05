// 分时电价收益:revenue.periodic → 独立规则链(取电量 → 切到电价资产取 electricityPrice → 算收益 → 切到收益资产存)
// 收益资产已知 id 时追加「当日累计」管线:<output>Daily / <output>IncomeDaily / <output>CostDaily
import type { Computation, RuleChainMetadata, RuleConnection, RuleNode } from '../types'
import { WINDOW_SECONDS } from './constants'
import { CASCADE_JS, REVENUE_DAILY_TICK_JS, REVENUE_JS, REVENUE_TICK_JS, withSpec } from './scripts'
import { transformNode } from './rollup'

const toAssetNode = (name: string, entityNamePattern: string, x: number, y: number): RuleNode => ({
  type: 'org.thingsboard.rule.engine.transform.TbChangeOriginatorNode',
  name,
  configuration: {
    originatorSource: 'ENTITY',
    entityType: 'ASSET',
    entityNamePattern,
    relationsQuery: {
      direction: 'FROM',
      maxLevel: 1,
      filters: [{ relationType: 'Contains', entityTypes: [], negate: false }],
      fetchLastLevelOnly: false,
    },
  },
  additionalInfo: { layoutX: x, layoutY: y },
})

export function revenueMetadata(
  chainId: string,
  revs: Computation[],
  devIds: Record<string, string>,
  assetIds: Record<string, string> = {}
): RuleChainMetadata {
  const nodes: RuleNode[] = []
  const connections: RuleConnection[] = []
  const add = (n: RuleNode) => nodes.push(n) - 1
  revs.forEach((c, i) => {
    const y = 80 + i * 140
    const output = c.output as string
    const period = (c.window && WINDOW_SECONDS[c.window]) || 3600
    const gen = add({
      type: 'org.thingsboard.rule.engine.debug.TbMsgGeneratorNode',
      name: `tick 收益 ${output}`,
      configuration: {
        msgCount: 0,
        periodInSeconds: period,
        originatorId: devIds[c.charge!.device],
        originatorType: 'DEVICE',
        queueName: null,
        jsScript: REVENUE_TICK_JS,
      },
      additionalInfo: { layoutX: 60, layoutY: y },
    })
    const fetch = add({
      type: 'org.thingsboard.rule.engine.metadata.TbGetTelemetryNode',
      name: `取电量 ${output}`,
      configuration: {
        latestTsKeyNames: [...new Set([c.charge!.key, c.discharge!.key])],
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
      additionalInfo: { layoutX: 280, layoutY: y },
    })
    const toPrice = add(toAssetNode('切到电价资产', c.priceAsset as string, 500, y))
    const attrs = add({
      type: 'org.thingsboard.rule.engine.metadata.TbGetAttributesNode',
      name: '取电价配置',
      configuration: {
        tellFailureIfAbsent: true,
        fetchTo: 'METADATA',
        clientAttributeNames: [],
        sharedAttributeNames: [],
        serverAttributeNames: ['electricityPrice'],
        latestTsKeyNames: [],
        getLatestValueWithTs: false,
      },
      additionalInfo: { layoutX: 700, layoutY: y },
    })
    const calc = add(
      transformNode(
        `算收益 ${output}`,
        withSpec(REVENUE_JS, { chargeKey: c.charge!.key, dischargeKey: c.discharge!.key, output }),
        900,
        y
      )
    )
    const toOut = add(toAssetNode('切到收益资产', c.asset as string, 1100, y))
    const save = add({
      type: 'org.thingsboard.rule.engine.telemetry.TbMsgTimeseriesNode',
      name: `存收益 ${output}`,
      configuration: { defaultTTL: 0 },
      additionalInfo: { layoutX: 1300, layoutY: y },
    })
    connections.push(
      { fromIndex: gen, toIndex: fetch, type: 'Success' },
      { fromIndex: fetch, toIndex: toPrice, type: 'Success' },
      { fromIndex: toPrice, toIndex: attrs, type: 'Success' },
      { fromIndex: attrs, toIndex: calc, type: 'Success' },
      { fromIndex: calc, toIndex: toOut, type: 'Success' },
      { fromIndex: toOut, toIndex: save, type: 'Success' }
    )
    const aid = assetIds[c.asset as string]
    if (aid) {
      const outKeys = [output, output + 'Income', output + 'Cost']
      const dGen = add({
        type: 'org.thingsboard.rule.engine.debug.TbMsgGeneratorNode',
        name: `tick 日收益 ${output}`,
        configuration: {
          msgCount: 0,
          periodInSeconds: period,
          originatorId: aid,
          originatorType: 'ASSET',
          queueName: null,
          jsScript: REVENUE_DAILY_TICK_JS,
        },
        additionalInfo: { layoutX: 60, layoutY: y + 70 },
      })
      const dFetch = add({
        type: 'org.thingsboard.rule.engine.metadata.TbGetTelemetryNode',
        name: `取当日收益 ${output}`,
        configuration: {
          latestTsKeyNames: outKeys,
          fetchMode: 'ALL',
          orderBy: 'ASC',
          aggregation: 'NONE',
          limit: 1000,
          useMetadataIntervalPatterns: true,
          startIntervalPattern: '${dayStartTs}',
          endIntervalPattern: '${dayEndTs}',
          startInterval: 86400,
          startIntervalTimeUnit: 'SECONDS',
          endInterval: 1,
          endIntervalTimeUnit: 'SECONDS',
        },
        additionalInfo: { layoutX: 280, layoutY: y + 70 },
      })
      const dCalc = add(
        transformNode(
          `算日收益 ${output}`,
          withSpec(CASCADE_JS, { entries: outKeys.map(k => ({ src: k, out: k + 'Daily', fn: 'sum' })) }),
          500,
          y + 70
        )
      )
      const dSave = add({
        type: 'org.thingsboard.rule.engine.telemetry.TbMsgTimeseriesNode',
        name: `存日收益 ${output}`,
        configuration: { defaultTTL: 0 },
        additionalInfo: { layoutX: 720, layoutY: y + 70 },
      })
      connections.push(
        { fromIndex: dGen, toIndex: dFetch, type: 'Success' },
        { fromIndex: dFetch, toIndex: dCalc, type: 'Success' },
        { fromIndex: dCalc, toIndex: dSave, type: 'Success' }
      )
    }
  })
  return {
    ruleChainId: { entityType: 'RULE_CHAIN', id: chainId },
    firstNodeIndex: null,
    nodes,
    connections,
    ruleChainConnections: null,
  }
}
