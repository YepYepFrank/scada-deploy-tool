/** 旧版本文档迁移到当前版本(T5.1 实现;v1 时只做缺省字段补全)。 */
import type { SldDoc } from './types'

export function migrateSldDoc(_raw: unknown): SldDoc {
  throw new Error('migrateSldDoc: 未实现(T5.1)')
}

/** 新建空图 */
export function emptySldDoc(w = 1600, h = 900, grid = 10): SldDoc {
  return { v: 1, canvas: { w, h, grid }, nodes: [], buses: [], wires: [], labels: [] }
}
