// T5.3 性能:100 个间隔(301 节点 / 301 连线 / 400 个测点)。不设耗时硬阈值(机器差异大),只防意外的 O(n²) 与全量重算:
// - 连线折线只在 doc 变化时算:wirePoints 调用次数 = 连线数,值变化不再调用;
// - 带电计算只依赖开关三态:数值标签变化不重算,开关变位才重算一次;
// - 一个数值标签变化只重渲染那一个标签,节点一个都不重渲染。
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { defineComponent, h, nextTick, reactive, type ComponentPublicInstance } from 'vue'

const spies = vi.hoisted(() => ({ wirePoints: 0, energize: 0 }))
vi.mock('../src/sld/model/geometry', async orig => {
  const m = await orig<typeof import('../src/sld/model/geometry')>()
  return {
    ...m,
    wirePoints: (...a: Parameters<typeof m.wirePoints>) => {
      spies.wirePoints++
      return m.wirePoints(...a)
    },
  }
})
vi.mock('../src/sld/model/topology', async orig => {
  const m = await orig<typeof import('../src/sld/model/topology')>()
  return {
    ...m,
    energize: (...a: Parameters<typeof m.energize>) => {
      spies.energize++
      return m.energize(...a)
    },
  }
})

import { registerBuiltinSldSymbols, type SldDoc, type SldLabel, type SldNode, type SldWire } from '../src'
import SldWidget from '../src/widgets/sld/SldWidget.vue'

function bigDoc(bays: number): SldDoc {
  const nodes: SldNode[] = [{ id: 'src', symbol: 'grid-source', x: 20, y: 0, rot: 0, source: { kv: 10 } }]
  const wires: SldWire[] = [{ id: 'w_src', from: { node: 'src', port: 'a' }, to: { bus: 'b1', d: 0 } }]
  const labels: SldLabel[] = []
  for (let i = 0; i < bays; i++) {
    const x = 40 + i * 60
    nodes.push(
      {
        id: `qf${i}`,
        symbol: 'breaker',
        x,
        y: 140,
        rot: 0,
        name: `QF${i}`,
        entity: { type: 'DEVICE', name: `DEV_${i}` },
        state: { pt: `s${i}`, map: { '1': 'closed', '0': 'open' } },
      },
      { id: `ct${i}`, symbol: 'ct', x, y: 240, rot: 0 },
      { id: `ld${i}`, symbol: 'load', x, y: 320, rot: 0 }
    )
    wires.push(
      { id: `wa${i}`, from: { bus: 'b1', d: x } /* 端口 x + 20,母线从 20 起 */, to: { node: `qf${i}`, port: 'a' } },
      { id: `wb${i}`, from: { node: `qf${i}`, port: 'b' }, to: { node: `ct${i}`, port: 'a' } },
      { id: `wc${i}`, from: { node: `ct${i}`, port: 'b' }, to: { node: `ld${i}`, port: 'a' } }
    )
    for (const [k, t, u] of [
      ['p', 'P', 'kW'],
      ['q', 'Q', 'kvar'],
      ['i', 'I', 'A'],
    ] as const)
      labels.push({
        id: `l${k}${i}`,
        x: x + 30,
        y: 380 + (labels.length % 3) * 14,
        kind: 'value',
        pt: `${k}${i}`,
        title: t,
        format: { unit: u },
      })
  }
  return {
    v: 1,
    canvas: { w: 60 * bays + 80, h: 440, grid: 10 },
    nodes,
    buses: [{ id: 'b1', x1: 20, y1: 100, x2: 60 * bays + 40, y2: 100, kv: 10 }],
    wires,
    labels,
  }
}

beforeEach(() => {
  registerBuiltinSldSymbols()
  spies.wirePoints = 0
  spies.energize = 0
})

describe('100 个间隔的图', () => {
  it('mount 耗时打印;值变化不重算几何;标签变化不重算带电、不重渲染节点', async () => {
    const doc = bigDoc(100)
    const values = reactive<Record<string, unknown>>({})
    const ts = Date.now()
    for (let i = 0; i < 100; i++) {
      values[`pt.s${i}`] = { v: 1, ts }
      for (const k of ['p', 'q', 'i']) values[`pt.${k}${i}`] = { v: i, ts }
    }
    expect(doc.nodes).toHaveLength(301)
    expect(Object.keys(values)).toHaveLength(400)

    const updated: Record<string, number> = {}
    const counter = {
      updated(this: ComponentPublicInstance) {
        const name = (this.$ as unknown as { type: { __name?: string } }).type.__name ?? '?'
        updated[name] = (updated[name] ?? 0) + 1
      },
    }
    const Host = defineComponent({
      setup: () => () => h('div', { class: 'sr-page' }, [h(SldWidget, { doc, values, staleSeconds: 0 })]),
    })
    const t0 = performance.now()
    const w = mount(Host, { global: { mixins: [counter] } })
    await nextTick()
    const ms = performance.now() - t0
    console.log(
      `[sld perf] 100 间隔(${doc.nodes.length} 节点 / ${doc.wires.length} 连线 / 400 测点)mount ${ms.toFixed(1)} ms`
    )

    expect(w.findAll('.sr-sld-node')).toHaveLength(301)
    expect(w.findAll('.sr-sld-wire')).toHaveLength(doc.wires.length)
    expect(spies.wirePoints).toBe(doc.wires.length)
    expect(spies.energize).toBe(1)

    // 一个数值标签变化
    values['pt.p5'] = { v: 999, ts: ts + 1 }
    await nextTick()
    // 数值标签缺省是数码框(2026-09-23),数码管是 path,读数挂在 aria-label 上
    expect(w.find('[data-id="lp5"]').attributes('aria-label')).toContain('999.0')
    expect(spies.wirePoints).toBe(doc.wires.length)
    expect(spies.energize).toBe(1)
    expect(updated.SldNodeView ?? 0).toBe(0)
    expect(updated.SldScene ?? 0).toBe(0)
    expect(updated.SldLabelView).toBe(1)

    // 状态测点重推同一个值(ts 变了):三态不变 → 不重算
    values['pt.s3'] = { v: 1, ts: ts + 2 }
    await nextTick()
    expect(spies.energize).toBe(1)

    // 开关变位:带电重算一次,几何仍不重算;只有受影响的节点重渲染
    values['pt.s7'] = { v: 0, ts: ts + 3 }
    await nextTick()
    expect(spies.energize).toBe(2)
    expect(spies.wirePoints).toBe(doc.wires.length)
    expect(w.find('.sr-sld-node[data-id="ld7"] .sr-sld-node-symbol').classes()).toContain('sr-sld-e-dead')
    expect(updated.SldNodeView).toBeLessThanOrEqual(3) // qf7(state + 着色)、ct7、ld7
    w.unmount()
  })
})
