// T5.4:一次接线图(sld)组件的「图 ↔ 测点绑定」一致性检查(ADR-005 D2 / D4)
import { beforeEach, describe, expect, it, vi } from 'vitest'

// validateSldDoc 在基线上还是会 throw 的桩(T5.1 并行实现):缺省走真身,个别用例换成给定返回值
const validateSldDocMock = vi.hoisted(() => vi.fn())
vi.mock('@grid/scada-renderer', async importActual => {
  const actual = await importActual<typeof import('@grid/scada-renderer')>()
  validateSldDocMock.mockImplementation(actual.validateSldDoc)
  return { ...actual, validateSldDoc: validateSldDocMock }
})

import {
  emptySldDoc,
  registerBuiltins,
  type Binding,
  type PageConfig,
  type SldDoc,
  type SldIssue,
  type WidgetConfig,
} from '@grid/scada-renderer'
import { canPublish, summarize, validateSldWidget, validateStatic } from '../src/editor/validate'

registerBuiltins()

const QF1 = { type: 'DEVICE', id: 'id-QF1', name: 'QF_1' } as const
const ts = (key: string, entity: { type: 'DEVICE' | 'ASSET'; id: string; name: string } = QF1): Binding => ({
  mode: 'ts',
  entity,
  key,
})

/** 一台断路器(状态 p1)+ 依附它的电流标签(p2)+ 一条母线 */
const doc = (): SldDoc => ({
  ...emptySldDoc(),
  nodes: [
    {
      id: 'n1',
      symbol: 'breaker',
      x: 100,
      y: 100,
      rot: 0,
      name: '1# 进线柜',
      entity: { type: 'DEVICE', name: 'QF_1' },
      state: { pt: 'p1', map: { '1': 'closed', '0': 'open' } },
    },
  ],
  buses: [{ id: 'b1', x1: 0, y1: 50, x2: 400, y2: 50 }],
  labels: [{ id: 'l1', kind: 'value', x: 130, y: 100, attach: 'n1', pt: 'p2', title: 'Ia' }],
})
const widget = (over: Partial<WidgetConfig> = {}): WidgetConfig => ({
  id: 'w-sld',
  type: 'sld',
  slot: 'g1',
  props: { doc: doc() },
  bindings: { 'pt.p1': ts('CB'), 'pt.p2': ts('Ia') },
  ...over,
})
const page = (w: WidgetConfig): PageConfig => ({ schemaVersion: 1, template: 'overview-a', title: 't', widgets: [w] })
/** 基线上还没有哪个模板槽位的 accepts 里有 sld(模板归渲染器,不在本任务可写范围),全流程用例里滤掉这一条 */
const notSlotAccepts = (i: { path: string }) => !i.path.endsWith('/slot')

beforeEach(() => {
  validateSldDocMock.mockClear() // 注意不能直接 return:vitest 会把返回的函数当清理函数再调一次
})

describe('sld 组件校验:doc ↔ bindings', () => {
  it('图与绑定一致:没有任何问题;validateSldDoc 抛错(未实现)时跳过结构校验', () => {
    expect(validateSldWidget(widget())).toEqual([])
    expect(validateSldDocMock).toHaveBeenCalledTimes(1)
  })

  it('走 validateStatic 全流程:pt.* 动态槽位被注册表接受,只为 sld 组件跑这组检查', () => {
    const issues = validateStatic(page(widget())).filter(i => i.widgetId === 'w-sld' && notSlotAccepts(i))
    expect(issues).toEqual([])
    const bad = widget({ bindings: { 'pt.p1': ts('CB') } })
    const r = summarize(validateStatic(page(bad)), false)
    expect(r.issues.filter(i => i.widgetId === 'w-sld' && i.level === 'error' && notSlotAccepts(i))).toHaveLength(1)
    expect(canPublish(r)).toBe(false)
    // 别的类型的组件即使 props 里有 doc 也不碰
    const other: WidgetConfig = { id: 'w-x', type: 'number-card', slot: 's1', bindings: { value: ts('P') } }
    expect(validateStatic(page(other)).filter(i => /接线图/.test(i.message))).toEqual([])
  })

  it('doc 不是合法形状 → error「接线图数据损坏」,且不再误报多余绑定', () => {
    for (const broken of [
      { v: 1, nodes: [] },
      { ...doc(), v: 2 },
      { ...doc(), wires: 'x' },
    ]) {
      const issues = validateSldWidget(widget({ props: { doc: broken } }))
      expect(issues).toHaveLength(1)
      expect(issues[0]).toMatchObject({
        level: 'error',
        layer: 'props',
        path: '/widgets/w-sld/props/doc',
        widgetId: 'w-sld',
      })
      expect(issues[0]!.message).toMatch(/接线图数据损坏/)
    }
    expect(validateSldDocMock).not.toHaveBeenCalled()
  })

  it('没有 doc / 空图 → warning「还没画接线图」,不挡发布', () => {
    for (const props of [undefined, {}, { doc: emptySldDoc() }]) {
      const issues = validateSldWidget(widget({ props, bindings: {} }))
      expect(issues).toHaveLength(1)
      expect(issues[0]).toMatchObject({ level: 'warning', path: '/widgets/w-sld/props/doc', widgetId: 'w-sld' })
      expect(issues[0]!.message).toMatch(/还没画接线图/)
    }
  })

  it('图里引用的测点没绑 → error,定位到组件与槽位,message 带上是哪个节点 / 标签引用的', () => {
    const issues = validateSldWidget(widget({ bindings: {} }))
    const errors = issues.filter(i => i.level === 'error')
    expect(errors.map(i => [i.path, i.slot, i.widgetId])).toEqual([
      ['/widgets/w-sld/bindings/pt.p1', 'pt.p1', 'w-sld'],
      ['/widgets/w-sld/bindings/pt.p2', 'pt.p2', 'w-sld'],
    ])
    expect(errors[0]!.message).toMatch(/节点 n1\(1# 进线柜\)的开关状态.*「p1」/)
    expect(errors[1]!.message).toMatch(/数值标签 l1\(Ia\).*「p2」/)
    // 空数组等于没绑
    const empty = validateSldWidget(widget({ bindings: { 'pt.p1': [], 'pt.p2': ts('Ia') } }))
    expect(empty.filter(i => i.level === 'error').map(i => i.slot)).toEqual(['pt.p1'])
  })

  it('同一个测点被两处引用又没绑:两处各报一条', () => {
    const d = doc()
    d.labels.push({ id: 'l2', kind: 'value', x: 0, y: 0, pt: 'p2' })
    const errors = validateSldWidget(widget({ props: { doc: d }, bindings: { 'pt.p1': ts('CB') } }))
    expect(errors.map(i => i.message.match(/数值标签 (l\d)/)?.[1])).toEqual(['l1', 'l2'])
  })

  it('bindings 里有 pt.* 但图里没人引用 → warning「多余的测点绑定」;非 pt.* 槽位(alarms)不算', () => {
    const w = widget({
      bindings: {
        'pt.p1': ts('CB'),
        'pt.p2': ts('Ia'),
        'pt.old': ts('Ib'),
        alarms: [{ mode: 'alarm', entity: { type: 'ASSET', id: 'a1', name: '站点' } }],
      },
    })
    const issues = validateSldWidget(w)
    expect(issues).toHaveLength(1)
    expect(issues[0]).toMatchObject({
      level: 'warning',
      layer: 'template',
      path: '/widgets/w-sld/bindings/pt.old',
      slot: 'pt.old',
      widgetId: 'w-sld',
    })
    expect(issues[0]!.message).toMatch(/多余的测点绑定.*发布时仍会订阅/)
    // 没有 doc 时留下的 pt.* 同样提示
    const noDoc = validateSldWidget(widget({ props: {}, bindings: { 'pt.old': ts('Ib') } }))
    expect(noDoc.map(i => i.message).join('\n')).toMatch(/还没画接线图[\s\S]*多余的测点绑定/)
  })

  it('节点有 entity 但名下没有绑到该实体的测点 → warning(D4:运行时取不到实体 id)', () => {
    // ① 节点既没状态也没依附标签
    const d1 = doc()
    d1.nodes.push({ id: 'n2', symbol: 'load', x: 200, y: 100, rot: 0, entity: { type: 'DEVICE', name: 'LOAD_1' } })
    const a = validateSldWidget(widget({ props: { doc: d1 } }))
    expect(a).toHaveLength(1)
    expect(a[0]).toMatchObject({
      level: 'warning',
      layer: 'props',
      path: '/widgets/w-sld/props/doc/nodes/n2',
      widgetId: 'w-sld',
    })
    expect(a[0]!.message).toMatch(/节点 n2.*「LOAD_1」.*没有任何已绑定的测点.*告警匹配与点击事件/)
    // ② 名下测点绑的是常量(没有实体)
    const b = validateSldWidget(
      widget({ bindings: { 'pt.p1': { mode: 'const', value: 1 }, 'pt.p2': { mode: 'const', value: 2 } } })
    )
    expect(b.map(i => i.path)).toEqual(['/widgets/w-sld/props/doc/nodes/n1'])
    // ③ 名下测点绑的都是别的实体
    const other = { type: 'DEVICE', id: 'id-X', name: 'PDR_9' } as const
    const c = validateSldWidget(widget({ bindings: { 'pt.p1': ts('CB', other), 'pt.p2': ts('Ia', other) } }))
    expect(c).toHaveLength(1)
    expect(c[0]!.message).toMatch(/「QF_1」.*别的实体\(PDR_9\)/)
    // ④ 只要有一个测点绑到该实体就够(状态没绑对、标签绑对)
    const e = validateSldWidget(widget({ bindings: { 'pt.p1': ts('CB', other), 'pt.p2': ts('Ia') } }))
    expect(e).toEqual([])
    // ⑤ 没写 entity 的节点不查
    const d2 = doc()
    delete d2.nodes[0]!.entity
    expect(
      validateSldWidget(widget({ props: { doc: d2 }, bindings: { 'pt.p1': ts('CB', other), 'pt.p2': ts('Ia') } }))
    ).toEqual([])
  })

  it('validateSldDoc 不抛时:issue 按级别映射进来,path 前拼组件路径', () => {
    const fake: SldIssue[] = [
      { level: 'error', path: 'wires/w7/from', code: 'dangling-wire', message: '连线 w7 起点悬空' },
      { level: 'warning', path: 'nodes/n1', code: 'no-source', message: '图里没有电源点' },
    ]
    validateSldDocMock.mockImplementationOnce(() => fake)
    const issues = validateSldWidget(widget())
    expect(issues).toEqual([
      {
        level: 'error',
        layer: 'props',
        path: '/widgets/w-sld/props/doc/wires/w7/from',
        widgetId: 'w-sld',
        message: '连线 w7 起点悬空',
      },
      {
        level: 'warning',
        layer: 'props',
        path: '/widgets/w-sld/props/doc/nodes/n1',
        widgetId: 'w-sld',
        message: '图里没有电源点',
      },
    ])
    const [d, lookup] = validateSldDocMock.mock.calls[0]!
    expect((d as SldDoc).nodes[0]!.id).toBe('n1')
    expect(typeof lookup).toBe('function')
  })
})
