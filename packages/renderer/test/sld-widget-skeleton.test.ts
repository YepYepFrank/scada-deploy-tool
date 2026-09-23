// T5.0:sld 骨架组件——注册、动态槽位校验、设计态占位、静态画图、开关按测点值取分合
import { beforeEach, describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import {
  ScadaWidget,
  registerBuiltins,
  resetRegistry,
  validateWidgetAgainstRegistry,
  sldWidget,
  type SldDoc,
  type WidgetConfig,
} from '../src'

const doc: SldDoc = {
  v: 1,
  canvas: { w: 400, h: 300, grid: 10 },
  nodes: [
    {
      id: 'qf1',
      symbol: 'breaker',
      x: 100,
      y: 60,
      rot: 0,
      entity: { type: 'DEVICE', name: 'PDR1_LP1_IED1' },
      state: { pt: 'p1', map: { '1': 'closed', '0': 'open' } },
    },
    { id: 'm1', symbol: 'meter', x: 100, y: 160, rot: 0 },
  ],
  buses: [{ id: 'b1', x1: 40, y1: 40, x2: 360, y2: 40 }],
  wires: [
    { id: 'w1', from: { bus: 'b1', d: 80 }, to: { node: 'qf1', port: 'a' } },
    { id: 'w2', from: { node: 'qf1', port: 'b' }, to: { node: 'm1', port: 'a' } },
  ],
  labels: [
    { id: 'l1', x: 150, y: 170, kind: 'value', pt: 'p2', title: 'P', format: { digits: 1, unit: 'kW' } },
    { id: 'l2', x: 40, y: 20, kind: 'text', text: '10kV I 段' },
  ],
}
const cfg = (state: unknown): WidgetConfig => ({
  id: 'w_sld',
  slot: 'main',
  type: 'sld',
  props: { doc },
  bindings: {
    'pt.p1': { mode: 'const', value: state },
    'pt.p2': { mode: 'const', value: 12.34 },
  },
})

describe('sld 骨架组件', () => {
  beforeEach(() => {
    resetRegistry()
    registerBuiltins()
  })

  it('pt.* 动态槽位通过注册表校验;数组绑定被拦', () => {
    expect(validateWidgetAgainstRegistry(cfg(1))).toEqual([])
    const bad = cfg(1)
    bad.bindings['pt.p1'] = [{ mode: 'const', value: 1 }]
    expect(validateWidgetAgainstRegistry(bad).some(i => i.level === 'error')).toBe(true)
  })

  it('设计态按已绑定的 pt.* 出占位值', () => {
    const s = sldWidget.sampleData!(cfg(0))
    expect(Object.keys(s).sort()).toEqual(['alarms', 'pt.p1', 'pt.p2'])
  })

  it('画出母线 / 连线 / 图元 / 标签;开关随测点值分合', async () => {
    const closed = mount(ScadaWidget, { props: { config: cfg(1), design: true } })
    await nextTick() // 值在 onMounted 里建立
    expect(closed.findAll('.sr-sld-bus')).toHaveLength(1)
    expect(closed.findAll('.sr-sld-wire')).toHaveLength(2)
    expect(closed.findAll('.sr-sld-node')).toHaveLength(2)
    expect(closed.find('[data-id="qf1"] .sr-sld-symbol').attributes('data-state')).toBe('closed')
    expect(closed.find('[data-id="l1"]').attributes('aria-label')).toBe('P 12.3 kW')
    const open = mount(ScadaWidget, { props: { config: cfg(0), design: true } })
    await nextTick()
    expect(open.find('[data-id="qf1"] .sr-sld-symbol').attributes('data-state')).toBe('open')
    const unknown = mount(ScadaWidget, { props: { config: cfg(7), design: true } })
    await nextTick()
    expect(unknown.find('[data-id="qf1"] .sr-sld-symbol').attributes('data-state')).toBe('unknown')
  })

  it('没有图时给提示,不报错', () => {
    const w = mount(ScadaWidget, { props: { config: { ...cfg(1), props: {} }, design: true } })
    expect(w.text()).toContain('未绘制接线图')
  })
})
