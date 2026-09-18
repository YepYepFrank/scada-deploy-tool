/** 测点引用与状态映射(T5.0 实现)。 */
import type { SldDoc, SldPointRef, SldPointValue, SldStateRef, SldSwitchState } from './types'

/** doc 里对测点的全部引用(节点状态 + 数值标签),按出现顺序;同一 pt 被多处引用会出现多次 */
export function collectPointRefs(_doc: SldDoc): SldPointRef[] {
  throw new Error('collectPointRefs: 未实现(T5.0)')
}

/**
 * 测点值 → 开关状态。值按 String() 比对 ref.map 的键;true / false 同时按 '1' / '0' 再比一次。
 * 没值、映射不上、或 now - ts > staleMs(给了 staleMs 才判)→ 'unknown'。
 */
export function resolveSwitchState(
  _ref: SldStateRef | undefined,
  _value: SldPointValue | undefined,
  _opts?: { now?: number; staleMs?: number }
): SldSwitchState {
  throw new Error('resolveSwitchState: 未实现(T5.0)')
}
