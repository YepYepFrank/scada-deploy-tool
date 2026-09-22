/**
 * 一次接线图 · 2026-09-22 现场反馈的六项(渲染器侧五项;「右栏可拖」纯编辑器,不在这):
 * ① 图元自定义描边色(电流互感器这类原来只能跟着带电色走),失电照样变灰;
 * ② 设备框自由改宽高(freeBody):按实际宽高重画而不是拉伸,端口仍落栅格;
 * ③ 分组框边框颜色 / 粗细 / 虚实;
 * ④ 数值标签三列对齐(colW):前缀左对齐、数字右对齐、单位跟其后;
 * ⑤ 开关没数据时按 state.fallback 画(现场很多回路没有位置信号,整张图全是虚线)。
 * 旧图零改动:不配这些字段时渲染结果与 0.9.0 一致。
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { ref } from 'vue'
import {
  SldSymbol,
  designSwitchState,
  freeSizeStep,
  getSldSymbol,
  isFreeSizeSymbol,
  isValidFreeSize,
  nodeBoxSize,
  portPosition,
  registerBuiltins,
  resetRegistry,
  resolveSwitchState,
  snapFreeSize,
  validateSldDoc,
  type SldDoc,
  type SldNode,
} from '../src/index'
import SldLabelView from '../src/widgets/sld/SldLabelView.vue'
import { SLD_CONTEXT_KEY } from '../src/widgets/sld/context'
import SldNodeView from '../src/widgets/sld/SldNodeView.vue'
import SldScene from '../src/widgets/sld/SldScene.vue'

beforeEach(() => {
  resetRegistry()
  registerBuiltins()
})

const boxNode = (over: Partial<SldNode> = {}): SldNode => ({
  id: 'n1',
  symbol: 'device-box',
  x: 100,
  y: 100,
  rot: 0,
  ...over,
})
const doc = (over: Partial<SldDoc> = {}): SldDoc => ({
  v: 1,
  canvas: { w: 800, h: 600, grid: 10 },
  nodes: [],
  buses: [],
  wires: [],
  labels: [],
  ...over,
})

describe('① 图元自定义描边色', () => {
  const paintOf = (node: SldNode, props: Record<string, unknown> = {}) => {
    const w = mount(SldNodeView, { props: { node, ...props } })
    return (w.find('.sr-sld-node-symbol').attributes('style') ?? '').replace(/\s/g, '')
  }
  it('node.color 盖过带电着色传来的电压等级色', () => {
    expect(paintOf(boxNode({ color: '#ff8800' }), { color: '#19b7ff', energyClass: 'sr-sld-e-live' })).toContain(
      'color:#ff8800'
    )
  })
  it('没设 color 时照旧用带电着色的颜色', () => {
    expect(paintOf(boxNode(), { color: '#19b7ff', energyClass: 'sr-sld-e-live' })).toContain('color:#19b7ff')
  })
  it('失电时颜色仍在(靠 .sr-sld-e-dead 的 opacity 变暗),不像母线那样整根变灰', () => {
    const w = mount(SldNodeView, { props: { node: boxNode({ color: '#ff8800' }), energyClass: 'sr-sld-e-dead' } })
    const g = w.find('.sr-sld-node-symbol')
    expect(g.attributes('style')?.replace(/\s/g, '')).toContain('color:#ff8800')
    expect(g.classes()).toContain('sr-sld-e-dead')
  })
  it('没设 color 的失电图元照旧不下发颜色,整个交给样式', () => {
    expect(paintOf(boxNode(), { energyClass: 'sr-sld-e-dead' })).toBe('')
  })
})

describe('② 设备框自由改宽高', () => {
  const def = () => getSldSymbol('device-box')!

  it('只有 freeBody 图元能自由改宽高', () => {
    expect(isFreeSizeSymbol(def())).toBe(true)
    expect(isFreeSizeSymbol(getSldSymbol('breaker'))).toBe(false)
  })

  it('步长按「端口仍落栅格」算:设备框端口在边中点 → 宽高各 2 格一步', () => {
    expect(freeSizeStep(def(), 10)).toEqual({ w: 20, h: 20 })
    expect(snapFreeSize(def(), 231, 47, 10)).toEqual({ w: 240, h: 40 })
    // 至少一步,不会吸成 0
    expect(snapFreeSize(def(), 1, 1, 10)).toEqual({ w: 20, h: 20 })
    expect(isValidFreeSize(def(), { w: 240, h: 60 }, 10)).toBe(true)
    expect(isValidFreeSize(def(), { w: 230, h: 60 }, 10)).toBe(false)
  })

  it('包围盒与端口按宽高各自缩放,端口还在四边中点且落栅格', () => {
    const n = boxNode({ size: { w: 240, h: 60 } })
    expect(nodeBoxSize(n, def())).toEqual({ w: 240, h: 60 })
    expect(portPosition(n, def(), 'n')).toEqual({ x: 100 + 120, y: 100 })
    expect(portPosition(n, def(), 'e')).toEqual({ x: 100 + 240, y: 100 + 30 })
    expect(portPosition(n, def(), 's')).toEqual({ x: 100 + 120, y: 100 + 60 })
    expect(portPosition(n, def(), 'w')).toEqual({ x: 100, y: 100 + 30 })
  })

  it('转 90° 后包围盒换个儿,端口跟着转', () => {
    const n = boxNode({ rot: 90, size: { w: 240, h: 60 } })
    expect(nodeBoxSize(n, def())).toEqual({ w: 60, h: 240 })
    // 局部 (w/2, 0) 的 n 口转 90° 到右边中点
    expect(portPosition(n, def(), 'n')).toEqual({ x: 100 + 60, y: 100 + 120 })
  })

  it('图形按实际宽高**重画**,不是拉伸 —— 所以 <rect> 是 240×60 而外层没有 scale 变换', () => {
    const w = mount(SldSymbol, { props: { symbol: 'device-box', size: { w: 240, h: 60 } } })
    const html = w.html()
    expect(html).toContain('width="240"')
    expect(html).toContain('height="60"')
    expect(html).not.toContain('scale(')
  })

  it('等比放大仍走 scale 变换,线宽一起放大(0.7.0 起的老行为不变)', () => {
    const w = mount(SldSymbol, { props: { symbol: 'device-box', scale: 2 } })
    expect(w.html()).toContain('scale(2 2)')
  })

  it('非 freeBody 图元给了 size 也不认;校验层报 bad-size', () => {
    const bad = doc({ nodes: [{ id: 'n1', symbol: 'breaker', x: 100, y: 100, rot: 0, size: { w: 80, h: 40 } }] })
    expect(validateSldDoc(bad, getSldSymbol).some(i => i.code === 'bad-size')).toBe(true)
    const off = doc({ nodes: [boxNode({ size: { w: 230, h: 60 } })] })
    expect(validateSldDoc(off, getSldSymbol).some(i => i.code === 'bad-size')).toBe(true)
    const ok = doc({ nodes: [boxNode({ size: { w: 240, h: 60 } })] })
    expect(validateSldDoc(ok, getSldSymbol).some(i => i.code === 'bad-size')).toBe(false)
  })
})

describe('③ 分组框边框', () => {
  const frameHtml = (frame: Record<string, unknown>) => {
    const w = mount(SldScene, {
      props: {
        doc: doc({ frames: [{ id: 'f1', x: 0, y: 0, w: 200, h: 100, ...frame }] }),
        nodeStates: {},
        energy: null,
        kvColors: [],
        alarms: new Map(),
        showNames: true,
        clickable: false,
      },
    })
    return w.find('.sr-sld-frame rect').attributes()
  }
  it('颜色 / 粗细写到 rect 上;实线时 dasharray 关掉', () => {
    const a = frameHtml({ color: '#ff8800', width: 3, solid: true })
    expect(a.stroke).toBe('#ff8800')
    expect(a['stroke-width']).toBe('3')
    expect(a['stroke-dasharray']).toBe('none')
  })
  it('什么都不配时不下发属性,走主题样式(虚线淡蓝)', () => {
    const b = frameHtml({})
    expect(b.stroke).toBeUndefined()
    expect(b['stroke-width']).toBeUndefined()
    expect(b['stroke-dasharray']).toBeUndefined()
  })
})

describe('④ 数值标签三列对齐', () => {
  /** 给标签喂一个真值:没数据时连单位都不画(formatSldValue 的既有约定) */
  const withValue = {
    global: {
      provide: {
        [SLD_CONTEXT_KEY as symbol]: {
          values: () => ({ 'pt.p1': { v: 388.7, ts: 1000 } }),
          errors: () => ({}),
          now: ref(1000),
          staleMs: ref(undefined),
        },
      },
    },
  }
  const label = (over: Record<string, unknown> = {}) => ({
    id: 'l1',
    kind: 'value' as const,
    x: 50,
    y: 20,
    pt: 'p1',
    title: 'Uab',
    format: { unit: 'V' },
    ...over,
  })
  it('配了 colW:数字右对齐到 x + colW,单位跟其后左对齐', () => {
    const w = mount(SldLabelView, { props: { label: label({ colW: 60 }) }, ...withValue })
    const num = w.find('.sr-sld-label-num')
    expect(num.text()).toBe('388.7')
    const unit = w.find('.sr-sld-label-unit')
    expect(num.attributes('x')).toBe('110')
    expect(num.attributes('text-anchor')).toBe('end')
    expect(Number(unit.attributes('x'))).toBeGreaterThan(110)
    expect(unit.attributes('text-anchor')).toBe('start')
    // 前缀不再自己补空格(空格由列宽让出来)
    expect(w.find('.sr-sld-label-title').text()).toBe('Uab')
  })
  it('前缀长短不同的两个标签,数字列对齐到同一个 x', () => {
    const a = mount(SldLabelView, { props: { label: label({ title: 'Uab', colW: 60 }) }, ...withValue })
    const b = mount(SldLabelView, { props: { label: label({ id: 'l2', title: 'P', colW: 60 }) }, ...withValue })
    expect(a.find('.sr-sld-label-num').attributes('x')).toBe(b.find('.sr-sld-label-num').attributes('x'))
  })
  it('不配 colW:照旧「前缀 数值 单位」直接拼接,不带 x', () => {
    const w = mount(SldLabelView, { props: { label: label() }, ...withValue })
    expect(w.find('.sr-sld-label-num').attributes('x')).toBeUndefined()
    expect(w.find('.sr-sld-label-unit').text()).toBe('V')
    expect(w.find('.sr-sld-label-title').text()).toBe('Uab')
  })
})

describe('⑤ 开关没数据时按 fallback 画', () => {
  const stateRef = (fallback?: 'open' | 'closed' | 'unknown') => ({
    pt: 'p1',
    map: { '1': 'closed' as const, '0': 'open' as const },
    ...(fallback ? { fallback } : {}),
  })
  it('没数据 / 过期 / 值对不上:缺省仍是 unknown', () => {
    expect(resolveSwitchState(stateRef(), undefined)).toBe('unknown')
    expect(resolveSwitchState(stateRef(), { v: 7, ts: 1000 })).toBe('unknown')
    expect(resolveSwitchState(stateRef(), { v: 1, ts: 0 }, { now: 100_000, staleMs: 1000 })).toBe('unknown')
  })
  it('配了 fallback: closed → 这三种情况都按合闸画', () => {
    expect(resolveSwitchState(stateRef('closed'), undefined)).toBe('closed')
    expect(resolveSwitchState(stateRef('closed'), { v: 7, ts: 1000 })).toBe('closed')
    expect(resolveSwitchState(stateRef('closed'), { v: 1, ts: 0 }, { now: 100_000, staleMs: 1000 })).toBe('closed')
  })
  it('有数据时仍以数据为准,fallback 不插手', () => {
    expect(resolveSwitchState(stateRef('closed'), { v: 0, ts: 1000 })).toBe('open')
    expect(resolveSwitchState(stateRef('open'), { v: 1, ts: 1000 })).toBe('closed')
  })
  it('designSwitchState(编辑器 / 无数据):开关常合、其余按分位;有 fallback 以它为准', () => {
    expect(designSwitchState(getSldSymbol('breaker'), undefined)).toBe('closed')
    expect(designSwitchState(getSldSymbol('earth-switch'), undefined)).toBe('open')
    expect(designSwitchState(getSldSymbol('breaker'), stateRef('open'))).toBe('open')
  })
  it('画出来的确实是合位那一笔(不是虚线)', () => {
    const closed = mount(SldSymbol, { props: { symbol: 'breaker', state: 'closed' } }).html()
    const unknown = mount(SldSymbol, { props: { symbol: 'breaker', state: 'unknown' } }).html()
    expect(closed).not.toContain('stroke-dasharray')
    expect(unknown).toContain('stroke-dasharray')
  })
})
