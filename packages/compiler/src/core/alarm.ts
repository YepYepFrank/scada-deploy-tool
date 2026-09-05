// 阈值告警链:每条规则 相关性过滤 → 阈值判断 → True 建告警 / False 清告警;
// trigger = 'edge' 时上次状态存设备服务端属性,只在状态翻转时动作。
import type { Computation, RuleChainMetadata, RuleConnection, RuleNode } from '../types'
import { OP_JS } from './constants'
import { transformNode } from './rollup'

const filterNode = (name: string, jsScript: string, x: number, y: number): RuleNode => ({
  type: 'org.thingsboard.rule.engine.filter.TbJsFilterNode',
  name,
  configuration: { scriptLang: 'JS', jsScript },
  additionalInfo: { layoutX: x, layoutY: y },
})

/** 边沿触发用的状态属性名 */
export const alarmStateAttr = (key: string, op: string) => `almState_${key}_${op}`.replace(/[^\w]/g, '_')

export function alarmMetadata(chainId: string, alarms: Computation[]): RuleChainMetadata {
  const nodes: RuleNode[] = []
  const connections: RuleConnection[] = []
  const add = (n: RuleNode) => nodes.push(n) - 1
  const entry = add(filterNode('entry', 'return true;', 40, 40))
  alarms.forEach((a, i) => {
    const y = 120 + i * 140
    const key = a.key as string
    const cond = a.condition!
    const op = OP_JS[cond.op]
    const val = cond.value
    const alarmType = a.name || `${key} 阈值告警`
    const msgText = (a.message || '').replace(/'/g, "\\'")
    // 模板展开的告警携带 devices 列表(一条规则覆盖多台同类设备);单设备时退化为一元列表
    const devList = a.devices?.length ? a.devices : [a.device as string]
    const relScript =
      devList.length === 1
        ? `return metadata.deviceName === '${devList[0]}' && typeof msg['${key}'] !== 'undefined';`
        : `return ${JSON.stringify(devList)}.indexOf(metadata.deviceName) >= 0 && typeof msg['${key}'] !== 'undefined';`
    const rel = add(
      filterNode(`关于 ${devList.length === 1 ? devList[0] : devList.length + ' 台设备'}.${key}?`, relScript, 60, y)
    )
    const thr = add(filterNode(`${key} ${op} ${val}?`, `return Number(msg['${key}']) ${op} ${val};`, 380, y))
    // 文案中的 {value} 在触发时替换为实时值
    const msgExpr = "'" + msgText.split('{value}').join(`' + msg['${key}'] + '`) + "'"
    const create = add({
      type: 'org.thingsboard.rule.engine.action.TbCreateAlarmNode',
      name: `告警: ${alarmType}`,
      configuration: {
        alarmType,
        severity: a.severity,
        propagate: false,
        useMessageAlarmData: false,
        overwriteAlarmDetails: false,
        dynamicSeverity: false,
        scriptLang: 'JS',
        alarmDetailsBuildJs:
          `var details = {}; details.message = ${msgExpr}; details.key = '${key}'; ` +
          `details.value = msg['${key}']; details.threshold = ${val}; return details;`,
      },
      additionalInfo: { layoutX: 700, layoutY: y - 30 },
    })
    const clear = add({
      type: 'org.thingsboard.rule.engine.action.TbClearAlarmNode',
      name: `清除: ${alarmType}`,
      configuration: { alarmType, scriptLang: 'JS', alarmDetailsBuildJs: 'var details = {}; return details;' },
      additionalInfo: { layoutX: 700, layoutY: y + 60 },
    })
    if (a.trigger === 'edge') {
      const stateAttr = alarmStateAttr(key, cond.op)
      const getSt = add({
        type: 'org.thingsboard.rule.engine.metadata.TbGetAttributesNode',
        name: '取上次状态',
        configuration: {
          tellFailureIfAbsent: false,
          fetchTo: 'METADATA',
          clientAttributeNames: [],
          sharedAttributeNames: [],
          serverAttributeNames: [stateAttr],
          latestTsKeyNames: [],
          getLatestValueWithTs: false,
        },
        additionalInfo: { layoutX: 240, layoutY: y },
      })
      const prep = add(
        transformNode(
          `判定变化 ${alarmType}`,
          `var cond = Number(msg['${key}']) ${op} ${val}; ` +
            `metadata.cond = String(cond); ` +
            `metadata.changed = String(String(cond) !== metadata.ss_${stateAttr}); ` +
            `return { msg: msg, metadata: metadata, msgType: msgType };`,
          400,
          y
        )
      )
      const chg = add(filterNode('状态翻转?', "return metadata.changed === 'true';", 540, y))
      const saveSt = add(
        transformNode(
          `写状态 ${alarmType}`,
          `var m = {}; m['${stateAttr}'] = metadata.cond === 'true'; ` +
            `return { msg: m, metadata: metadata, msgType: 'POST_ATTRIBUTES_REQUEST' };`,
          900,
          y + 30
        )
      )
      const attrSave = add({
        type: 'org.thingsboard.rule.engine.telemetry.TbMsgAttributesNode',
        name: '存状态属性',
        configuration: {
          processingSettings: { type: 'ON_EVERY_MESSAGE' },
          scope: 'SERVER_SCOPE',
          notifyDevice: false,
          sendAttributesUpdatedNotification: false,
          updateAttributesOnlyOnValueChange: true,
        },
        additionalInfo: { layoutX: 1050, layoutY: y + 30 },
      })
      connections.push(
        { fromIndex: entry, toIndex: rel, type: 'True' },
        { fromIndex: rel, toIndex: getSt, type: 'True' },
        { fromIndex: getSt, toIndex: prep, type: 'Success' },
        { fromIndex: prep, toIndex: chg, type: 'Success' },
        { fromIndex: chg, toIndex: thr, type: 'True' },
        { fromIndex: thr, toIndex: create, type: 'True' },
        { fromIndex: thr, toIndex: clear, type: 'False' },
        { fromIndex: create, toIndex: saveSt, type: 'Created' },
        { fromIndex: create, toIndex: saveSt, type: 'Updated' },
        { fromIndex: clear, toIndex: saveSt, type: 'Cleared' },
        { fromIndex: clear, toIndex: saveSt, type: 'False' },
        { fromIndex: saveSt, toIndex: attrSave, type: 'Success' }
      )
    } else {
      connections.push(
        { fromIndex: entry, toIndex: rel, type: 'True' },
        { fromIndex: rel, toIndex: thr, type: 'True' },
        { fromIndex: thr, toIndex: create, type: 'True' },
        { fromIndex: thr, toIndex: clear, type: 'False' }
      )
    }
  })
  return {
    ruleChainId: { entityType: 'RULE_CHAIN', id: chainId },
    firstNodeIndex: entry,
    nodes,
    connections,
    ruleChainConnections: null,
  }
}
