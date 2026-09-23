/**
 * 连通图与带电计算(T5.1 实现)。
 *
 * 图的顶点 = 每个「节点端口」+ 每条「母线」(母线上所有接点互通,所以整条母线只算一个顶点);
 * 边 = 连线(两端顶点连通)+ 图元内部的端口对(是否导通在传播时按 conduct / 开关状态判)
 *    + 搭在一起的两条母线(一条的端头落在另一条上,见 busesTouch;2026-09-20)
 *    + 端口压在母线上的图元(端口坐标正好落在母线线段上,不用再画连线;2026-09-23 现场反馈)。
 * 容错:悬空线、未知图元、未知端口都不抛异常——悬空的一端不建边,未知图元按 conduct = 'none' 处理。
 */
import type {
  SldBus,
  SldConduct,
  SldDoc,
  SldEnergizeResult,
  SldEnergy,
  SldSwitchState,
  SldSymbolLookup,
  SldWireEnd,
} from './types'
import { portPosition } from './geometry'

/** 连通图的顶点:节点端口,或一整条母线 */
export type SldGraphVertex = { kind: 'port'; node: string; port: string } | { kind: 'bus'; bus: string }

/**
 * 连通图的边(无向,a / b 是 vertices 的下标):
 * - wire:一条连线,恒通;
 * - node:同一个图元内部的一对端口,通不通由 conduct 决定('none' 的图元不建内部边)。
 */
export type SldGraphEdge =
  | { a: number; b: number; kind: 'wire'; wire: string }
  | { a: number; b: number; kind: 'node'; node: string; conduct: SldConduct }
  /** 两条母线搭在一起(一条的端头落在另一条上,T 形 / L 形),恒通;十字交叉不算(没有端头落在对方身上) */
  | { a: number; b: number; kind: 'joint' }
  /** 图元端口直接压在母线上(2026-09-23),恒通,等同一根零长度的连线 */
  | { a: number; b: number; kind: 'attach'; node: string; port: string; bus: string }

/**
 * 连通图(中间结构,energize 用;将来拓扑着色 / 找回路 / 「这条线挂在哪段母线上」也可以复用)。
 * 全部用下标互相引用:`adjacency[v]` 是顶点 v 关联的边在 `edges` 里的下标。
 */
export interface SldGraph {
  vertices: SldGraphVertex[]
  edges: SldGraphEdge[]
  adjacency: number[][]
  /** 节点 id → 它的端口顶点下标(图元定义的端口 + 连线引用到的未知端口) */
  nodePorts: Map<string, number[]>
  /** 母线 id → 顶点下标 */
  busVertex: Map<string, number>
  /** 连线 id → 能解析出来的端点顶点下标(0–2 个;悬空的一端不在里面) */
  wireEnds: Map<string, number[]>
}

/** 点 (x, y) 是否落在母线这条线段上(含两端);母线约定水平或垂直,斜的不判 */
export function onBus(bus: SldBus, x: number, y: number): boolean {
  if (bus.y1 === bus.y2) return y === bus.y1 && x >= Math.min(bus.x1, bus.x2) && x <= Math.max(bus.x1, bus.x2)
  if (bus.x1 === bus.x2) return x === bus.x1 && y >= Math.min(bus.y1, bus.y2) && y <= Math.max(bus.y1, bus.y2)
  return false
}

/** 两条母线是否搭在一起:任一条的某个端头落在另一条上(T 形、L 形、首尾相接);十字交叉不算 */
export function busesTouch(p: SldBus, q: SldBus): boolean {
  return onBus(q, p.x1, p.y1) || onBus(q, p.x2, p.y2) || onBus(p, q.x1, q.y1) || onBus(p, q.x2, q.y2)
}

/** 按 doc 建连通图;不看开关状态(状态只影响传播,不影响图的形状),同一张图状态变化时可以复用 */
export function buildSldGraph(doc: SldDoc, symbols: SldSymbolLookup): SldGraph {
  const vertices: SldGraphVertex[] = []
  const edges: SldGraphEdge[] = []
  const adjacency: number[][] = []
  const nodePorts = new Map<string, number[]>()
  const busVertex = new Map<string, number>()
  const wireEnds = new Map<string, number[]>()
  /** 节点 id → 端口 id → 顶点下标 */
  const portVertex = new Map<string, Map<string, number>>()

  const addVertex = (v: SldGraphVertex): number => {
    vertices.push(v)
    adjacency.push([])
    return vertices.length - 1
  }
  const addEdge = (e: SldGraphEdge): void => {
    edges.push(e)
    adjacency[e.a]?.push(edges.length - 1)
    adjacency[e.b]?.push(edges.length - 1)
  }
  /** 取(没有就建)节点端口的顶点;节点不存在返回 undefined */
  const portOf = (nodeId: string, portId: string): number | undefined => {
    const ports = portVertex.get(nodeId)
    if (!ports) return undefined
    let v = ports.get(portId)
    if (v === undefined) {
      v = addVertex({ kind: 'port', node: nodeId, port: portId })
      ports.set(portId, v)
      nodePorts.get(nodeId)?.push(v)
    }
    return v
  }

  for (const node of doc.nodes) {
    if (portVertex.has(node.id)) continue // 重复 id(validateSldDoc 会报):只认第一个
    portVertex.set(node.id, new Map())
    nodePorts.set(node.id, [])
    const def = symbols(node.symbol)
    if (!def) continue
    const ports = def.ports.map(p => portOf(node.id, p.id)).filter((v): v is number => v !== undefined)
    if (def.conduct === 'none') continue
    for (let i = 0; i < ports.length; i++)
      for (let j = i + 1; j < ports.length; j++) {
        const a = ports[i]
        const b = ports[j]
        if (a !== undefined && b !== undefined && a !== b)
          addEdge({ a, b, kind: 'node', node: node.id, conduct: def.conduct })
      }
  }
  for (const bus of doc.buses)
    if (!busVertex.has(bus.id)) busVertex.set(bus.id, addVertex({ kind: 'bus', bus: bus.id }))
  // 母线搭母线(2026-09-20):画图的人把竖母线的头顶在横母线上,就是要它们连通,不该再逼他补一根零长度的线
  for (let i = 0; i < doc.buses.length; i++)
    for (let j = i + 1; j < doc.buses.length; j++) {
      const p = doc.buses[i]
      const q = doc.buses[j]
      if (!p || !q || !busesTouch(p, q)) continue
      const a = busVertex.get(p.id)
      const b = busVertex.get(q.id)
      if (a !== undefined && b !== undefined && a !== b) addEdge({ a, b, kind: 'joint' })
    }

  // 端口压在母线上(2026-09-23):开关 / 电表拖到母线上、端口正好落在母线上,就是要它连上,不该再逼人补一根线
  for (const node of doc.nodes) {
    const def = symbols(node.symbol)
    if (!def || !def.ports.length) continue
    for (const p of def.ports) {
      const at = portPosition(node, def, p.id)
      if (!at) continue
      for (const bus of doc.buses) {
        if (!onBus(bus, at.x, at.y)) continue
        const a = portOf(node.id, p.id)
        const b = busVertex.get(bus.id)
        if (a !== undefined && b !== undefined)
          addEdge({ a, b, kind: 'attach', node: node.id, port: p.id, bus: bus.id })
      }
    }
  }

  const endVertex = (end: SldWireEnd): number | undefined =>
    'bus' in end ? busVertex.get(end.bus) : portOf(end.node, end.port)
  for (const wire of doc.wires) {
    if (wireEnds.has(wire.id)) continue
    const a = endVertex(wire.from)
    const b = endVertex(wire.to)
    wireEnds.set(
      wire.id,
      [a, b].filter((v): v is number => v !== undefined)
    )
    if (a !== undefined && b !== undefined && a !== b) addEdge({ a, b, kind: 'wire', wire: wire.id })
  }
  return { vertices, edges, adjacency, nodePorts, busVertex, wireEnds }
}

/** 一次传播的结果:到达过的顶点 → 到达时的电压等级(undefined = 带电但等级未知) */
type Reached = Map<number, number | undefined>

/** kv 没有就不带这个字段(结果里不留 `kv: undefined`) */
const kvField = (kv: number | undefined): { kv?: number } => (kv === undefined ? {} : { kv })

/**
 * 从电源点(node.source)出发,沿连线 / 母线 / 导通的图元传播。
 * - conduct = 'switch' 的节点按 states[node.id] 判断;没配 node.state 的开关视为常合(与 resolveSwitchState 一致),
 *   配了 state 但 states 里没给、或给了 unknown 的按断开算,并把它后面本可带电的部分标 uncertain。
 * - conduct = 'transformer' 穿过后电压等级换成 node.portKv[出口端口](没配则等级未知)。
 * - conduct = 'none' 不向外传,但图元自身在任一端口带电时算带电(其余图元同理:任一端口带电即带电)。
 * - 母线自己给了 kv 的,以母线的为准,从它继续往下传的也是母线的等级。
 * 返回每个节点 / 母线 / 连线的带电情况(每个元素都有条目);图里没有电源点时全部 live = false。
 *
 * 做法:传播两遍。第一遍 unknown 开关按断开 → 到达的是「确定带电」;第二遍 unknown 开关按合上 →
 * 多到达的那部分就是「本可带电但不确定」,记 `{ live: false, uncertain: true }`(kv 照给,便于运行时选色)。
 * 任一路确定带电的元素一定在第一遍里,所以多电源时「确定」天然压过「不确定」。
 * 每个顶点最多入队两次(第二次只发生在「先到的一路等级未知、后到的一路有等级」时),环网不会死循环。
 * 多个电源等级不同又连通时,取先到的(按 doc.nodes 顺序的广度优先),不做冲突判断。
 */
export function energize(
  doc: SldDoc,
  symbols: SldSymbolLookup,
  states: Record<string, SldSwitchState>
): SldEnergizeResult {
  const graph = buildSldGraph(doc, symbols)
  const nodeById = new Map(doc.nodes.map(n => [n.id, n] as const).reverse()) // reverse:重复 id 时第一个生效
  const busById = new Map(doc.buses.map(b => [b.id, b] as const).reverse())

  const switchState = (nodeId: string): SldSwitchState => {
    const given = Object.prototype.hasOwnProperty.call(states, nodeId) ? states[nodeId] : undefined
    return given ?? (nodeById.get(nodeId)?.state ? 'unknown' : 'closed')
  }

  const propagate = (unknownAsClosed: boolean): Reached => {
    const reached: Reached = new Map()
    const queue: number[] = []
    const visit = (v: number, kvIn: number | undefined): void => {
      const vertex = graph.vertices[v]
      if (!vertex) return
      const kv = vertex.kind === 'bus' ? (busById.get(vertex.bus)?.kv ?? kvIn) : kvIn
      if (reached.has(v) && !(reached.get(v) === undefined && kv !== undefined)) return
      reached.set(v, kv)
      queue.push(v)
    }
    for (const node of doc.nodes)
      if (node.source && nodeById.get(node.id) === node)
        for (const v of graph.nodePorts.get(node.id) ?? []) visit(v, node.source.kv)

    for (let head = 0; head < queue.length; head++) {
      const v = queue[head]
      if (v === undefined) continue
      const kv = reached.get(v)
      for (const ei of graph.adjacency[v] ?? []) {
        const e = graph.edges[ei]
        if (!e) continue
        const other = e.a === v ? e.b : e.a
        if (e.kind === 'wire' || e.kind === 'joint' || e.kind === 'attach' || e.conduct === 'always') visit(other, kv)
        else if (e.conduct === 'switch') {
          const s = switchState(e.node)
          if (s === 'closed' || (s === 'unknown' && unknownAsClosed)) visit(other, kv)
        } else if (e.conduct === 'transformer') {
          const out = graph.vertices[other]
          visit(other, out?.kind === 'port' ? nodeById.get(e.node)?.portKv?.[out.port] : undefined)
        }
      }
    }
    return reached
  }

  const certain = propagate(false)
  const possible = propagate(true)

  /** 一组顶点合成一个元素的带电情况:任一确定带电 → live;否则任一「本可带电」→ uncertain;否则失电 */
  const energyOf = (vs: number[]): SldEnergy => {
    const withKv = (reached: Reached, base: SldEnergy): SldEnergy | undefined => {
      const hit = vs.filter(v => reached.has(v))
      if (!hit.length) return undefined
      const kv = hit.map(v => reached.get(v)).find(k => k !== undefined)
      return kv === undefined ? base : { ...base, kv }
    }
    return withKv(certain, { live: true }) ?? withKv(possible, { live: false, uncertain: true }) ?? { live: false }
  }

  const result: SldEnergizeResult = { nodes: {}, buses: {}, wires: {} }
  for (const node of doc.nodes) {
    if (nodeById.get(node.id) !== node) continue
    const e = energyOf(graph.nodePorts.get(node.id) ?? [])
    // 电源点自己一定带电(哪怕图元一个端口都没有)
    result.nodes[node.id] = node.source && !e.live ? { live: true, ...kvField(node.source.kv) } : e
  }
  for (const bus of doc.buses) {
    const v = graph.busVertex.get(bus.id)
    result.buses[bus.id] = energyOf(v === undefined ? [] : [v])
  }
  for (const wire of doc.wires) result.wires[wire.id] = energyOf(graph.wireEnds.get(wire.id) ?? [])
  return result
}
