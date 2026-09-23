/**
 * 一次接线图 · 2026-09-23 内测反馈(渲染器侧):
 * ③ 开关状态色:合闸红色实心、分闸绿色实心、通信异常灰色;断路器类画实心方块,刀闸类只给动触头上色;
 *    开关位置不判过期(只在变位时上报),设备在线灯离线才算通信异常;
 * ④ 端口压在母线上就算连通(不用再画连线),带电色传得过去;
 * ⑥ 设备框边框线宽 / 虚线。
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import {
  SldSymbol,
  buildSldGraph,
  energize,
  getSldSymbol,
  registerBuiltins,
  resetRegistry,
  type SldDoc,
} from '../src/index'
import SldWidget from '../src/widgets/sld/SldWidget.vue'
import SldNodeView from '../src/widgets/sld/SldNodeView.vue'

beforeEach(() => {
  resetRegistry()
  registerBuiltins()
})

const stateGroup = (html: string) => {
  const div = document.createElement('div')
  div.innerHTML = `<svg>${html}</svg>`
  return div.querySelector('.sr-sld-symbol-state') as SVGGElement | null
}

describe('③ 开关状态色', () => {
  it('断路器:三态都是实心方块,只靠颜色分 —— 合红 / 分绿 / 通信异常灰', () => {
    // 颜色本身写在 inline style 的 var(--sr-sld-sw-*) 里;happy-dom 不认 var() 的 color 会丢掉,颜色在浏览器里实测
    for (const state of ['closed', 'open', 'unknown'] as const) {
      const w = mount(SldSymbol, { props: { symbol: 'breaker', state, switchStyle: 'state' } })
      const g = stateGroup(w.html())!
      expect(g.innerHTML).toContain('fill="currentColor"')
      expect(g.innerHTML).not.toContain('stroke-dasharray')
      expect(g.getAttribute('class')).toContain(`sr-sld-sw-${state}`)
    }
    // 方块模式下断路器的「×」记号不画了(引线还在)
    const w = mount(SldSymbol, { props: { symbol: 'breaker', state: 'closed', switchStyle: 'state' } })
    expect(w.find('.sr-sld-symbol-body').html().match(/<line/g)).toHaveLength(2)
  })

  it('隔离刀:保留刀闸形状(合竖分斜),只给动触头上色', () => {
    const closed = stateGroup(
      mount(SldSymbol, { props: { symbol: 'disconnector', state: 'closed', switchStyle: 'state' } }).html()
    )!
    const open = stateGroup(
      mount(SldSymbol, { props: { symbol: 'disconnector', state: 'open', switchStyle: 'state' } }).html()
    )!
    expect(closed.innerHTML).toContain('<line')
    expect(closed.innerHTML).not.toBe(open.innerHTML)
    expect(closed.getAttribute('class')).toContain('sr-sld-sw-closed')
  })

  it('classic(图元面板 / 总览页的缺省)照旧国标图形,不上状态色', () => {
    const g = stateGroup(mount(SldSymbol, { props: { symbol: 'breaker', state: 'closed' } }).html())!
    expect(g.getAttribute('class')).not.toContain('sr-sld-sw')
    expect(g.innerHTML).toContain('<line')
  })

  it('状态色块不跟着失电变暗:变暗只落在图形本身(CSS 选择器排除了 .sr-sld-sw)', () => {
    const w = mount(SldNodeView, {
      props: {
        node: { id: 'q', symbol: 'breaker', x: 0, y: 0, rot: 0 },
        state: 'closed',
        energyClass: 'sr-sld-e-dead',
      },
    })
    expect(w.find('.sr-sld-node-symbol').classes()).toContain('sr-sld-e-dead')
    expect(w.find('.sr-sld-symbol-state').classes()).toContain('sr-sld-sw')
  })

  describe('通信异常怎么判', () => {
    const DOC: SldDoc = {
      v: 1,
      canvas: { w: 400, h: 300, grid: 10 },
      nodes: [
        {
          id: 'qf1',
          symbol: 'breaker',
          x: 100,
          y: 100,
          rot: 0,
          state: { pt: 'cb', map: { '1': 'closed', '0': 'open' } },
          online: { pt: 'on' },
        },
      ],
      buses: [],
      wires: [],
      labels: [],
    }
    const stateOf = (values: Record<string, unknown>) =>
      mount(SldWidget, { props: { doc: DOC, values } })
        .find('[data-id="qf1"] .sr-sld-symbol')
        .attributes('data-state')
    const WEEK_AGO = Date.now() - 7 * 86_400_000

    it('开关值一周没变(现场 T2_CB=1 停在 09-15):照样按值画合闸,不再当成过期', () => {
      expect(stateOf({ 'pt.cb': { v: 1, ts: WEEK_AGO } })).toBe('closed')
      expect(stateOf({ 'pt.cb': { v: 0, ts: WEEK_AGO } })).toBe('open')
    })
    it('设备在线灯明确离线 → 通信异常(灰)', () => {
      expect(stateOf({ 'pt.cb': { v: 1, ts: WEEK_AGO }, 'pt.on': { v: false, ts: WEEK_AGO } })).toBe('unknown')
    })
    it('在线灯没数据不算离线;从没收到过开关值 → 通信异常', () => {
      expect(stateOf({ 'pt.cb': { v: 1, ts: WEEK_AGO } })).toBe('closed')
      expect(stateOf({})).toBe('unknown')
    })
  })
})

describe('④ 端口压在母线上就算连通', () => {
  const doc = (y: number): SldDoc => ({
    v: 1,
    canvas: { w: 400, h: 300, grid: 10 },
    // 电源 → 母线(y=100);断路器端口 a 在 (x+20, y)
    nodes: [
      { id: 'src', symbol: 'grid-source', x: 40, y: 20, rot: 0, source: { kv: 10 } },
      { id: 'qf', symbol: 'breaker', x: 100, y, rot: 0 },
    ],
    buses: [{ id: 'b', x1: 0, y1: 100, x2: 300, y2: 100, kv: 10 }],
    wires: [
      { id: 'w', from: { node: 'src', port: getSldSymbol('grid-source')!.ports[0]!.id }, to: { bus: 'b', d: 60 } },
    ],
    labels: [],
  })
  it('断路器上端口正好落在母线上:连通图里多一条 attach 边,开关带上电', () => {
    const d = doc(100)
    expect(buildSldGraph(d, getSldSymbol).edges.some(e => e.kind === 'attach')).toBe(true)
    expect(energize(d, getSldSymbol, {}).nodes.qf?.live).toBe(true)
  })
  it('差一格就不算(靠编辑器拖近吸附把它对上)', () => {
    const d = doc(110)
    expect(buildSldGraph(d, getSldSymbol).edges.some(e => e.kind === 'attach')).toBe(false)
    expect(energize(d, getSldSymbol, {}).nodes.qf?.live).toBe(false)
  })
})

describe('⑥ 设备框线宽 / 虚线', () => {
  it('线宽写进 rect,虚线段跟着线宽拉长;不改宽高也按参数重画(线宽不被倍数放大)', () => {
    const html = mount(SldSymbol, { props: { symbol: 'device-box', lineWidth: 4, dashed: true, scale: 2 } }).html()
    expect(html).toContain('stroke-width="4"')
    expect(html).toContain('stroke-dasharray="12 8"')
    expect(html).toContain('width="160"')
    expect(html).not.toContain('scale(')
  })
  it('其余图元不认 lineWidth / dashed', () => {
    const html = mount(SldSymbol, { props: { symbol: 'breaker', lineWidth: 4, dashed: true } }).html()
    expect(html).not.toContain('stroke-width="4"')
  })
})
