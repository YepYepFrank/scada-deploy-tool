// T5.3:sld 运行时组件——标签格式化、三态、带电着色、过期、告警、交互、design 态、卸载清理、放大层独立
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'
import { defineComponent, h, nextTick } from 'vue'
import type { AlarmInfo } from '@grid/tb-client'
import {
  ScadaWidget,
  registerBuiltinSldSymbols,
  registerBuiltins,
  resetRegistry,
  type SldDoc,
  type WidgetConfig,
} from '../src'
import SldWidget from '../src/widgets/sld/SldWidget.vue'
import { sldCoords } from '../src/widgets/sld/coords'
import {
  alarmLevelsByEntity,
  flattenAlarms,
  formatSldValue,
  isStale,
  kvColor,
  labelColor,
  sampleValueFor,
  DEFAULT_KV_COLORS,
} from '../src/widgets/sld/format'
import { sldWidget } from '../src/widgets/sld'

/*
 * 测试图:电源(10 kV)→ 母线 b1 → qf1(state p1)→ ld1
 *                              ├→ qf2(没配 state,常合)→ ld2
 *                              └→ es1 接地刀(state p3)
 * 另有状态灯 sl1(state p4)、sl2(没配 state);数值标签 l1(p2)、文字标签 l2。
 */
const DOC: SldDoc = {
  v: 1,
  canvas: { w: 500, h: 400, grid: 10 },
  nodes: [
    { id: 'src', symbol: 'grid-source', x: 100, y: 0, rot: 0, source: { kv: 10 }, name: '进线' },
    {
      id: 'qf1',
      symbol: 'breaker',
      x: 100,
      y: 140,
      rot: 0,
      name: '1# 出线柜',
      entity: { type: 'DEVICE', name: 'QF1_DEV' },
      state: { pt: 'p1', map: { '1': 'closed', '0': 'open' } },
    },
    { id: 'ld1', symbol: 'load', x: 100, y: 260, rot: 0 },
    { id: 'qf2', symbol: 'breaker', x: 200, y: 140, rot: 0 },
    { id: 'ld2', symbol: 'load', x: 200, y: 260, rot: 0 },
    {
      id: 'es1',
      symbol: 'earth-switch',
      x: 300,
      y: 140,
      rot: 0,
      state: { pt: 'p3', map: { '1': 'closed', '0': 'open' } },
    },
    {
      id: 'sl1',
      symbol: 'status-light',
      x: 400,
      y: 20,
      rot: 0,
      state: { pt: 'p4', map: { '1': 'closed', '0': 'open' } },
    },
    { id: 'sl2', symbol: 'status-light', x: 440, y: 20, rot: 0 },
  ],
  buses: [{ id: 'b1', x1: 40, y1: 100, x2: 400, y2: 100, name: '10kV I 段' }],
  wires: [
    { id: 'w0', from: { node: 'src', port: 'a' }, to: { bus: 'b1', d: 80 } },
    { id: 'w1', from: { bus: 'b1', d: 80 }, to: { node: 'qf1', port: 'a' } },
    { id: 'w2', from: { node: 'qf1', port: 'b' }, to: { node: 'ld1', port: 'a' } },
    { id: 'w3', from: { bus: 'b1', d: 180 }, to: { node: 'qf2', port: 'a' } },
    { id: 'w4', from: { node: 'qf2', port: 'b' }, to: { node: 'ld2', port: 'a' } },
    { id: 'w5', from: { bus: 'b1', d: 280 }, to: { node: 'es1', port: 'a' } },
  ],
  labels: [
    { id: 'l1', x: 150, y: 170, kind: 'value', pt: 'p2', title: 'P', format: { digits: 1, unit: 'kW' }, color: 'a' },
    { id: 'l2', x: 40, y: 20, kind: 'text', text: '瓜州站' },
  ],
  frames: [{ id: 'f1', x: 20, y: 120, w: 260, h: 200, title: 'LP3' }],
}
const NO_SOURCE: SldDoc = { ...DOC, nodes: DOC.nodes.map(n => (n.id === 'src' ? { ...n, source: undefined } : n)) }

const T0 = Date.UTC(2026, 8, 18, 4, 0, 0)
const pv = (v: unknown, ts = Date.now()) => ({ v, ts })
const vals = (p1: unknown, extra: Record<string, unknown> = {}) => ({
  'pt.p1': pv(p1),
  'pt.p2': pv(12.34),
  'pt.p3': pv(1),
  'pt.p4': pv(0),
  ...extra,
})

/** 挂在 .sr-page 下(非 design);design 为 true 时祖先带 .sr-design */
function mountSld(props: Record<string, unknown>, design = false) {
  const Host = defineComponent({
    setup(_, { attrs }) {
      return () => h('div', { class: ['sr-page', { 'sr-design': design }] }, [h(SldWidget, { ...props, ...attrs })])
    },
  })
  const host = mount(Host)
  return { host, w: host.findComponent(SldWidget) as VueWrapper }
}
const nodeSym = (w: VueWrapper, id: string) => w.find(`.sr-sld-node[data-id="${id}"] .sr-sld-node-symbol`)
const stateOf = (w: VueWrapper, id: string) =>
  w.find(`.sr-sld-node[data-id="${id}"] .sr-sld-symbol`).attributes('data-state')
const viewBox = (w: VueWrapper) => w.find('svg.sr-sld-svg').attributes('viewBox')

beforeEach(() => {
  resetRegistry()
  registerBuiltins()
  registerBuiltinSldSymbols()
})
afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('格式化与取色(纯函数)', () => {
  it('数值:scale / digits / unit;数字字符串按数值;没值给 --', () => {
    expect(formatSldValue(12.345, { digits: 2, unit: 'kW' })).toEqual({ text: '12.35', unit: 'kW', empty: false })
    expect(formatSldValue(1234, { scale: 0.001, digits: 3, unit: 'MW' }).text).toBe('1.234')
    expect(formatSldValue('3.5', { digits: 0 }).text).toBe('4')
    expect(formatSldValue(7).text).toBe('7.0') // 缺省 1 位小数
    expect(formatSldValue(null, { unit: 'kW' })).toEqual({ text: '--', unit: '', empty: true })
    expect(formatSldValue(undefined).empty).toBe(true)
    expect(formatSldValue({ a: 1 }).empty).toBe(true)
    expect(formatSldValue('故障').text).toBe('故障')
  })

  it('枚举 map 命中后不套 digits / unit;布尔按 1 / 0 再比一次;原型链键不算命中', () => {
    const f = { map: { '0': '停止', '1': '制冷' }, digits: 2, unit: 'kW' }
    expect(formatSldValue(1, f)).toEqual({ text: '制冷', unit: '', empty: false })
    expect(formatSldValue(true, f).text).toBe('制冷')
    expect(formatSldValue(5, f)).toEqual({ text: '5.00', unit: 'kW', empty: false })
    expect(formatSldValue('constructor', { map: {} }).text).toBe('constructor')
  })

  it('标签颜色:a / b / c 相色,其他当 CSS 颜色,空为随主题', () => {
    expect(labelColor('a')).toBe('#ffe14d')
    expect(labelColor('b')).toBe('#3ddc84')
    expect(labelColor('c')).toBe('#ff5a5a')
    expect(labelColor('#123456')).toBe('#123456')
    expect(labelColor(undefined)).toBeUndefined()
    expect(labelColor('  ')).toBeUndefined()
  })

  it('电压等级取色:相等优先,15% 内归最近一档,未知等级 / 太远返回 undefined', () => {
    expect(kvColor(10, DEFAULT_KV_COLORS)).toBe('#ff4d4f')
    expect(kvColor(10.5, DEFAULT_KV_COLORS)).toBe('#ff4d4f')
    expect(kvColor(0.38, DEFAULT_KV_COLORS)).toBe('#ff9f1a')
    expect(kvColor(35, DEFAULT_KV_COLORS)).toBe('#ffd21f')
    expect(kvColor(110, DEFAULT_KV_COLORS)).toBeUndefined()
    expect(kvColor(undefined, DEFAULT_KV_COLORS)).toBeUndefined()
    expect(kvColor(10, [{ kv: 10, color: 'lime' }])).toBe('lime')
  })

  it('过期判断:staleMs 为 0 / 未给不判', () => {
    expect(isStale(0, 100_000, 60_000)).toBe(true)
    expect(isStale(50_000, 100_000, 60_000)).toBe(false)
    expect(isStale(0, 100_000, 0)).toBe(false)
    expect(isStale(0, 100_000, undefined)).toBe(false)
  })

  it('告警归并:只算 ACTIVE*,按类型 + 名称,取最高级别;数组的数组也认', () => {
    const a = (name: string, severity: AlarmInfo['severity'], status: AlarmInfo['status'] = 'ACTIVE_UNACK') =>
      ({
        id: name + severity,
        type: 't',
        severity,
        status,
        startTs: 0,
        originator: { type: 'DEVICE', id: 'x', name },
        originatorName: name,
      }) as AlarmInfo
    const m = alarmLevelsByEntity(flattenAlarms([[a('D1', 'MINOR'), a('D1', 'CRITICAL')], a('D2', 'WARNING')]))
    expect(m.get('DEVICE|D1')).toBe('bad')
    expect(m.get('DEVICE|D2')).toBe('warn')
    expect(alarmLevelsByEntity([a('D3', 'MAJOR', 'CLEARED_UNACK')]).size).toBe(0)
  })

  it('设计态假值:按单位给合理值,scale 除回去;枚举取第一项', () => {
    expect(sampleValueFor({ unit: 'kW' })).toBe(125.6)
    expect(sampleValueFor({ unit: 'MW', scale: 0.001 })).toBeCloseTo(1200)
    expect(sampleValueFor({ map: { '2': '制冷', '0': '停止' } })).toBe(0) // 对象键序:整数键升序
    expect(sampleValueFor()).toBe(1)
  })
})

describe('画图', () => {
  it('分组框 / 母线 / 连线 / 图元 / 名称 / 标签都在,层次 frames < 线 < 图元 < 标签', () => {
    const { w } = mountSld({ doc: DOC, values: vals(1) })
    const layers = w.findAll('.sr-sld-scene > g').map(g => g.classes()[0])
    expect(layers).toEqual(['sr-sld-layer-frames', 'sr-sld-layer-lines', 'sr-sld-layer-nodes', 'sr-sld-layer-labels'])
    expect(w.find('.sr-sld-frame text').text()).toBe('LP3')
    expect(w.findAll('.sr-sld-bus')).toHaveLength(1)
    expect(w.findAll('.sr-sld-wire')).toHaveLength(6)
    expect(w.findAll('.sr-sld-node')).toHaveLength(8)
    expect(w.find('.sr-sld-node[data-id="qf1"] .sr-sld-node-name').text()).toBe('1# 出线柜')
    expect(w.find('.sr-sld-bus-name').text()).toBe('10kV I 段')
    expect(w.find('[data-id="l1"]').text()).toBe('P 12.3 kW')
    expect(w.find('[data-id="l1"]').attributes('style')).toMatch(/fill/)
    expect(w.find('[data-id="l2"]').text()).toBe('瓜州站')
  })

  it('showNames = false 不画名称', () => {
    const { w } = mountSld({ doc: DOC, values: vals(1), showNames: false })
    expect(w.find('.sr-sld-node-name').exists()).toBe(false)
    expect(w.find('.sr-sld-bus-name').exists()).toBe(false)
  })

  it('开关三态:1 合 / 0 分 / 映射不上 unknown / 没值 unknown;没配 state 的开关常合', () => {
    expect(stateOf(mountSld({ doc: DOC, values: vals(1) }).w, 'qf1')).toBe('closed')
    expect(stateOf(mountSld({ doc: DOC, values: vals(0) }).w, 'qf1')).toBe('open')
    expect(stateOf(mountSld({ doc: DOC, values: vals(7) }).w, 'qf1')).toBe('unknown')
    expect(stateOf(mountSld({ doc: DOC, values: {} }).w, 'qf1')).toBe('unknown')
    expect(stateOf(mountSld({ doc: DOC, values: {} }).w, 'qf2')).toBe('closed')
  })

  it('接地刀 / 状态灯按 state 取三态;没配 state 的按分位画', () => {
    const { w } = mountSld({ doc: DOC, values: vals(1, { 'pt.p3': pv(1), 'pt.p4': pv(1) }) })
    expect(stateOf(w, 'es1')).toBe('closed')
    expect(stateOf(w, 'sl1')).toBe('closed')
    expect(stateOf(w, 'sl2')).toBe('open')
    const { w: w2 } = mountSld({ doc: DOC, values: vals(1, { 'pt.p3': pv(0), 'pt.p4': pv('x') }) })
    expect(stateOf(w2, 'es1')).toBe('open')
    expect(stateOf(w2, 'sl1')).toBe('unknown')
  })

  it('没有图时给提示', () => {
    const { w } = mountSld({ doc: undefined })
    expect(w.text()).toContain('未绘制接线图')
  })
})

describe('带电着色', () => {
  it('合位:下游带电,按 10 kV 取色', () => {
    const { w } = mountSld({ doc: DOC, values: vals(1) })
    const w2 = w.find('.sr-sld-wire[data-id="w2"]')
    expect(w2.classes()).toContain('sr-sld-e-live')
    expect(w2.attributes('style')).toMatch(/color/)
    expect(w.find('.sr-sld-bus').classes()).toContain('sr-sld-e-live')
    expect(nodeSym(w, 'ld1').classes()).toContain('sr-sld-e-live')
  })

  it('分位开关下游失电灰;母线与其他支路仍带电', () => {
    const { w } = mountSld({ doc: DOC, values: vals(0) })
    expect(w.find('.sr-sld-wire[data-id="w2"]').classes()).toContain('sr-sld-e-dead')
    expect(nodeSym(w, 'ld1').classes()).toContain('sr-sld-e-dead')
    expect(nodeSym(w, 'ld1').attributes('style')).toBeUndefined()
    expect(w.find('.sr-sld-bus').classes()).toContain('sr-sld-e-live')
    expect(nodeSym(w, 'ld2').classes()).toContain('sr-sld-e-live')
  })

  it('unknown 开关下游画 uncertain(同色、虚线半透明)', () => {
    const { w } = mountSld({ doc: DOC, values: vals(7) })
    const w2 = w.find('.sr-sld-wire[data-id="w2"]')
    expect(w2.classes()).toContain('sr-sld-e-uncertain')
    expect(w2.attributes('style')).toMatch(/color/) // 带 kv 的颜色
  })

  it('图里没有电源点:不着色并在角落提示', () => {
    const { w } = mountSld({ doc: NO_SOURCE, values: vals(0) })
    expect(w.find('.sr-sld-e-dead').exists()).toBe(false)
    expect(w.find('.sr-sld-e-live').exists()).toBe(false)
    expect(w.find('.sr-sld-hints').text()).toContain('未标电源点')
  })

  it('energizeColoring = false:全部用强调色,没有提示', () => {
    const { w } = mountSld({ doc: NO_SOURCE, values: vals(0), energizeColoring: false })
    expect(w.find('[class*="sr-sld-e-"]').exists()).toBe(false)
    expect(w.find('.sr-sld-hints').exists()).toBe(false)
  })

  it('自定义 kvColors 生效', () => {
    const { w } = mountSld({ doc: DOC, values: vals(1), kvColors: [{ kv: 10, color: 'rgb(1, 2, 3)' }] })
    expect(w.find('.sr-sld-wire[data-id="w2"]').attributes('style')).toContain('rgb(1, 2, 3)')
  })
})

describe('数据过期(按数据时间戳)', () => {
  it('10 秒一跳的时钟:过期后数值变灰并挂「数据时间」,开关变 unknown;卸载清定时器', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(T0)
    const { host, w } = mountSld({ doc: DOC, staleSeconds: 60, values: vals(1) })
    await nextTick()
    expect(vi.getTimerCount()).toBe(1)
    expect(w.find('[data-id="l1"]').classes()).not.toContain('sr-sld-stale')
    expect(stateOf(w, 'qf1')).toBe('closed')
    await vi.advanceTimersByTimeAsync(70_000)
    const l1 = w.find('[data-id="l1"]')
    expect(l1.classes()).toContain('sr-sld-stale')
    expect(l1.find('title').text()).toMatch(/^数据时间 2026-09-18 /)
    expect(stateOf(w, 'qf1')).toBe('unknown')
    host.unmount()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('staleSeconds = 0 不判,也不起定时器;disabled 不起定时器', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(T0)
    const old = vals(1, { 'pt.p2': pv(1, T0 - 86_400_000), 'pt.p1': pv(1, T0 - 86_400_000) })
    const { w } = mountSld({ doc: DOC, staleSeconds: 0, values: old })
    await nextTick()
    expect(vi.getTimerCount()).toBe(0)
    expect(w.find('[data-id="l1"]').classes()).not.toContain('sr-sld-stale')
    expect(stateOf(w, 'qf1')).toBe('closed')
    mountSld({ doc: DOC, staleSeconds: 60, values: old, disabled: true })
    await nextTick()
    expect(vi.getTimerCount()).toBe(0)
  })
})

describe('告警闪烁', () => {
  const alarm = (name: string | undefined, severity: AlarmInfo['severity'], status: AlarmInfo['status']) =>
    ({
      id: 'a',
      type: '越限',
      severity,
      status,
      startTs: 0,
      originator: { type: 'DEVICE', id: 'uuid-1' },
      ...(name ? { originatorName: name } : {}),
    }) as AlarmInfo

  it('按 originatorName 匹配节点实体名:CRITICAL / MAJOR 红,其余黄', () => {
    const bad = mountSld({ doc: DOC, values: vals(1, { alarms: [alarm('QF1_DEV', 'MAJOR', 'ACTIVE_ACK')] }) }).w
    expect(bad.find('.sr-sld-node[data-id="qf1"]').classes()).toContain('sr-sld-alarm-bad')
    expect(bad.findAll('.sr-sld-alarm')).toHaveLength(1)
    const warn = mountSld({ doc: DOC, values: vals(1, { alarms: [alarm('QF1_DEV', 'MINOR', 'ACTIVE_UNACK')] }) }).w
    expect(warn.find('.sr-sld-node[data-id="qf1"]').classes()).toContain('sr-sld-alarm-warn')
  })

  it('不匹配:已清除 / 名字不同 / 没有名字 / 实体类型不同', () => {
    for (const a of [
      alarm('QF1_DEV', 'CRITICAL', 'CLEARED_UNACK'),
      alarm('OTHER', 'CRITICAL', 'ACTIVE_UNACK'),
      alarm(undefined, 'CRITICAL', 'ACTIVE_UNACK'),
      { ...alarm('QF1_DEV', 'CRITICAL', 'ACTIVE_UNACK'), originator: { type: 'ASSET', id: 'x' } } as AlarmInfo,
    ]) {
      const { w } = mountSld({ doc: DOC, values: vals(1, { alarms: [a] }) })
      expect(w.find('.sr-sld-alarm').exists()).toBe(false)
    }
  })
})

describe('交互', () => {
  const identity = () => vi.spyOn(sldCoords, 'mapper').mockReturnValue((x, y) => ({ x, y }))
  const down = (x: number, y: number) => ({ button: 0, pointerId: 1, clientX: x, clientY: y })

  it('点击节点抛 node-click:{ nodeId, name, entity: { type, name } }', async () => {
    identity()
    const { w } = mountSld({ doc: DOC, values: vals(1) })
    const hit = w.find('.sr-sld-node[data-id="qf1"] .sr-sld-hit')
    await hit.trigger('pointerdown', down(10, 10))
    await hit.trigger('pointerup', down(11, 10))
    expect(w.emitted('widget-event')).toEqual([
      [
        {
          name: 'node-click',
          detail: { nodeId: 'qf1', name: '1# 出线柜', entity: { type: 'DEVICE', name: 'QF1_DEV' } },
        },
      ],
    ])
  })

  it('没有名字也没有实体的节点不可点;拖动结束不算点击,拖动平移 viewBox', async () => {
    identity()
    const { w } = mountSld({ doc: DOC, values: vals(1) })
    expect(w.find('.sr-sld-node[data-id="ld1"] .sr-sld-hit').exists()).toBe(false)
    expect(w.find('.sr-sld-node[data-id="qf1"]').classes()).toContain('sr-sld-node-clickable')
    const hit = w.find('.sr-sld-node[data-id="qf1"] .sr-sld-hit')
    const svg = w.find('svg')
    await hit.trigger('pointerdown', down(100, 100))
    await svg.trigger('pointermove', down(130, 120))
    await svg.trigger('pointerup', down(130, 120))
    expect(w.emitted('widget-event')).toBeUndefined()
    expect(viewBox(w)).toBe('-30 -20 500 400')
  })

  it('滚轮以指针为中心缩放,双击复位', async () => {
    identity()
    const { w } = mountSld({ doc: DOC, values: vals(1) })
    const svg = w.find('svg')
    expect(viewBox(w)).toBe('0 0 500 400')
    await svg.trigger('wheel', { deltaY: -200, deltaMode: 0, clientX: 100, clientY: 100 })
    const [x, y, vw, vh] = viewBox(w)!.split(' ').map(Number) as [number, number, number, number]
    expect(vw).toBeLessThan(500)
    // 指针下的点 (100,100) 在缩放前后的相对位置不变
    expect((100 - x) / vw).toBeCloseTo(100 / 500)
    expect((100 - y) / vh).toBeCloseTo(100 / 400)
    await svg.trigger('dblclick')
    expect(viewBox(w)).toBe('0 0 500 400')
  })

  it('interactive = false:不缩放不平移,但仍可点击', async () => {
    identity()
    const { w } = mountSld({ doc: DOC, values: vals(1), interactive: false })
    const svg = w.find('svg')
    await svg.trigger('wheel', { deltaY: -200, clientX: 100, clientY: 100 })
    const hit = w.find('.sr-sld-node[data-id="qf1"] .sr-sld-hit')
    await hit.trigger('pointerdown', down(0, 0))
    await svg.trigger('pointermove', down(50, 50))
    await svg.trigger('pointerup', down(50, 50))
    expect(viewBox(w)).toBe('0 0 500 400')
    expect(w.emitted('widget-event')).toBeUndefined() // 动过了,不算点击
    await hit.trigger('pointerdown', down(0, 0))
    await hit.trigger('pointerup', down(0, 0))
    expect(w.emitted('widget-event')).toHaveLength(1)
  })

  it('坐标换算拿不到矩阵时忽略滚轮(不抛)', async () => {
    vi.spyOn(sldCoords, 'mapper').mockReturnValue(null)
    const { w } = mountSld({ doc: DOC, values: vals(1) })
    await w.find('svg').trigger('wheel', { deltaY: -200, clientX: 1, clientY: 1 })
    expect(viewBox(w)).toBe('0 0 500 400')
  })
})

describe('design 态', () => {
  it('不起定时器、不判过期、不响应缩放 / 点击,节点不带可点样式', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(T0)
    const spy = vi.spyOn(sldCoords, 'mapper').mockReturnValue((x, y) => ({ x, y }))
    const old = vals(1, { 'pt.p1': pv(1, 0), 'pt.p2': pv(5, 0) })
    const { w } = mountSld({ doc: DOC, staleSeconds: 60, values: old }, true)
    await nextTick()
    expect(vi.getTimerCount()).toBe(0)
    expect(stateOf(w, 'qf1')).toBe('closed')
    expect(w.find('[data-id="l1"]').classes()).not.toContain('sr-sld-stale')
    expect(w.find('.sr-sld-hit').exists()).toBe(false)
    const svg = w.find('svg')
    await svg.trigger('wheel', { deltaY: -200, clientX: 1, clientY: 1 })
    await w.find('.sr-sld-node[data-id="qf1"]').trigger('pointerdown', { button: 0, pointerId: 1 })
    await w.find('.sr-sld-node[data-id="qf1"]').trigger('pointerup', { button: 0, pointerId: 1 })
    expect(viewBox(w)).toBe('0 0 500 400')
    expect(w.emitted('widget-event')).toBeUndefined()
    expect(spy).not.toHaveBeenCalled()
  })

  it('sampleData:开关按合位值、数值标签按单位给假值、告警为空', () => {
    const cfg: WidgetConfig = {
      id: 'w',
      slot: 'main',
      type: 'sld',
      props: { doc: DOC },
      bindings: { 'pt.zz': { mode: 'const', value: 3 } },
    }
    const s = sldWidget.sampleData!(cfg) as Record<string, { v: unknown }>
    expect(s['pt.p1']!.v).toBe(1)
    expect(s['pt.p2']!.v).toBe(125.6)
    expect(s['pt.zz']!.v).toBe(1)
    expect(s.alarms).toEqual([])
  })
})

describe('经 <ScadaWidget> 与放大层', () => {
  const cfg: WidgetConfig = {
    id: 'w_sld',
    type: 'sld',
    slot: 'main',
    props: { doc: DOC },
    bindings: { 'pt.p1': { mode: 'const', value: 1 } },
  }

  it('node-click 从 ScadaWidget 抛出时补上 widgetId / type', async () => {
    vi.spyOn(sldCoords, 'mapper').mockReturnValue((x, y) => ({ x, y }))
    const page = mount(ScadaWidget, { props: { config: cfg } })
    await nextTick()
    const hit = page.find('.sr-sld-node[data-id="qf1"] .sr-sld-hit')
    await hit.trigger('pointerdown', { button: 0, pointerId: 1 })
    await hit.trigger('pointerup', { button: 0, pointerId: 1 })
    expect(page.emitted('widget-event')?.[0]?.[0]).toEqual({
      widgetId: 'w_sld',
      type: 'sld',
      name: 'node-click',
      detail: { nodeId: 'qf1', name: '1# 出线柜', entity: { type: 'DEVICE', name: 'QF1_DEV' } },
    })
    page.unmount()
  })

  it('放大层里的第二份:缩放平移状态独立,定时器各自起、各自清', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(T0)
    vi.spyOn(sldCoords, 'mapper').mockReturnValue((x, y) => ({ x, y }))
    const page = mount(ScadaWidget, { props: { config: cfg }, attachTo: document.body })
    await nextTick()
    const base = vi.getTimerCount()
    await page.find('[data-role="expand"]').trigger('click')
    await nextTick()
    const all = page.findAllComponents(SldWidget)
    expect(all).toHaveLength(2)
    expect(vi.getTimerCount()).toBe(base + 1)
    const [inline, big] = all as [VueWrapper, VueWrapper]
    await big.find('svg').trigger('wheel', { deltaY: -300, clientX: 50, clientY: 50 })
    expect(viewBox(big)).not.toBe('0 0 500 400')
    expect(viewBox(inline)).toBe('0 0 500 400')
    // 关掉放大层:它的定时器被清,原位那份不受影响
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await nextTick()
    await nextTick()
    expect(page.findAllComponents(SldWidget)).toHaveLength(1)
    expect(vi.getTimerCount()).toBe(base)
    page.unmount()
    expect(vi.getTimerCount()).toBe(base - 1)
  })
})
