/** 复制间隔 ×N 并按设备名规律改绑(T5.1 实现)。 */
import type { Binding } from '../../schema/page-config'
import { busOffset, busPoint } from './geometry'
import { SLD_GRID, SLD_POINT_SLOT_PREFIX, sldPointSlot } from './types'
import type { SldDoc, SldSelection, SldWireEnd } from './types'

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

/** 图与绑定都是纯 JSON,用序列化做深拷贝(不依赖 structuredClone,宿主环境不挑) */
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T

/** 在 used 里占一个没用过的 id:先试「原 id + _ + 份号」,撞了就继续加 `_份号` 后缀 */
function claimId(used: Set<string>, id: string, index: number): string {
  let next = `${id}_${index}`
  while (used.has(next)) next += `_${index}`
  used.add(next)
  return next
}

/** 绑定改名:entity.name 走 rename、entity.id 置空(ext 绑定的实体在 params.entity);const 等没有实体的原样复制 */
function renameBinding(binding: Binding, rename: (name: string) => string): Binding {
  const out = clone(binding)
  const entity: unknown = out.mode === 'ext' ? out.params?.entity : out.mode === 'const' ? undefined : out.entity
  if (entity && typeof entity === 'object') {
    const ref = entity as { id?: unknown; name?: unknown }
    if (typeof ref.name === 'string') ref.name = rename(ref.name)
    ref.id = ''
  }
  return out
}

/**
 * 输入不改。选择集里的节点 / 连线 / 标签整体复制 count 份;连线另一端在选择集外的(通常是母线),
 * 新连线接到同一条母线上并按位移换算 d(越界则夹到母线两端)。所有新 id 保证在 doc 内唯一。
 *
 * 细则:
 * - 第 i 份(i 从 1 起)位移 (dx × i, dy × i);横排间隔给 dx、纵排(垂直母线 + 横向出线)给 dy。
 * - 新 id = 原 id + `_` + i,在节点 / 母线 / 连线 / 标签 / 分组框的共同名字空间里唯一;新元素追加在各数组末尾。
 * - 依附(attach)在选中节点上的标签即使没在 selection.labels 里也跟着复制(SldLabel.attach 的约定)。
 * - 选择集里的母线、分组框也复制并位移;连线接在选中母线上的,新连线接新母线、d 不变。
 * - 连线的节点端在选择集外的:新连线仍接原节点的同一端口(编辑器一般不会给出这种选择集)。
 * - 被复制的节点状态 / 数值标签引用的 pt 重新编号(原 pt + `_` + i,同一份里同一个旧 pt 只对应一个新 pt);
 *   `bindings['pt.<旧>']` 存在就复制成 `pt.<新>`(写成数组的取第一项),不存在则只改引用、不造绑定。
 * - rename 只作用到 node.name、node.entity.name、绑定的 entity.name;标签文字与分组框标题原样复制。
 * - count 不是正整数(0、负数、NaN)→ 返回原图的深拷贝,不新增任何东西;selection 里不存在的 id 忽略。
 */
export function duplicateBay(
  doc: SldDoc,
  bindings: Record<string, Binding | Binding[]>,
  selection: SldSelection,
  opts: DuplicateBayOptions
): DuplicateBayResult {
  const out = clone(doc)
  const result: DuplicateBayResult = { doc: out, bindings: {}, created: [] }
  const count = Number.isFinite(opts.count) ? Math.floor(opts.count) : 0
  if (count <= 0) return result

  const pickedNodes = new Set(selection.nodes)
  const pickedBuses = new Set(selection.buses)
  const pickedWires = new Set(selection.wires)
  const pickedLabels = new Set(selection.labels)
  const pickedFrames = new Set(selection.frames ?? [])

  // 原件清单从输入 doc 取(out 会边复制边变长)
  const srcNodes = doc.nodes.filter(n => pickedNodes.has(n.id))
  const srcBuses = doc.buses.filter(b => pickedBuses.has(b.id))
  const srcWires = doc.wires.filter(w => pickedWires.has(w.id))
  const srcLabels = doc.labels.filter(
    l => pickedLabels.has(l.id) || (l.attach !== undefined && pickedNodes.has(l.attach))
  )
  const srcFrames = (doc.frames ?? []).filter(f => pickedFrames.has(f.id))
  const busById = new Map(doc.buses.map(b => [b.id, b] as const))

  const usedIds = new Set<string>()
  for (const list of [doc.nodes, doc.buses, doc.wires, doc.labels, doc.frames ?? []])
    for (const x of list) usedIds.add(x.id)
  const usedPts = new Set<string>()
  for (const n of doc.nodes) {
    if (n.state) usedPts.add(n.state.pt)
    if (n.online) usedPts.add(n.online.pt)
  }
  for (const l of doc.labels) if (l.kind === 'value' || l.kind === 'status') usedPts.add(l.pt)
  for (const slot of Object.keys(bindings))
    if (slot.startsWith(SLD_POINT_SLOT_PREFIX)) usedPts.add(slot.slice(SLD_POINT_SLOT_PREFIX.length))

  for (let i = 1; i <= count; i++) {
    const sx = opts.dx * i
    const sy = opts.dy * i
    const rename = (name: string): string => opts.rename(name, i)
    const created = { nodes: [], buses: [], wires: [], labels: [], frames: [] } as Required<SldSelection>
    const nodeIds = new Map<string, string>()
    const busIds = new Map<string, string>()
    const ptIds = new Map<string, string>()

    /** 旧 pt → 本份的新 pt;第一次遇到时顺带复制绑定 */
    const mapPt = (pt: string): string => {
      const known = ptIds.get(pt)
      if (known !== undefined) return known
      const next = claimId(usedPts, pt, i)
      ptIds.set(pt, next)
      const slot = sldPointSlot(pt)
      const bound = Object.prototype.hasOwnProperty.call(bindings, slot) ? bindings[slot] : undefined
      const one = Array.isArray(bound) ? bound[0] : bound
      if (one) result.bindings[sldPointSlot(next)] = renameBinding(one, rename)
      return next
    }

    for (const src of srcNodes) {
      const node = clone(src)
      node.id = claimId(usedIds, src.id, i)
      nodeIds.set(src.id, node.id)
      node.x += sx
      node.y += sy
      if (node.name !== undefined) node.name = rename(node.name)
      if (node.entity) node.entity.name = rename(node.entity.name)
      if (node.state) node.state.pt = mapPt(node.state.pt)
      if (node.online) node.online.pt = mapPt(node.online.pt)
      out.nodes.push(node)
      created.nodes.push(node.id)
    }

    for (const src of srcBuses) {
      const bus = clone(src)
      bus.id = claimId(usedIds, src.id, i)
      busIds.set(src.id, bus.id)
      bus.x1 += sx
      bus.y1 += sy
      bus.x2 += sx
      bus.y2 += sy
      out.buses.push(bus)
      created.buses.push(bus.id)
    }

    const mapEnd = (end: SldWireEnd): SldWireEnd => {
      if ('bus' in end) {
        const copied = busIds.get(end.bus)
        if (copied !== undefined) return { bus: copied, d: end.d }
        const bus = busById.get(end.bus)
        if (!bus) return { ...end } // 悬空端:原样带过去,validateSldDoc 会报
        // 接点按位移平移后投影回母线:沿母线方向的分量换算成 d(吸附栅格、夹到 [0, 母线长]),垂直分量不影响 d
        const p = busPoint(bus, end.d)
        return { bus: end.bus, d: busOffset(bus, { x: p.x + sx, y: p.y + sy }, SLD_GRID) }
      }
      return { node: nodeIds.get(end.node) ?? end.node, port: end.port }
    }
    for (const src of srcWires) {
      const wire = clone(src)
      wire.id = claimId(usedIds, src.id, i)
      wire.from = mapEnd(src.from)
      wire.to = mapEnd(src.to)
      if (wire.vertices) wire.vertices = wire.vertices.map(([x, y]) => [x + sx, y + sy])
      out.wires.push(wire)
      created.wires.push(wire.id)
    }

    for (const src of srcLabels) {
      const label = clone(src)
      label.id = claimId(usedIds, src.id, i)
      label.x += sx
      label.y += sy
      if (label.attach !== undefined) label.attach = nodeIds.get(label.attach) ?? label.attach
      if (label.kind === 'value' || label.kind === 'status') label.pt = mapPt(label.pt)
      out.labels.push(label)
      created.labels.push(label.id)
    }

    for (const src of srcFrames) {
      const frame = clone(src)
      frame.id = claimId(usedIds, src.id, i)
      frame.x += sx
      frame.y += sy
      ;(out.frames ??= []).push(frame)
      created.frames.push(frame.id)
    }

    result.created.push(created)
  }
  return result
}

/**
 * 常用改名规律:把名字里最后一段数字 +index(`PDR1_LP1_IED1` 的哪一段由 segment 指定,缺省最后一段)。
 *
 * 「段」指名字里连续的一串数字,从左往右数、从 0 起:`PDR1_LP1_IED1` 的 0 / 1 / 2 段分别是 PDR、LP、IED 后面的 1;
 * 负数从右往左数(-1 = 最后一段 = 缺省)。名字里没有数字、或 segment 越界 → 原样返回。
 * 补零宽度保持:`LP01` → `LP02`,`LP09` → `LP10`,进位超出宽度时自然变长(`LP99` → `LP100`)。
 */
export function incrementName(name: string, index: number, segment?: number): string {
  const runs = [...name.matchAll(/\d+/g)]
  const at = segment === undefined ? runs.length - 1 : segment < 0 ? runs.length + segment : segment
  const run = runs[at]
  if (!run) return name
  const digits = run[0]
  const value = Number(digits) + index
  if (!Number.isSafeInteger(value) || value < 0) return name
  const start = run.index ?? 0
  return name.slice(0, start) + String(value).padStart(digits.length, '0') + name.slice(start + digits.length)
}
