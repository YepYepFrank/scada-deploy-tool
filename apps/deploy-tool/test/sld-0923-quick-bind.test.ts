/**
 * 一次接线图编辑器 · 2026-09-23 内测反馈 ⑦「绑定太繁琐,每次都要站点 → 设备 → 测点;
 * 能否默认使用上一次的设备,并展开测点」(参考基站储能系统的「绑定量测」):
 * 最近用过的设备(按站点记在本机)、没绑的测点直接展开列表、点一行就绑上、绑完轮到下一个、顺手补全。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { ref, shallowRef } from 'vue'
import { registerBuiltinSldSymbols, type SldDoc, type SldSelection } from '@grid/scada-renderer'
import { SLD_EDITOR_CTX, type SldEditorContent, type SldEditorContext } from '../src/sld-editor/ext'
import { emptySelection } from '../src/sld-editor/store'
import BindingPanel from '../src/sld-editor/panels/binding/BindingPanel.vue'
import { mockHost } from '../src/sld-editor/panels/binding/dev-mock'
import {
  labelDefaultsForKey,
  quickBindLabel,
  quickBindState,
  stateMapForKey,
  type QuickDevice,
} from '../src/sld-editor/panels/binding/ops'
import { openSlotOf } from '../src/sld-editor/panels/binding/quick'
import { RECENT_MAX, recentDevices, rememberDevice, resetRecentDevices } from '../src/sld-editor/panels/binding/recent'

registerBuiltinSldSymbols()

beforeEach(() => {
  localStorage.clear()
  resetRecentDevices()
})

const dev = (name: string): QuickDevice => ({ type: 'DEVICE', id: `mock-${name}`, name })
const IED1 = dev('PDR1_LP1_IED1')
const IED2 = dev('PDR1_LP2_IED1')

const doc = (over: Partial<SldDoc> = {}): SldDoc => ({
  v: 1,
  canvas: { w: 800, h: 600, grid: 10 },
  nodes: [{ id: 'q1', symbol: 'breaker', x: 100, y: 100, rot: 0 }],
  buses: [],
  wires: [],
  labels: [{ id: 'l1', kind: 'value', x: 140, y: 120, pt: 'pl', attach: 'q1' }],
  ...over,
})
const content = (over: Partial<SldDoc> = {}): SldEditorContent => ({ doc: doc(over), bindings: {} })

describe('最近用过的设备', () => {
  it('最新的在最前、同一台去重、最多 6 台;没有 id 的不记', () => {
    for (let i = 0; i < 8; i++) rememberDevice('s', dev(`D${i}`))
    rememberDevice('s', dev('D5'))
    rememberDevice('s', { type: 'DEVICE', id: '', name: 'X' })
    const list = recentDevices('s').value.map(d => d.name)
    expect(list).toHaveLength(RECENT_MAX)
    expect(list.slice(0, 3)).toEqual(['D5', 'D7', 'D6'])
  })
  it('按站点分开;存在本机,重新打开还在', () => {
    rememberDevice('a', IED1)
    rememberDevice('b', IED2)
    resetRecentDevices()
    expect(recentDevices('a').value.map(d => d.name)).toEqual(['PDR1_LP1_IED1'])
    expect(recentDevices('b').value.map(d => d.name)).toEqual(['PDR1_LP2_IED1'])
  })
  it('浏览器存储不能用也不出错,只在内存里记', () => {
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota')
    })
    rememberDevice('s', IED1)
    expect(recentDevices('s').value).toHaveLength(1)
    spy.mockRestore()
  })
})

describe('点一行测点之后对草稿做的事', () => {
  const newId = (() => {
    let n = 0
    return () => `p${++n}`
  })()

  it('开关状态:写实时遥测绑定;节点没设备就写上这台;已有设备不改', () => {
    const c = content()
    quickBindState(c, 'q1', IED1, 'switch_state', newId)
    const n = c.doc.nodes[0]!
    expect(n.entity).toEqual({ type: 'DEVICE', name: 'PDR1_LP1_IED1' })
    expect(c.bindings[`pt.${n.state!.pt}`]).toEqual({
      mode: 'ts',
      entity: { type: 'DEVICE', id: 'mock-PDR1_LP1_IED1', name: 'PDR1_LP1_IED1' },
      key: 'switch_state',
    })
    quickBindState(c, 'q1', IED2, 'breaker_status', newId)
    expect(n.entity!.name).toBe('PDR1_LP1_IED1')
  })
  it('值映射按 key 带出(「分闸位置」1 = 分);自己改过的映射换测点时不动', () => {
    expect(stateMapForKey('分闸位置')).toEqual({ '1': 'open', '0': 'closed' })
    const c = content()
    quickBindState(c, 'q1', IED1, '分闸位置', newId)
    expect(c.doc.nodes[0]!.state!.map).toEqual({ '1': 'open', '0': 'closed' })
    quickBindState(c, 'q1', IED1, 'switch_state', newId)
    expect(c.doc.nodes[0]!.state!.map).toEqual({ '1': 'closed', '0': 'open' })
    c.doc.nodes[0]!.state!.map = { '2': 'closed', '1': 'open' }
    quickBindState(c, 'q1', IED1, '分闸位置', newId)
    expect(c.doc.nodes[0]!.state!.map).toEqual({ '2': 'closed', '1': 'open' })
  })
  it('数值标签:前缀 / 单位 / 小数位 / 相色按 key 带出;依附的节点没设备就写上', () => {
    expect(labelDefaultsForKey('Ia')).toEqual({ title: 'Ia', unit: 'A', digits: 1, color: 'a' })
    const c = content()
    quickBindLabel(c, 'l1', IED1, 'Ia', newId)
    expect(c.doc.labels[0]).toMatchObject({ title: 'Ia', color: 'a', format: { unit: 'A', digits: 1 } })
    expect(c.doc.nodes[0]!.entity?.name).toBe('PDR1_LP1_IED1')
  })
  it('换测点:还是自动带出的值跟着换,认不出的 key 清掉;自己改过的不动', () => {
    const c = content()
    quickBindLabel(c, 'l1', IED1, 'Ia', newId)
    quickBindLabel(c, 'l1', IED1, 'P', newId)
    expect(c.doc.labels[0]).toMatchObject({ title: 'P', format: { unit: 'kW', digits: 1 } })
    expect('color' in c.doc.labels[0]!).toBe(false)
    quickBindLabel(c, 'l1', IED1, 'humidity', newId)
    expect('title' in c.doc.labels[0]! || 'format' in c.doc.labels[0]!).toBe(false)
    const l = c.doc.labels[0]! as Extract<SldDoc['labels'][number], { kind: 'value' }>
    l.title = '有功'
    l.format = { unit: 'MW' }
    quickBindLabel(c, 'l1', IED1, 'P', newId)
    expect(c.doc.labels[0]).toMatchObject({ title: '有功', format: { unit: 'MW', digits: 1 } })
  })
  it('展开哪个列表:缺省第一个没绑的;显式收起 / 指定按用户的', () => {
    expect(openSlotOf(undefined, ['state', 'label:l1'])).toBe('state')
    expect(openSlotOf(undefined, [])).toBeNull()
    expect(openSlotOf(null, ['state'])).toBeNull()
    expect(openSlotOf('label:l1', ['state', 'label:l1'])).toBe('label:l1')
  })
})

/* ───────────── 面板 ───────────── */

function makeCtx(c: SldEditorContent, sel: Partial<SldSelection>): SldEditorContext {
  const cur = shallowRef(c)
  const counters: Record<string, number> = {}
  return {
    content: cur,
    selection: shallowRef({ ...emptySelection(), ...sel }),
    readonly: ref(false),
    apply(recipe) {
      const draft = JSON.parse(JSON.stringify(cur.value)) as SldEditorContent
      if (recipe(draft) === false) return false
      if (JSON.stringify(draft) === JSON.stringify(cur.value)) return false
      cur.value = draft
      return true
    },
    select() {},
    newId: kind => {
      counters[kind] = (counters[kind] ?? 100) + 1
      return `${kind}${counters[kind]}`
    },
    toCanvas: p => p,
    view: { zoom: ref(1), fit() {}, zoomBy() {}, resetZoom() {} },
    host: mockHost(),
  }
}
const mountPanel = (ctx: SldEditorContext) =>
  mount(BindingPanel, { global: { provide: { [SLD_EDITOR_CTX as symbol]: ctx, keyCn: () => '' } } })
const keysIn = (w: ReturnType<typeof mountPanel>, sec: string) =>
  w.findAll(`${sec} [data-role="qp-key"]`).map(b => b.attributes('data-key'))

describe('绑定面板的快速绑定', () => {
  it('节点没设备:沿用上一台,开关状态的测点直接列出来;点一行绑上,自动轮到下一个没绑的数值标签', async () => {
    rememberDevice('mock-site', IED1)
    const ctx = makeCtx(content(), { nodes: ['q1'] })
    const w = mountPanel(ctx)
    await flushPromises()
    expect(w.find('[data-sec="state"] [data-role="qp-device"]').text()).toContain('PDR1_LP1_IED1')
    expect(keysIn(w, '[data-sec="state"]')).toContain('switch_state')
    expect(w.find('[data-sec="labels"] [data-role="quick-picker"]').exists()).toBe(false)

    await w.find('[data-sec="state"] [data-role="qp-key"][data-key="switch_state"]').trigger('click')
    await flushPromises()
    const n = ctx.content.value.doc.nodes[0]!
    expect(n.entity?.name).toBe('PDR1_LP1_IED1')
    expect(n.state).toBeTruthy()
    // 开关状态绑好了:列表收起,轮到数值标签
    expect(w.find('[data-sec="state"] [data-role="quick-picker"]').exists()).toBe(false)
    expect(keysIn(w, '[data-sec="labels"]')).toContain('P')

    await w.find('[data-sec="labels"] [data-role="qp-key"][data-key="P"]').trigger('click')
    await flushPromises()
    expect(ctx.content.value.doc.labels[0]).toMatchObject({ title: 'P', format: { unit: 'kW' } })
    expect(w.find('[data-role="quick-picker"]').exists()).toBe(false)
  })

  it('节点有设备:列的是它自己的设备,不是上一台;可以搜', async () => {
    rememberDevice('mock-site', IED1)
    const c = content()
    c.doc.nodes[0]!.entity = { type: 'DEVICE', name: 'PDR1_METER1' }
    const w = mountPanel(makeCtx(c, { nodes: ['q1'] }))
    await flushPromises()
    expect(w.find('[data-sec="state"] [data-role="qp-device"]').text()).toContain('PDR1_METER1')
    await w.find('[data-sec="state"] [data-role="qp-search"]').setValue('u')
    expect(keysIn(w, '[data-sec="state"]')).toEqual(['Ua', 'Ub', 'Uc'])
  })

  it('一台都没用过:列表里先让选设备(设备树直接展开);「沿用上一台」按钮要有最近设备才出现', async () => {
    const w = mountPanel(makeCtx(content(), { nodes: ['q1'] }))
    await flushPromises()
    expect(w.find('[data-sec="state"] [data-role="qp-device"]').text()).toContain('先选一台设备')
    expect(w.find('[data-sec="state"] [data-role="qp-menu"]').exists()).toBe(true)
    expect(w.find('[data-role="use-recent-entity"]').exists()).toBe(false)
  })

  it('「沿用上一台」一键写上节点设备,并记进最近设备', async () => {
    rememberDevice('mock-site', IED2)
    const ctx = makeCtx(content(), { nodes: ['q1'] })
    const w = mountPanel(ctx)
    await w.find('[data-role="use-recent-entity"]').trigger('click')
    expect(ctx.content.value.doc.nodes[0]!.entity).toEqual({ type: 'DEVICE', name: 'PDR1_LP2_IED1' })
  })

  it('已绑的测点:列表收着,点「换测点」展开,当前测点高亮;原来的 BindingRow 照常在', async () => {
    const c = content()
    quickBindState(c, 'q1', IED1, 'switch_state', () => 'ps')
    quickBindLabel(c, 'l1', IED1, 'P', () => 'pl2')
    const w = mountPanel(makeCtx(c, { nodes: ['q1'] }))
    await flushPromises()
    expect(w.find('[data-role="quick-picker"]').exists()).toBe(false)
    expect(w.find('[data-sec="state"] .br').exists()).toBe(true)
    await w.find('[data-sec="state"] [data-role="qp-toggle"]').trigger('click')
    await flushPromises()
    expect(w.find('[data-sec="state"] .sld-qp-row.on').attributes('data-key')).toBe('switch_state')
  })
})
