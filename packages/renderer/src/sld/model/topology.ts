/** 连通图与带电计算(T5.1 实现)。 */
import type { SldDoc, SldEnergizeResult, SldSwitchState, SldSymbolLookup } from './types'

/**
 * 从电源点(node.source)出发,沿连线 / 母线 / 导通的图元传播。
 * - conduct = 'switch' 的节点按 states[node.id] 判断;没给或 unknown 按断开算,并把它后面本可带电的部分标 uncertain。
 * - conduct = 'transformer' 穿过后电压等级换成 node.portKv[出口端口]。
 * - 母线自己给了 kv 的,以母线的为准。
 * 返回每个节点 / 母线 / 连线的带电情况;图里没有电源点时全部 live = false。
 */
export function energize(
  _doc: SldDoc,
  _symbols: SldSymbolLookup,
  _states: Record<string, SldSwitchState>
): SldEnergizeResult {
  throw new Error('energize: 未实现(T5.1)')
}
