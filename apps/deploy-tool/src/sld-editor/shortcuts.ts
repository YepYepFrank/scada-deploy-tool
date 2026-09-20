/**
 * 「按键说明」的内容(纯函数,可单测):快捷键一栏从工具栏同一份按键表生成,不另抄一份;
 * 鼠标操作与不在工具栏上的键(剪切 / 全选 / 微移 / Esc)是固定清单,改了实现记得一起改。
 */
export interface HelpItem {
  /** 按键组合(已排版,如 Ctrl+Z);鼠标操作为空 */
  keys?: string
  text: string
}
export interface HelpSection {
  title: string
  items: HelpItem[]
}

/** 传进来的工具:内置的用 keys,扩展的用 shortcut */
export interface HelpTool {
  id: string
  title: string
  group?: string
  keys?: string[]
  shortcut?: string
}

const MOD_ORDER = ['ctrl', 'alt', 'shift']
const PRETTY: Record<string, string> = {
  ctrl: 'Ctrl',
  alt: 'Alt',
  shift: 'Shift',
  escape: 'Esc',
  delete: 'Del',
  backspace: 'Backspace',
  left: '←',
  right: '→',
  up: '↑',
  down: '↓',
  space: '空格',
  '=': '+',
}

/** 'ctrl+shift+z' → 'Ctrl+Shift+Z' */
export function prettyCombo(combo: string): string {
  const parts = combo.toLowerCase().split('+').filter(Boolean)
  const mods = MOD_ORDER.filter(m => parts.includes(m))
  const keys = parts.filter(p => !MOD_ORDER.includes(p))
  return [...mods, ...keys].map(p => PRETTY[p] ?? (p.length === 1 ? p.toUpperCase() : p)).join('+')
}

const GROUP_TITLE: Record<string, string> = {
  edit: '编辑',
  arrange: '排列与绘制',
  bay: '间隔',
  view: '视图',
  file: '文件',
}

/** 工具栏上带快捷键的工具 → 分组后的条目;没有快捷键的工具不进说明(工具栏上点得到) */
export function toolShortcuts(tools: HelpTool[]): HelpSection[] {
  const byGroup = new Map<string, HelpItem[]>()
  for (const t of tools) {
    const combos = (t.keys?.length ? t.keys : t.shortcut ? [t.shortcut] : []).map(prettyCombo).filter(Boolean)
    if (!combos.length) continue
    const g = t.group ?? 'edit'
    const items = byGroup.get(g) ?? byGroup.set(g, []).get(g)!
    items.push({ keys: combos.join(' / '), text: t.title })
  }
  return [...byGroup].map(([g, items]) => ({ title: GROUP_TITLE[g] ?? g, items }))
}

/** 不在工具栏上的键 */
export const EXTRA_KEYS: HelpSection = {
  title: '其他按键',
  items: [
    { keys: 'Ctrl+X', text: '剪切选中' },
    { keys: 'Ctrl+A', text: '全选' },
    { keys: '← ↑ → ↓', text: '选中元素微移一格(10 px)' },
    { keys: 'Esc', text: '退出画母线 / 加文字 / 加分组框模式;已在选择模式时清空选择' },
  ],
}

/** 鼠标操作 */
export const MOUSE_HELP: HelpSection = {
  title: '鼠标',
  items: [
    { text: '左栏图元拖到画布 = 新建图元;设备树里的设备拖进来 = 自动配图元并绑常用测点' },
    { text: '从图元端口(小圆点)拖到另一个端口 / 母线上任意位置 = 连线,落点吸附到栅格' },
    { text: '点连线出现拐点手柄:拖动改走线,双击拐点删除它' },
    { text: '拖母线两端的手柄可伸缩;母线上的接点跟着保持原位' },
    { text: '空白处拖动 = 框选;选中后拖动 = 整体移动' },
    { text: '右键拖动 / 空格 + 左键拖动 = 平移画布;滚轮 = 以指针为中心缩放' },
    { text: '双击空白处 = 适应窗口' },
  ],
}

/** 完整说明:工具栏快捷键 + 其他按键 + 鼠标 */
export function helpSections(tools: HelpTool[]): HelpSection[] {
  return [...toolShortcuts(tools), EXTRA_KEYS, MOUSE_HELP]
}
