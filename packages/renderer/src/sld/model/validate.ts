/** 图的结构校验(T5.1 实现)。 */
import type { SldDoc, SldIssue, SldSymbolLookup } from './types'

export function validateSldDoc(_doc: unknown, _symbols: SldSymbolLookup): SldIssue[] {
  throw new Error('validateSldDoc: 未实现(T5.1)')
}

/** 形状守卫:只看 v / 四个数组是否在,不做完整校验 */
export function isSldDoc(x: unknown): x is SldDoc {
  const d = x as SldDoc
  return (
    !!d &&
    typeof d === 'object' &&
    d.v === 1 &&
    Array.isArray(d.nodes) &&
    Array.isArray(d.buses) &&
    Array.isArray(d.wires) &&
    Array.isArray(d.labels)
  )
}
