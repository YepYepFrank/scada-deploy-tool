// 「按键说明」的内容:快捷键一栏必须来自工具栏同一份按键表,不另抄一份
import { describe, expect, it } from 'vitest'
import { EXTRA_KEYS, MOUSE_HELP, helpSections, prettyCombo, toolShortcuts } from '../src/sld-editor/shortcuts'

describe('按键说明', () => {
  it('组合键排版:修饰键顺序固定,方向键 / Esc / Del 用符号', () => {
    expect(prettyCombo('ctrl+z')).toBe('Ctrl+Z')
    expect(prettyCombo('shift+ctrl+z')).toBe('Ctrl+Shift+Z')
    expect(prettyCombo('ctrl+=')).toBe('Ctrl++')
    expect(prettyCombo('escape')).toBe('Esc')
    expect(prettyCombo('delete')).toBe('Del')
    expect(prettyCombo('left')).toBe('←')
    expect(prettyCombo('f1')).toBe('f1')
    expect(prettyCombo('r')).toBe('R')
  })

  it('按工具栏分组;内置用 keys、扩展用 shortcut;多个键用 / 连起来', () => {
    const secs = toolShortcuts([
      { id: 'undo', title: '撤销', group: 'edit', keys: ['ctrl+z'] },
      { id: 'redo', title: '重做', group: 'edit', keys: ['ctrl+y', 'ctrl+shift+z'] },
      { id: 'dup', title: '复制间隔', group: 'bay', shortcut: 'ctrl+d' },
    ])
    expect(secs.map(s => s.title)).toEqual(['编辑', '间隔'])
    expect(secs[0]!.items).toEqual([
      { keys: 'Ctrl+Z', text: '撤销' },
      { keys: 'Ctrl+Y / Ctrl+Shift+Z', text: '重做' },
    ])
    expect(secs[1]!.items).toEqual([{ keys: 'Ctrl+D', text: '复制间隔' }])
  })

  it('没有快捷键的工具不进说明(工具栏上点得到)', () => {
    expect(toolShortcuts([{ id: 'zoom-reset', title: '100%', group: 'view' }])).toEqual([])
  })

  it('完整说明 = 工具栏快捷键 + 其他按键 + 鼠标', () => {
    const secs = helpSections([{ id: 'undo', title: '撤销', group: 'edit', keys: ['ctrl+z'] }])
    expect(secs.at(-2)).toBe(EXTRA_KEYS)
    expect(secs.at(-1)).toBe(MOUSE_HELP)
    expect(secs).toHaveLength(3)
  })
})
