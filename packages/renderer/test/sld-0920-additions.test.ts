/**
 * 2026-09-20 的四项增补(YY 提):在线状态灯、母线粗细 / 颜色与文字样式、节点放大、母线搭母线。
 * 这里测模型层与运行时渲染;编辑器那一侧的改写在 deploy-tool/test/sld-0920-editor.test.ts。
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import {
  busesTouch,
  collectPointRefs,
  energize,
  lookupSldSymbol,
  nodeBox,
  portPosition,
  registerBuiltins,
  resetRegistry,
  resolveOnlineState,
  validNodeScales,
  validateSldDoc,
  type SldBus,
  type SldDoc,
  type SldNode,
} from '../src/index'
import SldWidget from '../src/widgets/sld/SldWidget.vue'

const doc = (p: Partial<SldDoc>): SldDoc => ({
  v: 1,
  canvas: { w: 800, h: 600, grid: 10 },
  nodes: [],
  buses: [],
  wires: [],
  labels: [],
  ...p,
})
const hbus = (id: string, x1: number, x2: number, y: number): SldBus => ({ id, x1, y1: y, x2, y2: y })
const vbus = (id: string, x: number, y1: number, y2: number): SldBus => ({ id, x1: x, y1, x2: x, y2 })

beforeEach(() => {
  resetRegistry()
  registerBuiltins()
})

describe('母线搭母线(issue 4)', () => {
  it('T 形:竖母线的头顶在横母线中间 → 算搭上', () => {
    expect(busesTouch(hbus('h', 0, 400, 100), vbus('v', 200, 100, 300))).toBe(true)
  })
  it('L 形:两条母线端头对端头 → 算搭上', () => {
    expect(busesTouch(hbus('h', 0, 400, 100), vbus('v', 400, 100, 300))).toBe(true)
  })
  it('十字交叉(谁的端头都没落在对方身上)与不相干的两条 → 不算', () => {
    expect(busesTouch(hbus('h', 0, 400, 100), vbus('v', 200, 0, 300))).toBe(false)
    expect(busesTouch(hbus('h', 0, 400, 100), vbus('v', 200, 110, 300))).toBe(false)
  })
  it('带电计算:电源接在横母线上,搭着的竖母线跟着带电,不用再补一根线', () => {
    const src: SldNode = { id: 'g', symbol: 'grid-source', x: 0, y: 0, rot: 0, source: { kv: 10 } }
    const port = lookupSldSymbol('grid-source')!.ports[0]!.id
    const d = doc({
      nodes: [src],
      buses: [hbus('h', 0, 400, 100), vbus('v', 200, 100, 300), vbus('far', 600, 100, 300)],
      wires: [{ id: 'w', from: { node: 'g', port }, to: { bus: 'h', d: 20 } }],
    })
    const e = energize(d, lookupSldSymbol, {})
    expect(e.buses.h).toMatchObject({ live: true, kv: 10 })
    expect(e.buses.v).toMatchObject({ live: true, kv: 10 })
    expect(e.buses.far?.live).toBe(false)
  })
})

describe('节点放大(issue 3)', () => {
  it('validNodeScales:1 永远可用;其余只留放大后端口仍落栅格的倍数', () => {
    const def = lookupSldSymbol('breaker')!
    const ks = validNodeScales(def)
    expect(ks).toContain(1)
    expect(ks).toContain(2)
    for (const k of ks)
      for (const p of def.ports) {
        expect((p.x * k) % 10).toBe(0)
        expect((p.y * k) % 10).toBe(0)
      }
  })
  it('端口与包围盒跟着倍数走,左上角不动', () => {
    const def = lookupSldSymbol('breaker')!
    const n1: SldNode = { id: 'n', symbol: 'breaker', x: 100, y: 100, rot: 0 }
    const n2: SldNode = { ...n1, scale: 2 }
    const pid = def.ports[1]!.id
    const a = portPosition(n1, def, pid)!
    const b = portPosition(n2, def, pid)!
    expect(b.x - 100).toBe((a.x - 100) * 2)
    expect(b.y - 100).toBe((a.y - 100) * 2)
    expect(nodeBox(n2, def)).toEqual({ x: 100, y: 100, w: def.w * 2, h: def.h * 2 })
  })
  it('旋转 + 放大:仍以旋转后包围盒的左上角为原点', () => {
    const def = lookupSldSymbol('breaker')!
    const n: SldNode = { id: 'n', symbol: 'breaker', x: 50, y: 60, rot: 90, scale: 2 }
    expect(nodeBox(n, def)).toEqual({ x: 50, y: 60, w: def.h * 2, h: def.w * 2 })
  })
  it('校验:不合法的倍数报 bad-scale(手改 JSON / 换了图元之后)', () => {
    const d = doc({ nodes: [{ id: 'n', symbol: 'breaker', x: 0, y: 0, rot: 0, scale: 1.37 }] })
    expect(validateSldDoc(d, lookupSldSymbol).some(i => i.code === 'bad-scale')).toBe(true)
  })
})

describe('在线状态(issue 1)', () => {
  it('resolveOnlineState:真 / 假 / 没数据', () => {
    for (const v of [true, 1, 'true', '1']) expect(resolveOnlineState({ v, ts: 0 })).toBe('online')
    for (const v of [false, 0, 'false', '0']) expect(resolveOnlineState({ v, ts: 0 })).toBe('offline')
    expect(resolveOnlineState(undefined)).toBe('unknown')
    expect(resolveOnlineState({ v: null, ts: 0 })).toBe('unknown')
  })
  it('时间戳再旧也不算过期:active 只在上下线那一刻更新', () => {
    expect(resolveOnlineState({ v: true, ts: 1 })).toBe('online')
  })
  it('collectPointRefs 带上节点在线灯与状态标签', () => {
    const d = doc({
      nodes: [{ id: 'n', symbol: 'meter', x: 0, y: 0, rot: 0, online: { pt: 'po' } }],
      labels: [{ id: 'l', x: 0, y: 0, kind: 'status', pt: 'ps', title: '站点' }],
    })
    expect(collectPointRefs(d)).toEqual([
      { pt: 'po', from: 'online', owner: 'n' },
      { pt: 'ps', from: 'label', owner: 'l' },
    ])
  })

  const render = (values: Record<string, unknown>) =>
    mount(SldWidget, {
      props: {
        doc: doc({
          nodes: [{ id: 'n', symbol: 'meter', x: 100, y: 100, rot: 0, online: { pt: 'po' } }],
          labels: [{ id: 'l', x: 20, y: 20, kind: 'status', pt: 'ps', title: '站点' }],
        }),
        values,
        errors: {},
        staleSeconds: 60,
      },
    })

  it('渲染:在线 → 绿灯类名 + 「在线」;离线 → 红灯 + 「离线」;没数据 → 灰 + 「未知」', () => {
    const old = Date.now() - 86_400_000 // 一天前的时间戳:staleSeconds = 60 也不该把在线判成未知
    const on = render({ 'pt.po': { v: true, ts: old }, 'pt.ps': { v: 'true', ts: old } })
    expect(on.find('.sr-sld-node .sr-sld-online').attributes('data-online')).toBe('online')
    expect(on.find('.sr-sld-status').classes()).toContain('sr-sld-status-online')
    expect(on.find('.sr-sld-status-word').text()).toBe('在线')
    expect(on.find('.sr-sld-status').text()).toContain('站点')

    const off = render({ 'pt.po': { v: false, ts: old }, 'pt.ps': { v: 0, ts: old } })
    expect(off.find('.sr-sld-node .sr-sld-online').attributes('data-online')).toBe('offline')
    expect(off.find('.sr-sld-status-word').text()).toBe('离线')

    const none = render({})
    expect(none.find('.sr-sld-node .sr-sld-online').attributes('data-online')).toBe('unknown')
    expect(none.find('.sr-sld-status-word').text()).toBe('未知')
  })
})

describe('母线与文字的样式(issue 2)', () => {
  const render = (d: SldDoc, extra: Record<string, unknown> = {}) =>
    mount(SldWidget, { props: { doc: d, values: {}, errors: {}, ...extra } })

  it('母线线宽 / 颜色写进内联样式;没配就不写(走样式表的缺省 4px)', () => {
    const w = render(
      doc({ buses: [{ ...hbus('b1', 0, 200, 50), width: 8, color: '#ff8800' }, hbus('b2', 0, 200, 90)] })
    )
    const b1 = w.find('[data-id="b1"]').attributes('style') ?? ''
    expect(b1).toContain('stroke-width: 8')
    expect(b1.replace(/\s/g, '')).toMatch(/color:(#ff8800|rgb\(255,136,0\))/)
    expect(w.find('[data-id="b2"]').attributes('style')).toBeUndefined()
  })

  it('自定义颜色不挡失电变灰:失电的母线不写 color', () => {
    const src: SldNode = { id: 'g', symbol: 'grid-source', x: 0, y: 0, rot: 0, source: { kv: 10 } }
    const w = render(doc({ nodes: [src], buses: [{ ...hbus('dead', 0, 200, 300), color: '#ff8800' }] }))
    const el = w.find('[data-id="dead"]')
    expect(el.classes()).toContain('sr-sld-e-dead')
    expect(el.attributes('style') ?? '').not.toContain('color')
  })

  it('文字标签:字号、加粗、颜色', () => {
    const w = render(
      // 只有标签的图会被当成「未绘制」,所以垫一条母线
      doc({
        buses: [hbus('b', 0, 200, 50)],
        labels: [{ id: 't', x: 10, y: 10, kind: 'text', text: '10kV I 段', size: 20, bold: true, color: '#00ff00' }],
      })
    )
    const t = w.find('[data-id="t"]')
    expect(t.attributes('font-size')).toBe('20')
    expect(t.attributes('font-weight')).toBe('700')
    expect((t.attributes('style') ?? '').replace(/\s/g, '')).toMatch(/fill:(#00ff00|rgb\(0,255,0\))/)
  })
})

describe('叠放层次 z(2026-09-21)', () => {
  const ids = (w: ReturnType<typeof mount>, layer: string): string[] =>
    w
      .find(`.${layer}`)
      .findAll('[data-id]')
      .map(e => e.attributes('data-id')!)
      .filter(id => ['n1', 'n2', 'b1', 'b2'].includes(id))
  const base = (): SldDoc =>
    doc({
      nodes: [
        { id: 'n1', symbol: 'meter', x: 100, y: 100, rot: 0 },
        { id: 'n2', symbol: 'meter', x: 110, y: 100, rot: 0 },
      ],
      buses: [hbus('b1', 0, 400, 120), hbus('b2', 0, 400, 140)],
    })
  const render = (d: SldDoc) => mount(SldWidget, { props: { doc: d, values: {}, errors: {} } })

  it('缺省:母线在「线」层、图元在「图元」层,各按数组顺序——和加 z 之前一样', () => {
    const w = render(base())
    expect(ids(w, 'sr-sld-layer-lines')).toEqual(['b1', 'b2'])
    expect(ids(w, 'sr-sld-layer-nodes')).toEqual(['n1', 'n2'])
  })
  it('图元 z < 0 垫到母线底下;母线 z > 0 浮到图元上面;同层里 z 大的后画', () => {
    const d = base()
    d.nodes[0]!.z = -1
    d.buses[1]!.z = 1
    const w = render(d)
    expect(ids(w, 'sr-sld-layer-lines')).toEqual(['n1', 'b1']) // n1 先画 = 在母线底下
    expect(ids(w, 'sr-sld-layer-nodes')).toEqual(['n2', 'b2']) // b2 后画 = 压着 n2
  })
  it('两个图元重叠:把先画的那个置顶(z = 1)它就后画', () => {
    const d = base()
    d.nodes[0]!.z = 1
    expect(ids(render(d), 'sr-sld-layer-nodes')).toEqual(['n2', 'n1'])
  })
})
