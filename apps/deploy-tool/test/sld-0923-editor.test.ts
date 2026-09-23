/**
 * 一次接线图编辑器 · 2026-09-23 内测反馈(编辑器 / 向导侧):
 * ① 常用方案的提示与卡片对不上:按方案要的测点推断设备类型;
 * ② 保存有反馈:按钮一直能点,保存后变「已保存 ✓」并冒提示;
 * ④ 开关拖近母线自动吸附(端口压到母线上);
 * ⑤ 颜色框显示 16 进制,可粘贴 #rgb / #rrggbb / rgb();
 * ⑥ 设备框线宽 / 虚线。
 */
import { describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { defineComponent, h } from 'vue'
import { getSldSymbol, portPosition, registerBuiltins, type SldDoc, type SldNode } from '@grid/scada-renderer'
import { snapNodesToBuses } from '../src/sld-editor/doc-ops'
import { setNodeLine } from '../src/sld-editor/panels/inspector/ops'
import ColorField from '../src/sld-editor/panels/inspector/ColorField.vue'
import { PRESETS, inferPresetProfiles } from '../src/provisioner/templates.js'

registerBuiltins()

const node = (id: string, symbol: string, over: Partial<SldNode> = {}): SldNode => ({
  id,
  symbol,
  x: 100,
  y: 100,
  rot: 0,
  ...over,
})
const doc = (nodes: SldNode[]): SldDoc => ({
  v: 1,
  canvas: { w: 800, h: 600, grid: 10 },
  nodes,
  // 一条横母线 y=100(x 0–400),一条竖母线 x=600(y 0–400)
  buses: [
    { id: 'h', x1: 0, y1: 100, x2: 400, y2: 100 },
    { id: 'v', x1: 600, y1: 0, x2: 600, y2: 400 },
  ],
  wires: [],
  labels: [],
})

describe('④ 开关拖近母线自动吸附', () => {
  it('断路器上端口离横母线 20 以内:整体挪过去,端口正好压在母线上;依附的标签跟着走', () => {
    const d = doc([node('q', 'breaker', { x: 100, y: 110 })])
    d.labels.push({ id: 'l', kind: 'text', x: 150, y: 130, text: 'QF1', attach: 'q' })
    expect(snapNodesToBuses(d, ['q'], getSldSymbol)).toEqual(['q'])
    const a = portPosition(d.nodes[0]!, getSldSymbol('breaker')!, 'a')!
    expect(a.y).toBe(100)
    expect(d.labels[0]).toMatchObject({ x: 150, y: 120 })
  })
  it('下端口靠近也行(开关挂在母线下面 / 上面都吸)', () => {
    const d = doc([node('q', 'breaker', { x: 100, y: 30 })]) // 下端口 y = 90
    snapNodesToBuses(d, ['q'], getSldSymbol)
    expect(portPosition(d.nodes[0]!, getSldSymbol('breaker')!, 'b')!.y).toBe(100)
  })
  it('竖母线同理(横向挪)', () => {
    const def = getSldSymbol('breaker')!
    // 转 90° 后端口在 x+60 / x,离竖母线 10
    const d = doc([node('q', 'breaker', { x: 550, y: 200, rot: 90 })])
    snapNodesToBuses(d, ['q'], getSldSymbol)
    expect(def.ports.some(p => portPosition(d.nodes[0]!, def, p.id)!.x === 600)).toBe(true)
  })
  it('太远(超过两格)或落在母线两端之外:不动;已经压上的:不动', () => {
    const far = doc([node('q', 'breaker', { x: 100, y: 130 })])
    expect(snapNodesToBuses(far, ['q'], getSldSymbol)).toEqual([])
    const outside = doc([node('q', 'breaker', { x: 450, y: 110 })])
    expect(snapNodesToBuses(outside, ['q'], getSldSymbol)).toEqual([])
    const on = doc([node('q', 'breaker', { x: 100, y: 100 })])
    expect(snapNodesToBuses(on, ['q'], getSldSymbol)).toEqual([])
  })
  it('只动传进来的节点', () => {
    const d = doc([node('q1', 'breaker', { x: 100, y: 110 }), node('q2', 'breaker', { x: 200, y: 110 })])
    snapNodesToBuses(d, ['q1'], getSldSymbol)
    expect(d.nodes.map(n => n.y)).toEqual([100, 110])
  })
})

describe('⑥ 设备框线宽 / 虚线', () => {
  it('一批设备框一起改;缺省线宽 2 不落进 JSON;越界拒绝;非设备框跳过', () => {
    const d = doc([node('b1', 'device-box'), node('b2', 'device-box'), node('q', 'breaker')])
    expect(setNodeLine(d, ['b1', 'b2', 'q'], { width: 4, dashed: true }, getSldSymbol)).toBe(true)
    expect(d.nodes.map(n => [n.lineWidth, n.dashed])).toEqual([
      [4, true],
      [4, true],
      [undefined, undefined],
    ])
    expect(setNodeLine(d, ['b1'], { width: 99 }, getSldSymbol)).toBe(false)
    expect(setNodeLine(d, ['b1', 'b2'], { width: 2, dashed: false }, getSldSymbol)).toBe(true)
    expect(d.nodes.slice(0, 2).every(n => !('lineWidth' in n) && !('dashed' in n))).toBe(true)
  })
})

describe('⑤ 颜色框:16 进制,可复制粘贴', () => {
  const mountField = (modelValue?: string) => mount(ColorField, { props: { modelValue, field: 'c' } })
  it('显示当前色值的 16 进制文本', () => {
    expect((mountField('#ff8800').find('[data-field="c"]').element as HTMLInputElement).value).toBe('#ff8800')
  })
  it('粘贴各种写法都认,统一成小写 #rrggbb', async () => {
    for (const [input, want] of [
      ['FF8800', '#ff8800'],
      ['#F80', '#ff8800'],
      ['rgb(255, 136, 0)', '#ff8800'],
      ['  #1a2B3c ', '#1a2b3c'],
    ] as const) {
      const w = mountField()
      await w.find('[data-field="c"]').setValue(input)
      expect(w.emitted('change')?.[0]).toEqual([want])
    }
  })
  it('认不出来的不提交、标红;清空 = 恢复缺省(发 undefined)', async () => {
    const w = mountField('#ff8800')
    await w.find('[data-field="c"]').setValue('红色')
    expect(w.emitted('change')).toBeUndefined()
    expect(w.find('.sld-color').classes()).toContain('sld-color-bad')
    await w.find('[data-field="c"]').setValue('')
    expect(w.emitted('change')?.[0]).toEqual([undefined])
  })
})

describe('② 接线图编辑器的保存反馈', () => {
  // SldEditor 很重,这里用桩子;覆盖层自己的保存逻辑与反馈才是被测对象
  vi.mock('../src/sld-editor/SldEditor.vue', () => ({
    default: defineComponent({
      props: { content: { type: Object, required: true } },
      emits: ['update:content', 'close'],
      setup(props, { emit }) {
        return () =>
          h('button', {
            'data-role': 'stub-draw',
            onClick: () => {
              const c = props.content as { doc: SldDoc; bindings: Record<string, unknown> }
              emit('update:content', {
                ...c,
                doc: { ...c.doc, nodes: [...c.doc.nodes, node(`n${c.doc.nodes.length}`, 'breaker')] },
              })
            },
          })
      },
    }),
  }))

  const mountOverlay = async () => {
    const { default: Overlay } = await import('../src/editor/SldEditorOverlay.vue')
    const initial = { doc: doc([]), bindings: {} }
    const w = mount(Overlay, { props: { initial, host: { siteName: 's' } }, attachTo: document.body })
    await flushPromises()
    return w
  }
  const q = (sel: string) => document.body.querySelector(sel) as HTMLElement | null

  it('没改动时点「保存」也有反应:提示「已是最新」,按钮变「已保存 ✓」', async () => {
    const w = await mountOverlay()
    const btn = q('[data-role="sld-save"]') as HTMLButtonElement
    expect(btn.disabled).toBe(false)
    btn.click()
    await flushPromises()
    expect(btn.textContent).toContain('已保存')
    expect(q('[data-role="sld-save-toast"]')!.textContent).toContain('已是最新')
    expect(w.emitted('save')).toBeUndefined()
    w.unmount()
  })
  it('改过再点:交出内容,提示「已保存到页面 hh:mm:ss」并说明要到第 4 步保存草稿', async () => {
    const w = await mountOverlay()
    q('[data-role="stub-draw"]')!.click()
    await flushPromises()
    q('[data-role="sld-save"]')!.click()
    await flushPromises()
    expect(w.emitted('save')).toHaveLength(1)
    const toast = q('[data-role="sld-save-toast"]')!.textContent!
    expect(toast).toMatch(/已保存到页面 \d{2}:\d{2}:\d{2}/)
    expect(toast).toContain('保存草稿')
    w.unmount()
  })
})

describe('① 常用方案按测点推断设备类型', () => {
  const volt = PRESETS.find(p => p.id === 'volt')!
  const keysOf = (i: { key?: string; keys?: string[] }) => i.keys ?? (i.key ? [i.key] : [])
  const dev = (profile: string, keys: string[]) => ({
    profile,
    keys: keys.map(key => ({ key, claimed: true })),
  })
  it('站上设备类型是 default(不是方案写的 IED):改用实际带 Ua/Ub/Uc 的设备类型', () => {
    const r = inferPresetProfiles(volt, [dev('default', ['Ua', 'Ub', 'Uc']), dev('meter', ['P'])], keysOf)
    expect(r).toEqual({ profiles: ['default'], inferred: true })
  })
  it('方案默认类型下有带这些测点的设备:照旧 IED', () => {
    const r = inferPresetProfiles(volt, [dev('IED', ['Ua']), dev('default', ['Ua'])], keysOf)
    expect(r).toEqual({ profiles: ['IED'], inferred: false })
  })
  it('一台带这些测点的都没有:照旧(提示里会说没匹配上)', () => {
    expect(inferPresetProfiles(volt, [dev('default', ['P'])], keysOf)).toEqual({ profiles: ['IED'], inferred: false })
  })
})
