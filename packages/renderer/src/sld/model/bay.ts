/** 复制间隔 ×N 并按设备名规律改绑(T5.1 实现)。 */
import type { Binding } from '../../schema/page-config'
import type { SldDoc, SldSelection } from './types'

export interface DuplicateBayOptions {
  /** 复制份数(不含原件) */
  count: number
  /** 每份相对上一份的位移 */
  dx: number
  dy: number
  /** 第 index 份(从 1 起)的新名字;用于 node.name、node.entity.name 与绑定里的 entity.name */
  rename: (name: string, index: number) => string
}

export interface DuplicateBayResult {
  doc: SldDoc
  /** 新增的测点绑定(`pt.<新 pointId>` → Binding);entity.id 置空串,留给工具按名解析(ADR-002) */
  bindings: Record<string, Binding>
  /** 每一份新建元素的 id */
  created: SldSelection[]
}

/**
 * 输入不改。选择集里的节点 / 连线 / 标签整体复制 count 份;连线另一端在选择集外的(通常是母线),
 * 新连线接到同一条母线上并按位移换算 d(越界则夹到母线两端)。所有新 id 保证在 doc 内唯一。
 */
export function duplicateBay(
  _doc: SldDoc,
  _bindings: Record<string, Binding | Binding[]>,
  _selection: SldSelection,
  _opts: DuplicateBayOptions
): DuplicateBayResult {
  throw new Error('duplicateBay: 未实现(T5.1)')
}

/** 常用改名规律:把名字里最后一段数字 +index(`PDR1_LP1_IED1` 的哪一段由 segment 指定,缺省最后一段) */
export function incrementName(_name: string, _index: number, _segment?: number): string {
  throw new Error('incrementName: 未实现(T5.1)')
}
