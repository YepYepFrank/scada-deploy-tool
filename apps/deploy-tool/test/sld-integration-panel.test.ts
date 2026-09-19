// T5.8 绑定面板对接线图组件:pt.* 不逐条列,只给摘要 + 「编辑接线图…」;静态槽位 alarms 照常;改 alarms 不丢 pt.*。
import { describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'

vi.mock('echarts/core', () => ({
  init: () => ({ setOption: vi.fn(), resize: vi.fn(), dispose: vi.fn() }),
  use: () => {},
  color: { modifyAlpha: (c: string) => c },
  graphic: { LinearGradient: class {} },
}))
vi.mock('echarts/charts', () => ({ LineChart: {}, BarChart: {}, GaugeChart: {} }))
vi.mock('echarts/components', () => ({ GridComponent: {}, TooltipComponent: {}, LegendComponent: {} }))
vi.mock('echarts/renderers', () => ({ CanvasRenderer: {} }))

import { getWidget, registerBuiltins, type Binding, type WidgetConfig } from '@grid/scada-renderer'
import BindingsPanel from '../src/editor/BindingsPanel.vue'

registerBuiltins()

const pt = (k: string): Binding => ({ mode: 'ts', entity: { type: 'DEVICE', id: '', name: 'D' }, key: k })

describe('BindingsPanel × sld', () => {
  it('摘要一行 + 按钮;pt.* 不出行;alarms 照常', async () => {
    const bindings: WidgetConfig['bindings'] = {}
    for (let i = 0; i < 250; i += 1) bindings[`pt.p${i}`] = pt(`k${i}`)
    const widget: WidgetConfig = { id: 'w_s', slot: 'c11', type: 'sld', props: {}, bindings }
    const w = mount(BindingsPanel, { props: { def: getWidget('sld')!, widget, tree: null, client: null } })
    expect(w.find('[data-role="sld-points"]').text()).toContain('测点绑定 250 条,在接线图编辑器里维护')
    expect(w.findAll('.bp-slot').map(s => s.attributes('data-slot'))).toEqual(['alarms'])
    await w.find('[data-role="sld-points"] [data-role="edit-sld"]').trigger('click')
    expect(w.emitted('edit-sld')).toHaveLength(1)

    // 在 alarms 上加一条:emit 的整份 bindings 仍带着全部 pt.*
    await w.find('[data-slot="alarms"] .bp-add').trigger('click')
    const next = w.emitted('update')!.at(-1)![0] as WidgetConfig['bindings']
    expect(Object.keys(next).filter(k => k.startsWith('pt.'))).toHaveLength(250)
    expect(next.alarms).toHaveLength(1)
  })

  it('没有动态 pt.* 槽位的组件不显示摘要', () => {
    const widget: WidgetConfig = { id: 'n', slot: 's1', type: 'number-card', props: {}, bindings: {} }
    const w = mount(BindingsPanel, { props: { def: getWidget('number-card')!, widget, tree: null, client: null } })
    expect(w.find('[data-role="sld-points"]').exists()).toBe(false)
  })
})
