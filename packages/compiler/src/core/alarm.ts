// 阈值告警链:每条规则 相关性过滤 → 阈值判断 → True 建告警 / False 清告警;
// trigger = 'edge' 时上次状态存设备服务端属性(每条规则一份,见 alarmStateAttr),只在状态翻转时动作。
import type { Computation, RuleChainMetadata, RuleConnection, RuleNode } from '../types'
import { OP_JS } from './constants'
import { hash } from './print'
import { transformNode } from './rollup'

const filterNode = (name: string, jsScript: string, x: number, y: number): RuleNode => ({
  type: 'org.thingsboard.rule.engine.filter.TbJsFilterNode',
  name,
  configuration: { scriptLang: 'JS', jsScript },
  additionalInfo: { layoutX: x, layoutY: y },
})

/** 开关变位告警的方向(2026-09-11 现场需求:由分到合、由合到分,可只选一种也可都选) */
export const SWITCH_DIRS = { close: '由分到合', open: '由合到分' } as const
export type SwitchDir = keyof typeof SWITCH_DIRS

/**
 * 开关变位告警(template 'alarm.switch')→ 1~2 条「变化才报」的阈值告警,规则链生成不变:
 *   由分到合:测点变成合闸值时报,离开合闸值(分闸)时自动清除 —— 条件 == 合闸值;
 *   由合到分:测点离开合闸值时报,回到合闸值时自动清除 —— 条件 != 合闸值(非合闸值都算分闸)。
 * 「上次状态」属性每条规则一份(alarmStateAttr:测点 / 比较符 / 阈值 / 告警类型指纹),同一测点两个方向都选也不会互相覆盖。
 * 告警类型名 =「名称(由分到合)」「名称(由合到分)」,第 4 步告警绑定、告警列表认的都是它。
 */
export function expandSwitchAlarms(comps: Computation[]): Computation[] {
  return comps.flatMap(c => {
    if (c.template !== 'alarm.switch') return [c]
    const closed = typeof c.closedValue === 'number' ? c.closedValue : 1
    const dirs = [...new Set(Array.isArray(c.directions) ? c.directions : [])].filter(
      (d): d is SwitchDir => d in SWITCH_DIRS
    )
    const { directions: _dirs, closedValue: _closed, ...rest } = c
    return dirs.map((d): Computation => ({
      ...rest,
      template: 'alarm.threshold',
      name: `${c.name}(${SWITCH_DIRS[d]})`,
      condition: { op: d === 'close' ? 'eq' : 'ne', value: closed },
      trigger: 'edge',
      message: `${c.name}:${SWITCH_DIRS[d]}(当前值 {value})`,
    }))
  })
}

/**
 * 边沿触发用的「上次状态」属性名(设备服务端属性),每条规则一份:
 *   almState_<测点>_<比较符>_<阈值>_<告警类型指纹 6 位>,非 \w 字符换成 _。
 * 2026-09-11 起带阈值与告警类型:原来只按 测点 + 比较符 取名,同一台设备上 P>100、P>200 两条边沿告警
 * 读写同一个属性,互把对方的状态当成自己的上次状态,翻转漏报或重报。测点 / 比较符 / 阈值 / 告警类型全同的
 * 两条规则仍共用一份(条件与告警都一样,本就是重复规则)。
 * 代价:改名后首次重新发布会把告警链重写一次,新属性一开始是空的,发布后第一条消息一律算「翻转」——
 * 越限的建一次告警(TB 对同类型已激活的告警去重,只更新不新建),没越限的清一次;
 * 旧的 almState_<测点>_<比较符> 属性留在设备上,不再有人读写。
 */
export const alarmStateAttr = (key: string, op: string, value: number, alarmType: string) =>
  `almState_${key}_${op}_${value}_${hash(alarmType).slice(0, 6)}`.replace(/[^\w]/g, '_')

/** 入口防回环过滤(ADR-003 决定 2):资产消息放行;设备消息里带前缀且不在白名单的 key → 丢弃 */
export function cascadeGuardScript(prefix: string, whitelist: string[]): string {
  const wl = Object.fromEntries(whitelist.map(k => [k, 1]))
  return (
    `var pfx = ${JSON.stringify(prefix)}; var wl = ${JSON.stringify(wl)}; ` +
    "if (typeof metadata.deviceName === 'undefined') return true; " +
    'var ks = Object.keys(msg); for (var i = 0; i < ks.length; i++) { if (ks[i].indexOf(pfx) === 0 && !wl[ks[i]]) return false; } ' +
    'return true;'
  )
}

export function alarmMetadata(
  chainId: string,
  alarms: Computation[],
  guard?: { prefix: string; whitelist: string[] },
  opts: { propagate?: boolean } = {}
): RuleChainMetadata {
  const nodes: RuleNode[] = []
  const connections: RuleConnection[] = []
  const add = (n: RuleNode) => nodes.push(n) - 1
  const entryScript = guard?.prefix ? cascadeGuardScript(guard.prefix, guard.whitelist) : 'return true;'
  const entry = add(filterNode('entry', entryScript, 40, 40))
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
        propagate: !!opts.propagate,
        ...(opts.propagate ? { relationTypes: ['Contains'] } : {}),
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
      const stateAttr = alarmStateAttr(key, cond.op, val, alarmType)
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
