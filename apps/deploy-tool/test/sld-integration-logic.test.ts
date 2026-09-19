// T5.8 接线图接入第 4 步编辑器:纯函数(拆分 / 合并 pt.* 绑定、剥离底图)与 useEditorState 层面的一次性写回。
import { describe, expect, it } from 'vitest'
import type { Binding, PageConfig, SldLabel, SldNode, SldWire, WidgetConfig } from '@grid/scada-renderer'
import { emptySldDoc, sldWidget } from '@grid/scada-renderer'
import type { SldEditorContent } from '../src/sld-editor/ext'
import { useEditorState } from '../src/editor/useEditorState'
import {
  applySldContent,
  countSldPoints,
  mergeSldBindings,
  sameSldContent,
  sldContentOf,
  sldDocKey,
  splitSldBindings,
  stripSldBackground,
} from '../src/editor/sld-integration'

const ts = (name: string, key: string): Binding => ({ mode: 'ts', entity: { type: 'DEVICE', id: '', name }, key })
const alarm: Binding = { mode: 'alarm', entity: { type: 'ASSET', id: '', name: 'site' } } as Binding

/** 按节点数生成一张大图(每间隔 3 节点 / 3 连线 / 2 标签 / 2 测点) */
function bigContent(nodes: number): SldEditorContent {
  const bays = Math.ceil(nodes / 3)
  const ns: SldNode[] = []
  const ws: SldWire[] = []
  const ls: SldLabel[] = []
  const bindings: Record<string, Binding> = {}
  for (let i = 0; i < bays; i += 1) {
    const x = 100 + i * 60
    const dev = `PDR1_LP${i + 1}_IED1`
    const [brk, meter, junction] = [`n${i * 3 + 1}`, `n${i * 3 + 2}`, `n${i * 3 + 3}`]
    ns.push(
      {
        id: brk,
        symbol: 'breaker',
        x,
        y: 160,
        rot: 0,
        name: `${i + 1}# 出线断路器`,
        entity: { type: 'DEVICE', name: dev },
        state: { pt: `p${i * 2 + 1}`, map: { '1': 'closed', '0': 'open' } },
      },
      { id: meter, symbol: 'meter', x, y: 260, rot: 0, name: `${i + 1}# 电表`, entity: { type: 'DEVICE', name: dev } },
      { id: junction, symbol: 'junction', x: x + 10, y: 340, rot: 0 }
    )
    ws.push(
      { id: `w${i * 3 + 1}`, from: { bus: 'b1', d: 40 + i * 60 }, to: { node: brk, port: 'a' } },
      { id: `w${i * 3 + 2}`, from: { node: brk, port: 'b' }, to: { node: meter, port: 'a' } },
      { id: `w${i * 3 + 3}`, from: { node: meter, port: 'b' }, to: { node: junction, port: 'n' } }
    )
    ls.push(
      { id: `l${i * 2 + 1}`, kind: 'text', x, y: 130, text: `${i + 1}# 出线`, attach: brk },
      { id: `l${i * 2 + 2}`, kind: 'value', x: x + 30, y: 270, pt: `p${i * 2 + 2}`, title: 'P', attach: meter }
    )
    bindings[`pt.p${i * 2 + 1}`] = ts(dev, 'breaker_status')
    bindings[`pt.p${i * 2 + 2}`] = ts(dev, 'active_power_total')
  }
  return {
    doc: {
      v: 1,
      canvas: { w: 200 + bays * 60, h: 900, grid: 10 },
      nodes: ns,
      buses: [{ id: 'b1', x1: 60, y1: 100, x2: 140 + bays * 60, y2: 100 }],
      wires: ws,
      labels: ls,
    },
    bindings,
  }
}

const sldW = (extra: Partial<WidgetConfig> = {}): WidgetConfig => ({
  id: 'w_sld',
  slot: 'c11',
  type: 'sld',
  props: { doc: emptySldDoc(), staleSeconds: 600 },
  bindings: {},
  ...extra,
})

describe('splitSldBindings / mergeSldBindings', () => {
  const original: WidgetConfig['bindings'] = {
    alarms: [alarm],
    'pt.p1': ts('A', 'k1'),
    'pt.p2': ts('A', 'k2'),
  }

  it('拆成 pt.* 与其余槽位,不改输入', () => {
    const before = JSON.stringify(original)
    const { points, rest } = splitSldBindings(original)
    expect(Object.keys(points)).toEqual(['pt.p1', 'pt.p2'])
    expect(rest).toEqual({ alarms: [alarm] })
    expect(JSON.stringify(original)).toBe(before)
    expect(splitSldBindings(undefined)).toEqual({ points: {}, rest: {} })
  })

  it('动态槽位误写成数组:取第一条,空数组丢弃', () => {
    const { points } = splitSldBindings({ 'pt.a': [ts('A', 'x'), ts('A', 'y')], 'pt.b': [] })
    expect(points).toEqual({ 'pt.a': ts('A', 'x') })
  })

  it('合并:保留非 pt.*,pt.* 以编辑器给的为准,删掉的不残留', () => {
    const merged = mergeSldBindings(original, { 'pt.p2': ts('B', 'k2'), 'pt.p3': ts('B', 'k3') })
    expect(merged).toEqual({ alarms: [alarm], 'pt.p2': ts('B', 'k2'), 'pt.p3': ts('B', 'k3') })
    expect('pt.p1' in merged).toBe(false)
    // 全删
    expect(mergeSldBindings(original, {})).toEqual({ alarms: [alarm] })
  })

  it('编辑器给的非 pt.* 键被忽略,不会覆盖静态槽位', () => {
    const merged = mergeSldBindings(original, { alarms: ts('X', 'bad'), 'pt.p1': ts('A', 'k1') } as never)
    expect(merged.alarms).toEqual([alarm])
  })

  it('countSldPoints / sldDocKey', () => {
    expect(countSldPoints(original)).toBe(2)
    expect(countSldPoints(undefined)).toBe(0)
    expect(sldDocKey(sldWidget)).toBe('doc')
    expect(sldDocKey({ propsSchema: { type: 'object', properties: { a: { type: 'string' } } } })).toBeNull()
  })
})

describe('sldContentOf / sameSldContent / applySldContent', () => {
  it('打开:doc 深拷贝 + 只带 pt.*;没有图给空图', () => {
    const c = bigContent(3)
    const w = sldW({ props: { doc: c.doc }, bindings: { ...c.bindings, alarms: [alarm] } })
    const content = sldContentOf(w, 'doc')
    expect(content.doc).toEqual(c.doc)
    expect(content.doc).not.toBe(c.doc)
    expect(Object.keys(content.bindings).every(k => k.startsWith('pt.'))).toBe(true)
    expect(Object.keys(content.bindings)).toHaveLength(2)
    expect(sldContentOf(sldW({ props: {} }), 'doc').doc).toEqual(emptySldDoc())
    expect(sldContentOf(sldW({ props: { doc: 'junk' } }), 'doc').doc).toEqual(emptySldDoc())
  })

  it('sameSldContent 按内容比', () => {
    const a = bigContent(6)
    expect(sameSldContent(a, JSON.parse(JSON.stringify(a)) as SldEditorContent)).toBe(true)
    const b = JSON.parse(JSON.stringify(a)) as SldEditorContent
    b.doc.nodes[0]!.x += 10
    expect(sameSldContent(a, b)).toBe(false)
    const c = JSON.parse(JSON.stringify(a)) as SldEditorContent
    delete c.bindings['pt.p1']
    expect(sameSldContent(a, c)).toBe(false)
  })

  it('applySldContent 写 props[key] 与 bindings,其余 props 不动', () => {
    const w = sldW({ bindings: { alarms: [alarm], 'pt.old': ts('A', 'o') } })
    const c = bigContent(3)
    applySldContent(w, 'doc', c)
    expect(w.props.doc).toBe(c.doc)
    expect(w.props.staleSeconds).toBe(600)
    expect(Object.keys(w.bindings).sort()).toEqual(['alarms', 'pt.p1', 'pt.p2'])
  })
})

describe('stripSldBackground(ADR-005 D10)', () => {
  const bg = { src: 'data:image/png;base64,AAAA', opacity: 0.4 }
  const page = (widgets: WidgetConfig[]): PageConfig => ({ schemaVersion: 1, template: 'grid-3x3', widgets })

  it('没有底图:原样返回同一引用', () => {
    const p = page([sldW(), { id: 'w2', slot: 'c12', type: 'number-card', props: {}, bindings: {} }])
    expect(stripSldBackground(p)).toBe(p)
  })

  it('剥掉 sld 的 background,不改输入;没动的组件沿用引用', () => {
    const other: WidgetConfig = {
      id: 'w2',
      slot: 'c12',
      type: 'image',
      props: { doc: { nodes: [], background: bg } },
      bindings: {},
    }
    const sld = sldW({ props: { doc: { ...emptySldDoc(), background: bg }, staleSeconds: 30 } })
    const p = page([sld, other])
    const before = JSON.stringify(p)
    const out = stripSldBackground(p)
    expect(out).not.toBe(p)
    expect(JSON.stringify(p)).toBe(before)
    const outSld = out.widgets[0]!
    expect((outSld.props.doc as Record<string, unknown>).background).toBeUndefined()
    expect(outSld.props.doc).toEqual(emptySldDoc())
    expect(outSld.props.staleSeconds).toBe(30)
    expect(outSld.bindings).toBe(sld.bindings)
    // 只动 sld 组件
    expect(out.widgets[1]).toBe(other)
  })
})

describe('useEditorState 层面的一次性写回', () => {
  const init = (w: WidgetConfig): ReturnType<typeof useEditorState> =>
    useEditorState({ schemaVersion: 1, template: 'grid-3x3', title: 't', widgets: [w] })

  it('关闭时一次 commit:doc 与 pt.* 写回,删掉的 pt.* 不残留;撤销一步回到原样', () => {
    const ed = init(sldW({ bindings: { alarms: [alarm], 'pt.gone': ts('A', 'g') } }))
    const before = ed.snapshot()
    const c = bigContent(30)
    ed.patchWidget('w_sld', w => applySldContent(w, 'doc', c))
    expect(ed.state.pastCount).toBe(1)
    const w = ed.config.value.widgets[0]!
    expect(w.props.doc).toEqual(c.doc)
    expect(countSldPoints(w.bindings)).toBe(20)
    expect(w.bindings['pt.gone']).toBeUndefined()
    expect(w.bindings.alarms).toEqual([alarm])
    ed.undo()
    expect(ed.config.value).toEqual(before)
  })

  it('测量:300 节点的图,一次 commit 的耗时(> 30 ms 才需要改 useEditorState)', () => {
    const c = bigContent(300)
    const ed = init(sldW())
    const kb = JSON.stringify(c).length / 1024
    const times: number[] = []
    for (let i = 0; i < 55; i += 1) {
      const t0 = performance.now()
      ed.patchWidget('w_sld', w => applySldContent(w, 'doc', c))
      times.push(performance.now() - t0)
    }
    times.sort((a, b) => a - b)
    const median = times[Math.floor(times.length / 2)]!
    console.log(`[T5.8] 300 节点 ${kb.toFixed(0)} KB,撤销栈满 50 层时 commit 中位 ${median.toFixed(1)} ms`)
    expect(ed.state.pastCount).toBe(50)
    // 宽松上限只防回归到离谱的量级(CI 机器慢);实测见交付说明
    expect(median).toBeLessThan(200)
  })
})
