/** 测点引用与状态映射(T5.0 实现)。 */
import type { SldDoc, SldPointRef, SldPointValue, SldStateRef, SldSwitchState } from './types'

/** doc 里对测点的全部引用(节点状态 + 数值标签),按出现顺序;同一 pt 被多处引用会出现多次 */
export function collectPointRefs(doc: SldDoc): SldPointRef[] {
  const refs: SldPointRef[] = []
  for (const n of doc.nodes) if (n.state) refs.push({ pt: n.state.pt, from: 'state', owner: n.id })
  for (const l of doc.labels) if (l.kind === 'value') refs.push({ pt: l.pt, from: 'label', owner: l.id })
  return refs
}

/**
 * 测点值 → 开关状态。值按 String() 比对 ref.map 的键;true / false 同时按 '1' / '0' 再比一次。
 * 没值、映射不上、或 now - ts > staleMs(给了 staleMs 才判)→ 'unknown'。
 * 节点没配状态来源(ref 为 undefined)→ 'closed'(SldNode.state 的约定:缺省视为常合)。
 */
export function resolveSwitchState(
  ref: SldStateRef | undefined,
  value: SldPointValue | undefined,
  opts?: { now?: number; staleMs?: number }
): SldSwitchState {
  if (!ref) return 'closed'
  if (!value || value.v === undefined || value.v === null) return 'unknown'
  if (opts?.staleMs !== undefined && (opts.now ?? Date.now()) - value.ts > opts.staleMs) return 'unknown'
  const keys = [String(value.v)]
  if (typeof value.v === 'boolean') keys.push(value.v ? '1' : '0')
  for (const k of keys) {
    // 只认自有键,免得 'constructor' / 'toString' 之类的值撞上原型链
    const hit = Object.prototype.hasOwnProperty.call(ref.map, k) ? ref.map[k] : undefined
    if (hit === 'open' || hit === 'closed') return hit
  }
  return 'unknown'
}
