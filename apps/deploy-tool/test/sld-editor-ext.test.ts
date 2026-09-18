// T5.5 扩展点:发现结果的整理与排序、快捷键冲突告警、drops 分发
import { describe, expect, it, vi } from 'vitest'
import { defineComponent } from 'vue'
import { defineSldExtension, type SldEditorContext, type SldToolExt } from '../src/sld-editor/ext'
import {
  buildKeymap,
  collectExtensions,
  comboOfEvent,
  dispatchDrop,
  findDrop,
  groupTools,
  isTypingTarget,
  normalizeCombo,
} from '../src/sld-editor/extensions'

const Dummy = defineComponent({ render: () => null })
const tool = (id: string, extra: Partial<SldToolExt> = {}): SldToolExt => ({ id, title: id, run: () => {}, ...extra })
const ctx = {} as SldEditorContext

describe('collectExtensions', () => {
  it('面板按 order(缺省 100)再按 id;工具先按组再按 order;与模块发现顺序无关', () => {
    const modules = {
      './tools/z/index.ts': {
        default: defineSldExtension({
          tools: [
            tool('fit', { group: 'view' }),
            tool('save', { group: 'file', order: 1 }),
            tool('nogroup', { order: 5 }),
          ],
        }),
      },
      './panels/issues/index.ts': {
        default: defineSldExtension({ panels: [{ id: 'issues', title: '问题', component: Dummy }] }),
      },
      './panels/binding/index.ts': {
        default: defineSldExtension({
          panels: [{ id: 'binding', title: '绑定', order: 20, component: Dummy }],
          tools: [
            tool('align', { group: 'arrange' }),
            tool('dup', { group: 'bay' }),
            tool('zoom', { group: 'view', order: 10 }),
          ],
        }),
      },
      './panels/inspector/index.ts': {
        default: defineSldExtension({ panels: [{ id: 'inspector', title: '属性', order: 10, component: Dummy }] }),
      },
      './panels/about/index.ts': {
        default: defineSldExtension({ panels: [{ id: 'about', title: '关于', component: Dummy }] }),
      },
    }
    const set = collectExtensions(modules, () => {})
    expect(set.panels.map(p => p.id)).toEqual(['inspector', 'binding', 'about', 'issues'])
    expect(set.tools.map(t => t.id)).toEqual(['nogroup', 'align', 'dup', 'zoom', 'fit', 'save'])
    const reversed = Object.fromEntries(Object.entries(modules).reverse())
    expect(collectExtensions(reversed, () => {})).toEqual(set)
  })

  it('没有 default 导出的模块、重复 id:告警并跳过', () => {
    const warn = vi.fn()
    const set = collectExtensions(
      {
        './tools/a/index.ts': { default: defineSldExtension({ tools: [tool('x')] }) },
        './tools/b/index.ts': { default: defineSldExtension({ tools: [tool('x'), tool('y')] }) },
        './tools/c/index.ts': { notDefault: 1 },
      },
      warn
    )
    expect(set.tools.map(t => t.id)).toEqual(['x', 'y'])
    expect(warn).toHaveBeenCalledTimes(2)
    expect(warn.mock.calls.map(c => String(c[0])).join('\n')).toMatch(
      /tools\/c.*跳过[\s\S]*"x" 重复|"x" 重复[\s\S]*tools\/c/
    )
  })

  it('drops / layers 原样收集', () => {
    const set = collectExtensions(
      {
        './tools/bg/index.ts': {
          default: defineSldExtension({
            drops: [{ type: 'application/x-grid-entity', onDrop: () => {} }],
            layers: [
              { id: 'bg', z: 'under', component: Dummy },
              { id: 'ruler', z: 'over', component: Dummy },
            ],
          }),
        },
      },
      () => {}
    )
    expect(set.drops).toHaveLength(1)
    expect(set.layers.map(l => `${l.z}:${l.id}`)).toEqual(['under:bg', 'over:ruler'])
  })

  it('groupTools:同组挨在一起、空组不出现', () => {
    const groups = groupTools([tool('b', { group: 'view' }), tool('a'), tool('c', { group: 'view', order: 1 })])
    expect(groups.map(g => [g.group, g.tools.map(t => t.id)])).toEqual([
      ['edit', ['a']],
      ['view', ['c', 'b']],
    ])
  })
})

describe('快捷键', () => {
  it('normalizeCombo:大小写、顺序、meta / cmd 当 ctrl、别名', () => {
    expect(normalizeCombo('Ctrl+D')).toBe('ctrl+d')
    expect(normalizeCombo('shift+ctrl+Z')).toBe('ctrl+shift+z')
    expect(normalizeCombo('meta+c')).toBe('ctrl+c')
    expect(normalizeCombo('Del')).toBe('delete')
    expect(normalizeCombo('ArrowLeft')).toBe('left')
    expect(normalizeCombo('ctrl+shift')).toBe('')
    expect(normalizeCombo('')).toBe('')
  })

  it('comboOfEvent 与 normalizeCombo 对得上', () => {
    const ev = (key: string, mods: Partial<KeyboardEvent> = {}) =>
      comboOfEvent({ key, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...mods })
    expect(ev('z', { ctrlKey: true })).toBe(normalizeCombo('ctrl+z'))
    expect(ev('Z', { metaKey: true, shiftKey: true })).toBe(normalizeCombo('ctrl+shift+z'))
    expect(ev('Delete')).toBe('delete')
    expect(ev('ArrowUp')).toBe('up')
    expect(ev('R')).toBe('r')
    expect(ev('Control', { ctrlKey: true })).toBe('')
  })

  it('扩展工具与内置冲突:内置为准并告警;扩展之间冲突:先到先得并告警;不合法的忽略', () => {
    const warn = vi.fn()
    const undo = vi.fn()
    const ran: string[] = []
    const map = buildKeymap(
      [{ id: 'undo', combos: ['ctrl+z', 'meta+z'], run: undo }],
      [
        tool('evil', { shortcut: 'Ctrl+Z' }),
        tool('dup', { shortcut: 'ctrl+d' }),
        tool('dup2', { shortcut: 'CTRL+D' }),
        tool('bad', { shortcut: 'ctrl+' }),
        tool('none'),
      ],
      t => ran.push(t.id),
      warn
    )
    expect([...map.keys()].sort()).toEqual(['ctrl+d', 'ctrl+z'])
    map.get('ctrl+z')!.run()
    expect(undo).toHaveBeenCalledTimes(1)
    expect(map.get('ctrl+z')!.owner).toBe('builtin:undo')
    map.get('ctrl+d')!.run()
    expect(ran).toEqual(['dup'])
    const msgs = warn.mock.calls.map(c => String(c[0]))
    expect(msgs).toHaveLength(3)
    expect(msgs[0]).toMatch(/evil.*ctrl\+z.*内置/)
    expect(msgs[1]).toMatch(/dup2.*ctrl\+d.*dup/)
    expect(msgs[2]).toMatch(/bad.*不合法/)
  })

  it('isTypingTarget:输入控件里不抢键', () => {
    expect(isTypingTarget(document.createElement('input'))).toBe(true)
    expect(isTypingTarget(document.createElement('textarea'))).toBe(true)
    expect(isTypingTarget(document.createElement('div'))).toBe(false)
    expect(isTypingTarget(null)).toBe(false)
  })
})

describe('drops 分发', () => {
  const transfer = (data: Record<string, string>) => ({
    types: Object.keys(data),
    getData: (t: string) => data[t] ?? '',
  })

  it('按 DataTransfer type 找扩展,把原始字符串与画布坐标交给它', () => {
    const entity = vi.fn()
    const image = vi.fn()
    const drops = [
      { type: 'application/x-grid-entity', onDrop: entity },
      { type: 'text/uri-list', onDrop: image },
    ]
    const at = { x: 120, y: 80 }
    const hit = dispatchDrop(
      drops,
      ctx,
      transfer({ 'text/plain': 'x', 'application/x-grid-entity': '{"name":"IED1"}' }),
      at
    )
    expect(hit).toBe(true)
    expect(entity).toHaveBeenCalledWith(ctx, '{"name":"IED1"}', at)
    expect(image).not.toHaveBeenCalled()
  })

  it('没人认领返回 false;findDrop 供 dragover 判断', () => {
    const drops = [{ type: 'application/x-grid-entity', onDrop: vi.fn() }]
    expect(dispatchDrop(drops, ctx, transfer({ 'text/plain': 'x' }), { x: 0, y: 0 })).toBe(false)
    expect(findDrop(drops, ['Files'])).toBeUndefined()
    expect(findDrop(drops, ['application/x-grid-entity'])?.type).toBe('application/x-grid-entity')
  })
})
