/**
 * 「问题」面板的纯逻辑(T5.7):图的结构校验(model 的 validateSldDoc)+「图 ↔ 绑定」一致性检查。
 *
 * 为什么不直接复用 `editor/validate.ts` 的 validateSldWidget:
 * - 它面向 WidgetConfig,产出的 path 是发布报告用的 JSON Pointer(`/widgets/<id>/props/doc/...`、`.../bindings/pt.x`),
 *   面板要的是图内路径(`nodes/n3`)好定位选中,还要「多余绑定」的槽位清单给一键清理——套一层假 WidgetConfig 再剥前缀,
 *   等于依赖对方的路径格式与文案细节;
 * - T5.8 正在同一波次里改 `src/editor/**`,import 一个正在变的模块会让两边互相牵制。
 * 所以这里自写,判定语义与 validateSldWidget 保持一致(绑定「存在」= 非空;数组形式看长度)。
 */
import {
  SLD_POINT_SLOT_PREFIX,
  collectPointRefs,
  lookupSldSymbol,
  sldPointSlot,
  validateSldDoc,
  type Binding,
  type SldDoc,
  type SldIssue,
  type SldSelection,
  type SldSymbolLookup,
} from '@grid/scada-renderer'
import type { SldEditorContent } from '../../ext'

export type PanelIssueCode = SldIssue['code'] | 'unbound-point' | 'unused-binding' | 'entity-without-points'

export interface PanelIssue {
  level: 'error' | 'warning'
  code: PanelIssueCode
  /** 图内路径,如 `nodes/n3`、`wires/w7/from`;绑定问题是 `bindings/pt.p9` */
  path: string
  message: string
  /** 绑定问题的槽位名 */
  slot?: string
}

export interface IssueReport {
  issues: PanelIssue[]
  errors: number
  warnings: number
  /** 没人引用的 `pt.*` 槽位(「清理多余绑定」删这些) */
  unusedSlots: string[]
}

const bound = (v: Binding | Binding[] | undefined): boolean => (Array.isArray(v) ? v.length > 0 : !!v)

function ownerText(doc: SldDoc, from: 'state' | 'label', owner: string): string {
  if (from === 'state') {
    const n = doc.nodes.find(x => x.id === owner)
    return `节点 ${owner}${n?.name ? `(${n.name})` : ''}的开关状态`
  }
  const l = doc.labels.find(x => x.id === owner)
  const title = l?.kind === 'value' ? l.title : undefined
  return `数值标签 ${owner}${title ? `(${title})` : ''}`
}

/** 没人引用的 `pt.*` 槽位 */
export function unusedPointSlots(content: SldEditorContent): string[] {
  const used = new Set(collectPointRefs(content.doc).map(r => sldPointSlot(r.pt)))
  return Object.keys(content.bindings ?? {}).filter(k => k.startsWith(SLD_POINT_SLOT_PREFIX) && !used.has(k))
}

/** 三类「图 ↔ 绑定」检查 */
export function checkBindings(content: SldEditorContent): PanelIssue[] {
  const { doc } = content
  const bindings = (content.bindings ?? {}) as Record<string, Binding | Binding[] | undefined>
  const issues: PanelIssue[] = []

  // ① 图里引用了、绑定里没有 → error(同一个 pt 被多处引用,每处各报一条,点哪条定位到哪个元素)
  for (const r of collectPointRefs(doc)) {
    const slot = sldPointSlot(r.pt)
    if (bound(bindings[slot])) continue
    issues.push({
      level: 'error',
      code: 'unbound-point',
      path: r.from === 'state' ? `nodes/${r.owner}/state/pt` : `labels/${r.owner}/pt`,
      slot,
      message: `${ownerText(doc, r.from, r.owner)}引用了测点「${r.pt}」,但还没有绑定`,
    })
  }

  // ② 绑定了、图里没人引用 → warning
  for (const slot of unusedPointSlots(content))
    issues.push({
      level: 'warning',
      code: 'unused-binding',
      path: `bindings/${slot}`,
      slot,
      message: `多余的测点绑定「${slot}」:图里没有节点 / 标签引用它,发布后仍会订阅`,
    })

  // ③ 有 entity 的节点,名下(开关状态 + 依附它的数值标签)没有任何已绑定的测点 → warning
  for (const n of doc.nodes) {
    if (!n.entity) continue
    const pts = [
      ...(n.state ? [n.state.pt] : []),
      ...doc.labels.flatMap(l => (l.kind === 'value' && l.attach === n.id ? [l.pt] : [])),
    ]
    if (pts.some(pt => bound(bindings[sldPointSlot(pt)]))) continue
    issues.push({
      level: 'warning',
      code: 'entity-without-points',
      path: `nodes/${n.id}`,
      message: `节点 ${n.id}${n.name ? `(${n.name})` : ''}写了设备「${n.entity.name}」,但名下没有已绑定的测点;运行时取不到它的实体 id,告警匹配与点击事件对它无效`,
    })
  }
  return issues
}

/** 全部问题:结构校验在前、绑定检查在后;error 在 warning 前(各自保持原顺序) */
export function checkContent(content: SldEditorContent, symbols: SldSymbolLookup = lookupSldSymbol): IssueReport {
  let structural: SldIssue[] = []
  try {
    structural = validateSldDoc(content.doc, symbols)
  } catch {
    structural = []
  }
  const all: PanelIssue[] = [...structural.map(i => ({ ...i })), ...checkBindings(content)]
  const issues = [...all.filter(i => i.level === 'error'), ...all.filter(i => i.level === 'warning')]
  const errors = issues.filter(i => i.level === 'error').length
  return { issues, errors, warnings: issues.length - errors, unusedSlots: unusedPointSlots(content) }
}

const GROUPS = ['nodes', 'buses', 'wires', 'labels', 'frames'] as const
type Group = (typeof GROUPS)[number]

/**
 * issue.path → 选择集:取前两段 `<组>/<id>`(`wires/w7/from` → 选中连线 w7)。
 * 定位不到具体元素的(`canvas/grid`、`nodes`、`bindings/pt.x`、`nodes/#3` 这种按下标的、元素已不在图里的)返回 undefined。
 */
export function pathToSelection(path: string, doc?: SldDoc): Partial<SldSelection> | undefined {
  const [group, id] = path.replace(/^\/+/, '').split('/')
  if (!group || !id || id.startsWith('#') || !(GROUPS as readonly string[]).includes(group)) return undefined
  const g = group as Group
  if (doc && !(g === 'frames' ? (doc.frames ?? []) : doc[g]).some(x => x.id === id)) return undefined
  return { [g]: [id] }
}

/** 删掉没人引用的 `pt.*`;返回删了几个 */
export function removeUnusedBindings(draft: SldEditorContent): number {
  const slots = unusedPointSlots(draft)
  for (const s of slots) delete draft.bindings[s]
  return slots.length
}
