/**
 * 图的结构校验(T5.1 实现)。
 *
 * 只看图本身:id、引用、栅格、母线方向、开关状态来源、电源点。`doc` ↔ `bindings` 的一致性
 * (图里引用的 `pt.*` 有没有绑定)不在这里,在部署工具 `editor/validate.ts`(ADR-005 D9)。
 * 输入按 unknown 对待(项目文件可能被手改坏):任何形状都不抛异常,只出 issue。
 */
import { busLength } from './geometry'
import { SLD_DOC_VERSION, SLD_GRID, SLD_ID_PATTERN } from './types'
import type { SldDoc, SldIssue, SldSymbolDefinition, SldSymbolLookup } from './types'

type Obj = Record<string, unknown>

const isObj = (x: unknown): x is Obj => !!x && typeof x === 'object' && !Array.isArray(x)
const arr = (x: unknown): unknown[] => (Array.isArray(x) ? x : [])
/** 落栅格:有限数且是 SLD_GRID 的整数倍(NaN / 非数字一律算不落) */
const onGrid = (v: unknown): boolean => typeof v === 'number' && Number.isFinite(v) && v % SLD_GRID === 0

/** 元素所在的数组名,也是 issue.path 的第一段 */
type Group = 'nodes' | 'buses' | 'wires' | 'labels' | 'frames'
const GROUP_TITLE: Record<Group, string> = {
  nodes: '节点',
  buses: '母线',
  wires: '连线',
  labels: '标签',
  frames: '分组框',
}

/**
 * 校验一张图,返回全部问题(error 挡发布,warning 只提示);没问题返回空数组。
 * - 不是对象 / `v` 不是当前版本:只返回一条 `bad-version`,后面的不再看(结构都不可信了)。
 * - `no-source` 只在图里有节点或母线时才报——空白新图不算问题。
 * - `off-grid` 查节点坐标、母线两端、连线拐点;标签与分组框是装饰,允许自由摆放。
 */
export function validateSldDoc(doc: unknown, symbols: SldSymbolLookup): SldIssue[] {
  if (!isObj(doc))
    return [{ level: 'error', path: '', code: 'bad-version', message: '接线图文档不是对象,无法识别版本' }]
  if (doc.v !== SLD_DOC_VERSION)
    return [
      {
        level: 'error',
        path: 'v',
        code: 'bad-version',
        message: `接线图文档版本 ${JSON.stringify(doc.v) ?? '缺失'} 不支持(当前版本 ${SLD_DOC_VERSION})`,
      },
    ]

  const issues: SldIssue[] = []
  const error = (path: string, code: SldIssue['code'], message: string): void => {
    issues.push({ level: 'error', path, code, message })
  }
  const warn = (path: string, code: SldIssue['code'], message: string): void => {
    issues.push({ level: 'warning', path, code, message })
  }

  const grid = isObj(doc.canvas) ? doc.canvas.grid : undefined
  if (grid !== SLD_GRID)
    error('canvas/grid', 'bad-grid', `栅格必须是 ${SLD_GRID}(v1 固定),现在是 ${JSON.stringify(grid) ?? '缺失'}`)

  /* ── 第一遍:id 字符集与重复(节点 / 母线 / 连线 / 标签 / 分组框共用一个名字空间) ── */
  const seen = new Map<string, string>()
  /** 返回元素的路径;元素不是对象或 id 不合规时也给一个能定位的路径(用下标) */
  const checkId = (group: Group, item: unknown, index: number): string => {
    const id = isObj(item) ? item.id : undefined
    if (typeof id !== 'string' || !SLD_ID_PATTERN.test(id)) {
      const path = `${group}/${typeof id === 'string' && id ? id : `#${index}`}`
      error(path, 'bad-id', `${GROUP_TITLE[group]} id ${JSON.stringify(id) ?? '缺失'} 不符合 ${SLD_ID_PATTERN.source}`)
      return path
    }
    const path = `${group}/${id}`
    const first = seen.get(id)
    if (first !== undefined) error(path, 'duplicate-id', `id "${id}" 重复(已用于 ${first})`)
    else seen.set(id, path)
    return path
  }
  const checkPt = (path: string, pt: unknown): void => {
    if (typeof pt !== 'string' || !SLD_ID_PATTERN.test(pt))
      error(path, 'bad-id', `测点 id ${JSON.stringify(pt) ?? '缺失'} 不符合 ${SLD_ID_PATTERN.source}`)
  }

  /* ── 节点 ── */
  const nodes = new Map<string, { node: Obj; def: SldSymbolDefinition | undefined }>()
  let hasSource = false
  arr(doc.nodes).forEach((item, i) => {
    const path = checkId('nodes', item, i)
    if (!isObj(item)) return
    const def = typeof item.symbol === 'string' ? symbols(item.symbol) : undefined
    if (typeof item.id === 'string' && !nodes.has(item.id)) nodes.set(item.id, { node: item, def })
    if (!def) error(`${path}/symbol`, 'unknown-symbol', `图元 ${JSON.stringify(item.symbol) ?? '缺失'} 不在图元库里`)
    if (!onGrid(item.x) || !onGrid(item.y))
      warn(path, 'off-grid', `节点坐标 (${String(item.x)}, ${String(item.y)}) 不落在 ${SLD_GRID} 的栅格上`)
    if (isObj(item.state)) checkPt(`${path}/state/pt`, item.state.pt)
    else if (def?.conduct === 'switch')
      warn(`${path}/state`, 'missing-state', '开关没有配状态来源(state),带电计算按常合处理')
    if (item.source) hasSource = true
  })

  /* ── 母线 ── */
  const buses = new Map<string, Obj>()
  arr(doc.buses).forEach((item, i) => {
    const path = checkId('buses', item, i)
    if (!isObj(item)) return
    if (typeof item.id === 'string' && !buses.has(item.id)) buses.set(item.id, item)
    if (![item.x1, item.y1, item.x2, item.y2].every(onGrid))
      warn(path, 'off-grid', `母线端点不落在 ${SLD_GRID} 的栅格上`)
    if (item.x1 !== item.x2 && item.y1 !== item.y2)
      error(path, 'bus-not-axis-aligned', '母线必须水平或垂直(x1 = x2 或 y1 = y2)')
  })

  /* ── 连线 ── */
  const checkEnd = (path: string, end: unknown): void => {
    if (isObj(end) && 'bus' in end) {
      const bus = typeof end.bus === 'string' ? buses.get(end.bus) : undefined
      if (!bus) return error(path, 'dangling-wire', `连线端点引用的母线 ${JSON.stringify(end.bus)} 不存在`)
      const len = busLength(bus as unknown as SldDoc['buses'][number])
      const d = end.d
      // 写成「不满足」的否定式,NaN / 非数字一并挡住
      if (!(typeof d === 'number' && d >= 0 && d <= len && d % SLD_GRID === 0))
        error(
          path,
          'bus-end-out-of-range',
          `母线接点 d = ${JSON.stringify(d) ?? '缺失'} 必须是 ${SLD_GRID} 的整数倍且在 [0, ${len}] 内`
        )
      return
    }
    if (isObj(end) && 'node' in end) {
      const hit = typeof end.node === 'string' ? nodes.get(end.node) : undefined
      if (!hit) return error(path, 'dangling-wire', `连线端点引用的节点 ${JSON.stringify(end.node)} 不存在`)
      // 图元未知时端口无从查起:unknown-symbol 已经报过,不重复报
      if (hit.def && !hit.def.ports.some(p => p.id === end.port))
        error(path, 'unknown-port', `图元 "${hit.def.id}" 没有端口 ${JSON.stringify(end.port) ?? '缺失'}`)
      return
    }
    error(path, 'dangling-wire', '连线端点既不是节点端口也不是母线接点')
  }
  arr(doc.wires).forEach((item, i) => {
    const path = checkId('wires', item, i)
    if (!isObj(item)) return
    checkEnd(`${path}/from`, item.from)
    checkEnd(`${path}/to`, item.to)
    const bad = arr(item.vertices).some(v => !Array.isArray(v) || !onGrid(v[0]) || !onGrid(v[1]))
    if (bad) warn(`${path}/vertices`, 'off-grid', `连线拐点不落在 ${SLD_GRID} 的栅格上`)
  })

  /* ── 标签 ── */
  arr(doc.labels).forEach((item, i) => {
    const path = checkId('labels', item, i)
    if (!isObj(item)) return
    if (item.kind === 'value') checkPt(`${path}/pt`, item.pt)
    if (item.attach !== undefined && !(typeof item.attach === 'string' && nodes.has(item.attach)))
      error(`${path}/attach`, 'unknown-point-owner', `标签依附的节点 ${JSON.stringify(item.attach)} 不存在`)
  })

  /* ── 分组框:纯装饰,只查 id ── */
  arr(doc.frames).forEach((item, i) => void checkId('frames', item, i))

  if (!hasSource && (arr(doc.nodes).length > 0 || arr(doc.buses).length > 0))
    warn('nodes', 'no-source', '图里没有电源点(source),带电着色会全部按失电画')

  return issues
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
