/**
 * 扩展点的注册与分发(纯逻辑,可单测):把 `import.meta.glob` 发现的模块整理成排好序的面板 / 工具 / 拖放 / 图层,
 * 把内置快捷键与扩展工具的 shortcut 合成一张键位表(冲突以内置为准并告警),按 DataTransfer type 分发拖放。
 * 发现本身(import.meta.glob)放在 discover.ts——那是 Vite 的编译期宏,和纯逻辑分开。
 */
import type { SldPoint } from '@grid/scada-renderer'
import type { SldDropExt, SldEditorContext, SldEditorExtension, SldLayerExt, SldPanelExt, SldToolExt } from './ext'

export const TOOL_GROUPS = ['edit', 'arrange', 'bay', 'view', 'file'] as const
export type SldToolGroup = (typeof TOOL_GROUPS)[number]
const DEFAULT_ORDER = 100
const DEFAULT_GROUP: SldToolGroup = 'edit'

export interface SldExtensionSet {
  panels: SldPanelExt[]
  tools: SldToolExt[]
  drops: SldDropExt[]
  layers: SldLayerExt[]
}

type Warn = (msg: string) => void
const consoleWarn: Warn = msg => console.warn(`[sld-editor] ${msg}`)

const isExtension = (x: unknown): x is SldEditorExtension => !!x && typeof x === 'object' && !Array.isArray(x)

/** 稳定排序:order(缺省 100)小的在前,相同按 id */
const byOrder = <T extends { id: string; order?: number }>(a: T, b: T): number =>
  (a.order ?? DEFAULT_ORDER) - (b.order ?? DEFAULT_ORDER) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)

/**
 * glob 出来的模块表 → 扩展集合。模块要 `export default defineSldExtension({...})`;没有 default 的告警跳过。
 * 面板按 order;工具先按 group(edit / arrange / bay / view / file,缺省 edit)再按 order;同 id 后来的被丢弃并告警。
 * 模块按路径排序后再处理,结果不依赖 glob 的返回顺序。
 */
export function collectExtensions(modules: Record<string, unknown>, warn: Warn = consoleWarn): SldExtensionSet {
  const set: SldExtensionSet = { panels: [], tools: [], drops: [], layers: [] }
  const seen = {
    panels: new Set<string>(),
    tools: new Set<string>(),
    layers: new Set<string>(),
    drops: new Set<string>(),
  }
  for (const path of Object.keys(modules).sort()) {
    const mod = modules[path] as { default?: unknown } | undefined
    const ext = mod?.default
    if (!isExtension(ext)) {
      warn(`${path} 没有 export default defineSldExtension({...}),已跳过`)
      continue
    }
    const take = <T>(kind: keyof typeof seen, items: T[] | undefined, keyOf: (x: T) => string, into: T[]): void => {
      for (const item of items ?? []) {
        const key = keyOf(item)
        if (seen[kind].has(key)) {
          warn(`${path}:${kind} "${key}" 重复,已跳过`)
          continue
        }
        seen[kind].add(key)
        into.push(item)
      }
    }
    take('panels', ext.panels, p => p.id, set.panels)
    take('tools', ext.tools, t => t.id, set.tools)
    take('drops', ext.drops, d => d.type, set.drops)
    take('layers', ext.layers, l => l.id, set.layers)
  }
  set.panels.sort(byOrder)
  set.tools = sortTools(set.tools)
  return set
}

const groupIndex = (t: SldToolExt): number => TOOL_GROUPS.indexOf(t.group ?? DEFAULT_GROUP)

export function sortTools<T extends SldToolExt>(tools: T[]): T[] {
  return [...tools].sort((a, b) => groupIndex(a) - groupIndex(b) || byOrder(a, b))
}

/** 排好序的工具 → 按组切开(工具栏在组间画分隔);空组不出现 */
export function groupTools<T extends SldToolExt>(tools: T[]): Array<{ group: SldToolGroup; tools: T[] }> {
  const out: Array<{ group: SldToolGroup; tools: T[] }> = []
  for (const t of sortTools(tools)) {
    const group = t.group ?? DEFAULT_GROUP
    const last = out[out.length - 1]
    if (last?.group === group) last.tools.push(t)
    else out.push({ group, tools: [t] })
  }
  return out
}

/* ───────────── 快捷键 ───────────── */

const MODS = ['ctrl', 'alt', 'shift'] as const
const KEY_ALIAS: Record<string, string> = {
  del: 'delete',
  esc: 'escape',
  ' ': 'space',
  arrowup: 'up',
  arrowdown: 'down',
  arrowleft: 'left',
  arrowright: 'right',
  cmd: 'ctrl',
  meta: 'ctrl',
  command: 'ctrl',
  control: 'ctrl',
  option: 'alt',
}

/** 'Ctrl+Shift+Z' / 'shift+ctrl+z' → 'ctrl+shift+z';meta / cmd 当 ctrl;不合法(没有主键)返回 '' */
export function normalizeCombo(combo: string): string {
  const parts = combo
    .toLowerCase()
    .split('+')
    .map(s => (s === ' ' ? s : s.trim()))
    .filter(s => s !== '')
    .map(s => KEY_ALIAS[s] ?? s)
  const mods = MODS.filter(m => parts.includes(m))
  const keys = parts.filter(p => !(MODS as readonly string[]).includes(p))
  if (keys.length !== 1) return ''
  return [...mods, keys[0]].join('+')
}

/** 键盘事件 → 规范化的组合键;只按了修饰键返回 '' */
export function comboOfEvent(e: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey'>): string {
  const key = e.key.toLowerCase()
  if (['control', 'meta', 'alt', 'shift'].includes(key)) return ''
  const mods = [e.ctrlKey || e.metaKey ? 'ctrl' : '', e.altKey ? 'alt' : '', e.shiftKey ? 'shift' : ''].filter(Boolean)
  return [...mods, KEY_ALIAS[key] ?? key].join('+')
}

export interface SldKeyBinding {
  combo: string
  /** 'builtin:undo' / 'tool:fit' */
  owner: string
  run: () => void
}

/**
 * 合成键位表。内置的先占;扩展工具的 shortcut 与内置冲突 → 以内置为准并告警(ext.ts 的约定);
 * 两个扩展工具撞了 → 先到先得并告警。
 */
export function buildKeymap(
  builtins: Array<{ combos: string[]; id: string; run: () => void }>,
  tools: SldToolExt[],
  runTool: (tool: SldToolExt) => void,
  warn: Warn = consoleWarn
): Map<string, SldKeyBinding> {
  const map = new Map<string, SldKeyBinding>()
  for (const b of builtins)
    for (const raw of b.combos) {
      const combo = normalizeCombo(raw)
      if (combo) map.set(combo, { combo, owner: `builtin:${b.id}`, run: b.run })
    }
  for (const tool of tools) {
    if (!tool.shortcut) continue
    const combo = normalizeCombo(tool.shortcut)
    if (!combo) {
      warn(`工具 "${tool.id}" 的快捷键 "${tool.shortcut}" 不合法,已忽略`)
      continue
    }
    const taken = map.get(combo)
    if (taken) {
      const who = taken.owner.startsWith('builtin:')
        ? `内置快捷键(${taken.owner.slice(8)})`
        : `工具 "${taken.owner.slice(5)}"`
      warn(`工具 "${tool.id}" 的快捷键 ${combo} 与${who}冲突,以后者为准`)
      continue
    }
    map.set(combo, { combo, owner: `tool:${tool.id}`, run: () => runTool(tool) })
  }
  return map
}

/** 焦点在输入控件里时不抢键(属性面板里改名字按 Delete / R 不能删节点 / 旋转) */
export function isTypingTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null
  if (!el || typeof el.tagName !== 'string') return false
  return ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName) || el.isContentEditable === true
}

/* ───────────── 拖放 ───────────── */

type TransferLike = Pick<DataTransfer, 'getData'> & { types: ReadonlyArray<string> }

/** dragover 时问一句:这次拖的东西有没有扩展认(有才 preventDefault,让浏览器显示可放下) */
export function findDrop(drops: SldDropExt[], types: ReadonlyArray<string>): SldDropExt | undefined {
  return drops.find(d => types.includes(d.type))
}

/** drop:按 DataTransfer 的 type 找到第一个认领的扩展并调它;at 由调用方用 ctx.toCanvas 换算好。返回是否有人认领 */
export function dispatchDrop(
  drops: SldDropExt[],
  ctx: SldEditorContext,
  transfer: TransferLike,
  at: SldPoint
): boolean {
  const drop = findDrop(drops, [...transfer.types])
  if (!drop) return false
  drop.onDrop(ctx, transfer.getData(drop.type), at)
  return true
}
