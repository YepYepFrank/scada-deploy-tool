/**
 * 「复制间隔 ×N」的纯逻辑(T5.7):选择集扩展、方向猜测、默认间距、改名规则、一次 apply 内的草稿修改。
 * 无 Vue、无 DOM,可单测。
 */
import {
  SLD_GRID,
  duplicateBay,
  incrementName,
  type SldDoc,
  type SldSelection,
  type SldSymbolLookup,
  type SldWireEnd,
} from '@grid/scada-renderer'
import type { SldEditorContent } from '../../ext'
import { selectionBoxes, snapUp, unionBox } from '../_shared/geometry'

export type BayDirection = 'right' | 'down' | 'custom'

export const MAX_COPIES = 50
/** 默认间距 = 包围盒在该方向的尺寸 + 这么多 */
export const BAY_GAP = 20

/**
 * 用户的选择 → 实际复制的选择集:
 * - 节点、显式选中的母线 / 连线 / 标签 / 分组框原样保留;
 * - 选中节点之间的连线、节点连到**任意**母线的连线自动带上(复制出来的线接回同一条母线);
 * - attach 在选中节点上的标签自动带上;
 * - 母线本身不带,除非用户显式选中。
 */
export function expandBaySelection(doc: SldDoc, sel: SldSelection): SldSelection {
  const nodes = new Set(sel.nodes)
  const buses = new Set(sel.buses)
  const busIds = new Set(doc.buses.map(b => b.id))
  const isNode = (e: SldWireEnd): boolean => 'node' in e && nodes.has(e.node)
  const inside = (e: SldWireEnd): boolean => ('bus' in e ? buses.has(e.bus) : nodes.has(e.node))
  const toBus = (e: SldWireEnd): boolean => 'bus' in e && busIds.has(e.bus)
  const wires = new Set(sel.wires)
  for (const w of doc.wires) {
    const both = inside(w.from) && inside(w.to)
    const nodeToBus = (isNode(w.from) && toBus(w.to)) || (isNode(w.to) && toBus(w.from))
    if (both || nodeToBus) wires.add(w.id)
  }
  const labels = new Set(sel.labels)
  for (const l of doc.labels) if (l.attach && nodes.has(l.attach)) labels.add(l.id)
  return {
    nodes: doc.nodes.filter(n => nodes.has(n.id)).map(n => n.id),
    buses: doc.buses.filter(b => buses.has(b.id)).map(b => b.id),
    wires: doc.wires.filter(w => wires.has(w.id)).map(w => w.id),
    labels: doc.labels.filter(l => labels.has(l.id)).map(l => l.id),
    frames: (doc.frames ?? []).filter(f => (sel.frames ?? []).includes(f.id)).map(f => f.id),
  }
}

/**
 * 按选中节点所接母线的方向猜复制方向:接在水平母线上(一排竖着的出线)→ 向右;
 * 接在垂直母线上(LP3 那种横向出线)→ 向下。没接母线时:选中元素横向比纵向长则向下,否则向右。
 */
export function guessDirection(doc: SldDoc, sel: SldSelection, symbols: SldSymbolLookup): 'right' | 'down' {
  const nodes = new Set(sel.nodes)
  const busById = new Map(doc.buses.map(b => [b.id, b] as const))
  for (const w of doc.wires) {
    const pairs: Array<[SldWireEnd, SldWireEnd]> = [
      [w.from, w.to],
      [w.to, w.from],
    ]
    for (const [a, b] of pairs) {
      if (!('node' in a) || !nodes.has(a.node) || !('bus' in b)) continue
      const bus = busById.get(b.bus)
      if (!bus) continue
      return Math.abs(bus.x2 - bus.x1) >= Math.abs(bus.y2 - bus.y1) ? 'right' : 'down'
    }
  }
  const box = unionBox(selectionBoxes(doc, sel, symbols))
  return box && box.w > box.h ? 'down' : 'right'
}

/** 默认间距:选中元素(不含连线)的包围盒在该方向上的尺寸 + 20,向上吸附到 10;空选择给 100 */
export function defaultSpacing(
  doc: SldDoc,
  sel: SldSelection,
  dir: 'right' | 'down',
  symbols: SldSymbolLookup
): number {
  const box = unionBox(selectionBoxes(doc, sel, symbols))
  if (!box) return 10 * SLD_GRID
  return snapUp((dir === 'right' ? box.w : box.h) + BAY_GAP)
}

/** 每份的位移 */
export function stepOf(
  dir: BayDirection,
  spacing: number,
  custom: { dx: number; dy: number }
): { dx: number; dy: number } {
  if (dir === 'right') return { dx: spacing, dy: 0 }
  if (dir === 'down') return { dx: 0, dy: spacing }
  return { dx: custom.dx, dy: custom.dy }
}

export interface RenameRule {
  enabled: boolean
  /** incrementName 的段号;undefined = 最后一段 */
  segment?: number
}

export function renameWith(rule: RenameRule): (name: string, index: number) => string {
  return (name, index) => (rule.enabled ? incrementName(name, index, rule.segment) : name)
}

/** 名字里最多有几段数字(段号下拉框的选项数) */
export function maxSegments(names: string[]): number {
  return names.reduce((m, n) => Math.max(m, (n.match(/\d+/g) ?? []).length), 0)
}

/**
 * 选中元素里会被改名的名字(节点名、设备名;按开关再加分组框标题与文字标签),去重、按出现顺序。
 * 预览表与段号选项都用它。
 */
export function bayNames(doc: SldDoc, sel: SldSelection, withTitles: boolean): string[] {
  const out: string[] = []
  const add = (s: string | undefined): void => {
    if (s && !out.includes(s)) out.push(s)
  }
  for (const n of doc.nodes)
    if (sel.nodes.includes(n.id)) {
      add(n.name)
      add(n.entity?.name)
    }
  if (withTitles) {
    for (const f of doc.frames ?? []) if ((sel.frames ?? []).includes(f.id)) add(f.title)
    for (const l of doc.labels) if (sel.labels.includes(l.id) && l.kind === 'text') add(l.text)
  }
  return out
}

/** 预览表:每个原名 → 第 1..count 份的新名(最多给 maxCols 列,份数多时只看前几份) */
export function renamePreview(
  names: string[],
  count: number,
  rule: RenameRule,
  maxCols = 3
): Array<{ from: string; to: string[] }> {
  const rename = renameWith(rule)
  const cols = Math.max(0, Math.min(count, maxCols))
  return names.map(from => ({ from, to: Array.from({ length: cols }, (_, i) => rename(from, i + 1)) }))
}

export interface BayOptions {
  count: number
  dx: number
  dy: number
  rule: RenameRule
  /** 分组框标题与文字标签也按规则改名 */
  renameTitles: boolean
}

export const clampCount = (n: number): number =>
  Number.isFinite(n) ? Math.min(MAX_COPIES, Math.max(1, Math.floor(n))) : 1

/**
 * 在一次 apply 的草稿里完成复制:扩展选择集 → duplicateBay → doc 整体替换、新绑定并入、
 * 按需给新分组框标题 / 文字标签改名。返回每份新建元素的选择集(没复制出东西时为空数组)。
 */
export function applyDuplicateBay(draft: SldEditorContent, sel: SldSelection, opts: BayOptions): SldSelection[] {
  const picked = expandBaySelection(draft.doc, sel)
  if (!picked.nodes.length && !picked.buses.length && !picked.labels.length && !(picked.frames ?? []).length) return []
  const rename = renameWith(opts.rule)
  const res = duplicateBay(draft.doc, draft.bindings, picked, {
    count: clampCount(opts.count),
    dx: opts.dx,
    dy: opts.dy,
    rename,
  })
  draft.doc = res.doc
  Object.assign(draft.bindings, res.bindings)
  if (opts.renameTitles && opts.rule.enabled)
    res.created.forEach((created, k) => {
      const index = k + 1
      for (const f of res.doc.frames ?? [])
        if ((created.frames ?? []).includes(f.id) && f.title) f.title = rename(f.title, index)
      for (const l of res.doc.labels)
        if (created.labels.includes(l.id) && l.kind === 'text') l.text = rename(l.text, index)
    })
  return res.created
}
