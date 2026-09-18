/** 几何:端口坐标、母线取点、连线折线(T5.0 实现;运行时与编辑器共用)。 */
import type {
  SldBus,
  SldDoc,
  SldNode,
  SldPoint,
  SldPortDir,
  SldSymbolDefinition,
  SldSymbolLookup,
  SldWire,
} from './types'

/** 端口在画布上的坐标:先按 node.flip 水平镜像,再绕包围盒中心旋转 node.rot(顺时针),再平移到 node.x / node.y。 */
export function portPosition(_node: SldNode, _def: SldSymbolDefinition, _portId: string): SldPoint | undefined {
  throw new Error('portPosition: 未实现(T5.0)')
}

/** 端口出线朝向(镜像 + 旋转之后) */
export function portDirection(_node: SldNode, _def: SldSymbolDefinition, _portId: string): SldPortDir | undefined {
  throw new Error('portDirection: 未实现(T5.0)')
}

/** 节点旋转后的包围盒(画布坐标) */
export function nodeBox(_node: SldNode, _def: SldSymbolDefinition): { x: number; y: number; w: number; h: number } {
  throw new Error('nodeBox: 未实现(T5.0)')
}

/** 母线上参数 t ∈ [0,1] 处的点 */
export function busPoint(_bus: SldBus, _t: number): SldPoint {
  throw new Error('busPoint: 未实现(T5.0)')
}

/** 离 p 最近的母线参数 t(夹到 [0,1]) */
export function busParam(_bus: SldBus, _p: SldPoint): number {
  throw new Error('busParam: 未实现(T5.0)')
}

/**
 * 连线的完整折线点列(含两端)。有 vertices 用 vertices;没有则按端口朝向给一条正交折线(L 形或 Z 形)。
 * 端点引用的节点 / 端口 / 母线不存在时返回 undefined(悬空线,由 validateSldDoc 报)。
 */
export function wirePoints(_doc: SldDoc, _wire: SldWire, _symbols: SldSymbolLookup): SldPoint[] | undefined {
  throw new Error('wirePoints: 未实现(T5.0)')
}
