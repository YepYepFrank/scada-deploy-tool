/**
 * 接线图编辑器的文档状态机(T5.5)。
 *
 * 图的真相是 `SldEditorContent`(SldDoc + pt.* 绑定),X6 只是画布:撤销 / 重做撤的是**文档**,不用 X6 的 History 插件。
 * - `content` 是 shallowRef,每次 apply / 撤销 / 重做都整体换成新对象(快照不可变,撤销栈里直接存引用);
 * - `apply(recipe, label)`:深拷贝草稿 → recipe 改 → 校验,**新冒出来的** error 级问题则整笔回滚并提示;
 * - 撤销栈上限 100;
 * - `newId(kind)`:计数器只增不减,同一个 recipe 里连续取号、撤销之后再取号都不会撞。
 *
 * 无 X6、无 DOM,可单测。
 */
import { computed, ref, shallowRef, type ComputedRef, type Ref, type ShallowRef } from 'vue'
import {
  SLD_POINT_SLOT_PREFIX,
  lookupSldSymbol,
  validateSldDoc,
  type SldDoc,
  type SldIssue,
  type SldSelection,
} from '@grid/scada-renderer'
import type { SldEditorContent, SldRecipe } from './ext'

export type SldIdKind = 'n' | 'b' | 'w' | 'l' | 'f' | 'p'
export type SldChangeReason = 'apply' | 'undo' | 'redo' | 'reset'

export interface SldStoreOptions {
  /** 结构校验;缺省调 model 的 validateSldDoc(基线上它还是会 throw 的桩:抛了视为没有 error) */
  validate?: (doc: SldDoc) => SldIssue[]
  /** 撤销栈上限,缺省 100 */
  limit?: number
}

export interface SldStore {
  readonly content: Readonly<ShallowRef<SldEditorContent>>
  readonly selection: Readonly<ShallowRef<SldSelection>>
  /** 最近一条提示(回滚原因等);空串 = 没有 */
  readonly notice: Ref<string>
  readonly canUndo: ComputedRef<boolean>
  readonly canRedo: ComputedRef<boolean>
  /** 下一步撤销 / 重做的是什么(工具栏提示用) */
  readonly undoLabel: ComputedRef<string | undefined>
  readonly redoLabel: ComputedRef<string | undefined>
  /** 返回 true = 已提交;false = recipe 放弃 / 没有变化 / 校验回滚 */
  apply(recipe: SldRecipe, label?: string): boolean
  undo(): boolean
  redo(): boolean
  /** 宿主换了一份内容(导入 JSON、切换组件):清空撤销栈与选择集 */
  reset(content: SldEditorContent): void
  select(sel: Partial<SldSelection>): void
  newId(kind: SldIdKind): string
  /** 内容变化后**同步**回调(在 content 已换新之后);返回取消订阅函数 */
  onChange(cb: (content: SldEditorContent, reason: SldChangeReason) => void): () => void
}

interface HistoryEntry {
  content: SldEditorContent
  label: string
}

export const emptySelection = (): SldSelection => ({ nodes: [], buses: [], wires: [], labels: [], frames: [] })

/** 文档是纯 JSON:JSON 往返就是深拷贝,还顺手剥掉宿主可能传进来的 Vue 响应式代理 */
export const cloneContent = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T

function defaultValidate(doc: SldDoc): SldIssue[] {
  try {
    return validateSldDoc(doc, lookupSldSymbol)
  } catch {
    return []
  }
}

const issueKey = (i: SldIssue): string => `${i.code}@${i.path}`
const errorsOf = (issues: SldIssue[]): SldIssue[] => issues.filter(i => i.level === 'error')

/** 图内已用的全部元素 id(节点 / 母线 / 连线 / 标签 / 分组框) */
export function usedElementIds(doc: SldDoc): Set<string> {
  const ids = new Set<string>()
  for (const list of [doc.nodes, doc.buses, doc.wires, doc.labels, doc.frames ?? []])
    for (const x of list) ids.add(x.id)
  return ids
}

/** 已用的测点 id:绑定里的 `pt.<id>` + 图里引用到的 */
export function usedPointIds(content: SldEditorContent): Set<string> {
  const ids = new Set<string>()
  for (const k of Object.keys(content.bindings ?? {}))
    if (k.startsWith(SLD_POINT_SLOT_PREFIX)) ids.add(k.slice(SLD_POINT_SLOT_PREFIX.length))
  for (const n of content.doc.nodes) if (n.state) ids.add(n.state.pt)
  for (const l of content.doc.labels) if (l.kind === 'value') ids.add(l.pt)
  return ids
}

/** 选择集里已经不存在的 id 去掉 */
export function pruneSelection(doc: SldDoc, sel: SldSelection): SldSelection {
  const keep = (ids: string[] | undefined, list: Array<{ id: string }>): string[] => {
    const have = new Set(list.map(x => x.id))
    return (ids ?? []).filter(id => have.has(id))
  }
  return {
    nodes: keep(sel.nodes, doc.nodes),
    buses: keep(sel.buses, doc.buses),
    wires: keep(sel.wires, doc.wires),
    labels: keep(sel.labels, doc.labels),
    frames: keep(sel.frames, doc.frames ?? []),
  }
}

export const selectionSize = (sel: SldSelection): number =>
  sel.nodes.length + sel.buses.length + sel.wires.length + sel.labels.length + (sel.frames?.length ?? 0)

const sameIds = (a: string[] | undefined, b: string[] | undefined): boolean => {
  const x = a ?? []
  const y = b ?? []
  return x.length === y.length && x.every((id, i) => id === y[i])
}
export const sameSelection = (a: SldSelection, b: SldSelection): boolean =>
  sameIds(a.nodes, b.nodes) &&
  sameIds(a.buses, b.buses) &&
  sameIds(a.wires, b.wires) &&
  sameIds(a.labels, b.labels) &&
  sameIds(a.frames, b.frames)

export function createSldStore(initial: SldEditorContent, opts: SldStoreOptions = {}): SldStore {
  const validate = opts.validate ?? defaultValidate
  const limit = opts.limit ?? 100

  const content = shallowRef<SldEditorContent>(cloneContent(initial))
  const selection = shallowRef<SldSelection>(emptySelection())
  const notice = ref('')
  const past = shallowRef<HistoryEntry[]>([])
  const future = shallowRef<HistoryEntry[]>([])
  const counters: Partial<Record<SldIdKind, number>> = {}
  const listeners = new Set<(content: SldEditorContent, reason: SldChangeReason) => void>()

  function commit(next: SldEditorContent, reason: SldChangeReason): void {
    content.value = next
    const pruned = pruneSelection(next.doc, selection.value)
    if (!sameSelection(pruned, selection.value)) selection.value = pruned
    for (const cb of listeners) cb(next, reason)
  }

  function apply(recipe: SldRecipe, label = '修改'): boolean {
    const before = content.value
    const draft = cloneContent(before)
    if (recipe(draft) === false) return false
    if (JSON.stringify(draft) === JSON.stringify(before)) return false
    // 只拦「这一笔新带来的」error:导入的旧图本身带 error 时,不能让用户连改都改不了
    const known = new Set(errorsOf(validate(before.doc)).map(issueKey))
    const fresh = errorsOf(validate(draft.doc)).filter(i => !known.has(issueKey(i)))
    if (fresh.length) {
      notice.value = `「${label}」已回滚:${fresh[0]!.message}${fresh.length > 1 ? `(等 ${fresh.length} 个问题)` : ''}`
      return false
    }
    notice.value = ''
    past.value = [...past.value, { content: before, label }].slice(-limit)
    future.value = []
    commit(draft, 'apply')
    return true
  }

  function undo(): boolean {
    const entry = past.value[past.value.length - 1]
    if (!entry) return false
    past.value = past.value.slice(0, -1)
    future.value = [...future.value, { content: content.value, label: entry.label }]
    commit(entry.content, 'undo')
    return true
  }

  function redo(): boolean {
    const entry = future.value[future.value.length - 1]
    if (!entry) return false
    future.value = future.value.slice(0, -1)
    past.value = [...past.value, { content: content.value, label: entry.label }].slice(-limit)
    commit(entry.content, 'redo')
    return true
  }

  function reset(next: SldEditorContent): void {
    past.value = []
    future.value = []
    notice.value = ''
    selection.value = emptySelection()
    commit(cloneContent(next), 'reset')
  }

  function select(sel: Partial<SldSelection>): void {
    const next = pruneSelection(content.value.doc, { ...emptySelection(), ...sel })
    if (!sameSelection(next, selection.value)) selection.value = next
  }

  function newId(kind: SldIdKind): string {
    const used = kind === 'p' ? usedPointIds(content.value) : usedElementIds(content.value.doc)
    const re = new RegExp(`^${kind}(\\d+)$`)
    let n = counters[kind] ?? 0
    for (const id of used) {
      const m = re.exec(id)
      if (m) n = Math.max(n, Number(m[1]))
    }
    do n += 1
    while (used.has(`${kind}${n}`))
    counters[kind] = n
    return `${kind}${n}`
  }

  return {
    content,
    selection,
    notice,
    canUndo: computed(() => past.value.length > 0),
    canRedo: computed(() => future.value.length > 0),
    undoLabel: computed(() => past.value[past.value.length - 1]?.label),
    redoLabel: computed(() => future.value[future.value.length - 1]?.label),
    apply,
    undo,
    redo,
    reset,
    select,
    newId,
    onChange(cb) {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
  }
}
