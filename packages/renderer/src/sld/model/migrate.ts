/** 旧版本文档迁移到当前版本(T5.1 实现;v1 时只做缺省字段补全)。 */
import { SLD_DOC_VERSION, SLD_GRID } from './types'
import type { SldDoc } from './types'

const DEFAULT_CANVAS_W = 1600
const DEFAULT_CANVAS_H = 900

const isObj = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x)

/**
 * 读入的文档(项目文件 / 已发布页面的 props.doc)→ 当前版本的 SldDoc。
 * - v1:nodes / buses / wires / labels 缺了(或不是数组)补 [];frames 是可选字段,缺了不补;
 *   canvas 缺省 1600 × 900 × 10,只补缺的那几项,已有的值不动(grid 写错由 validateSldDoc 报 bad-grid)。
 * - 不是对象、或 v 不是认识的版本:抛错(调用方据此提示「文件不是接线图 / 版本太新,请升级工具」)。
 * 不改输入:返回新的顶层对象与 canvas;元素数组沿用输入的引用,不做深拷贝。
 * 只补结构不做校验,校验走 validateSldDoc。
 */
export function migrateSldDoc(raw: unknown): SldDoc {
  if (!isObj(raw)) throw new Error('接线图文档无法识别:不是对象')
  if (raw.v !== SLD_DOC_VERSION)
    throw new Error(
      `接线图文档版本 ${JSON.stringify(raw.v) ?? '缺失'} 不支持(当前版本 ${SLD_DOC_VERSION}),请升级工具后再打开`
    )
  const canvas = isObj(raw.canvas) ? raw.canvas : {}
  const list = <T>(x: unknown): T[] => (Array.isArray(x) ? (x as T[]) : [])
  return {
    ...raw,
    v: SLD_DOC_VERSION,
    canvas: {
      ...canvas,
      w: typeof canvas.w === 'number' ? canvas.w : DEFAULT_CANVAS_W,
      h: typeof canvas.h === 'number' ? canvas.h : DEFAULT_CANVAS_H,
      grid: typeof canvas.grid === 'number' ? canvas.grid : SLD_GRID,
    },
    nodes: list(raw.nodes),
    buses: list(raw.buses),
    wires: list(raw.wires),
    labels: list(raw.labels),
  }
}

/** 新建空图 */
export function emptySldDoc(w = 1600, h = 900, grid = 10): SldDoc {
  return { v: 1, canvas: { w, h, grid }, nodes: [], buses: [], wires: [], labels: [] }
}
