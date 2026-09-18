/**
 * 动态绑定槽位 + 带时间戳的值 + 设计态 sampleData(cfg)(接线图计划 D2 / D5 / D6 ①③,T5.0):
 * - 注册:prefix 非空、不重复、不与静态槽位名冲突;
 * - 校验:槽位名按前缀匹配上 → 按该规格查 modes / valueType,绑定必须是单个对象;匹配不上仍是 warning;
 * - 解析:stamped 槽位拿到 { v, ts },ts 为数据时间戳;非 stamped 槽位输出与改动前一致;
 * - 运行时:slotSpec 回退到动态规格;设计态 sampleData 收到组件配置。
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { defineComponent, h } from 'vue'
import { resolveBindings, type SlotValue } from '../src/binding-resolver'
import { findSlotSpec, registerWidget, resetRegistry, validateWidgetAgainstRegistry } from '../src/registry'
import { useBindingRuntime } from '../src/widget-runtime'
import type { BindingSlotSpec, WidgetDefinition } from '../src/schema/registry'
import type { WidgetConfig } from '../src/schema/page-config'
import { createMockDataSource } from './mock-data-source'

const DEV = { type: 'DEVICE', id: 'd1', name: '设备一' } as const
const Stub = defineComponent({ name: 'DynStub', render: () => h('div') })

const dynDef = (over: Partial<WidgetDefinition> = {}): WidgetDefinition => ({
  type: 'dyn',
  name: '动态槽位桩',
  category: 'diagram',
  component: Stub,
  propsSchema: { type: 'object', properties: { doc: { type: 'object', title: '接线图', format: 'sld-doc' } } },
  bindingSlots: [{ name: 'title', valueType: 'string' }],
  dynamicSlots: [{ prefix: 'pt.', valueType: 'number', modes: ['ts', 'attr', 'const'], stamped: true }],
  ...over,
})
const widget = (bindings: WidgetConfig['bindings']): WidgetConfig => ({ id: 'w1', slot: 'main', type: 'dyn', bindings })

beforeEach(() => resetRegistry())
afterEach(() => vi.useRealTimers())

describe('registerWidget:dynamicSlots 基本校验', () => {
  it('prefix 为空 / 重复 / 与静态槽位名冲突 → 抛错;合法的照常登记', () => {
    expect(() => registerWidget(dynDef({ dynamicSlots: [{ prefix: '', valueType: 'number' }] }))).toThrow(/prefix/)
    expect(() =>
      registerWidget(
        dynDef({
          dynamicSlots: [
            { prefix: 'pt.', valueType: 'number' },
            { prefix: 'pt.', valueType: 'string' },
          ],
        })
      )
    ).toThrow(/重复/)
    expect(() =>
      registerWidget(
        dynDef({
          bindingSlots: [{ name: 'pt.fixed', valueType: 'number' }],
          dynamicSlots: [{ prefix: 'pt.', valueType: 'number' }],
        })
      )
    ).toThrow(/冲突/)
    expect(() => registerWidget(dynDef())).not.toThrow()
  })

  it('findSlotSpec:静态优先;动态按前缀且名字要比前缀长;多个前缀取最长', () => {
    const def = dynDef({
      dynamicSlots: [
        { prefix: 'pt.', valueType: 'number', stamped: true },
        { prefix: 'pt.sw.', valueType: 'boolean', modes: ['ts'] },
      ],
    })
    expect(findSlotSpec(def, 'title')).toMatchObject({ name: 'title', valueType: 'string' })
    expect(findSlotSpec(def, 'pt.ia')).toEqual({ name: 'pt.ia', valueType: 'number', stamped: true })
    expect(findSlotSpec(def, 'pt.sw.qf1')).toEqual({ name: 'pt.sw.qf1', valueType: 'boolean', modes: ['ts'] })
    expect(findSlotSpec(def, 'pt.')).toBeUndefined()
    expect(findSlotSpec(def, 'other')).toBeUndefined()
  })
})

describe('validateBindings:动态槽位', () => {
  beforeEach(() => registerWidget(dynDef()))

  it('前缀匹配上的槽位通过校验(无 error、无 warning)', () => {
    const issues = validateWidgetAgainstRegistry(
      widget({
        'pt.ia': { mode: 'ts', entity: DEV, key: 'Ia' },
        'pt.qf1_pos': { mode: 'attr', entity: DEV, scope: 'SERVER_SCOPE', key: 'pos' },
        'pt.k': { mode: 'const', value: 1 },
      })
    )
    expect(issues).toEqual([])
  })

  it('错 mode 被拦:modes 不允许 → error;mode 提供不了该 valueType → error', () => {
    const bad = validateWidgetAgainstRegistry(widget({ 'pt.al': { mode: 'alarm', entity: DEV } }))
    expect(bad).toHaveLength(1)
    expect(bad[0]).toMatchObject({ level: 'error', path: '/widgets/w1/bindings/pt.al' })
    expect(bad[0]!.message).toMatch(/不允许 mode "alarm"/)

    resetRegistry()
    registerWidget(dynDef({ dynamicSlots: [{ prefix: 'pt.', valueType: 'number' }] }))
    const bad2 = validateWidgetAgainstRegistry(
      widget({ 'pt.h': { mode: 'ts-history', entity: DEV, keys: ['P'], window: '1h' } })
    )
    expect(bad2).toHaveLength(1)
    expect(bad2[0]!.level).toBe('error')
    expect(bad2[0]!.message).toMatch(/无法提供 "number"/)
  })

  it('数组绑定被拦:动态槽位必须是单个对象', () => {
    const bad = validateWidgetAgainstRegistry(widget({ 'pt.ia': [{ mode: 'ts', entity: DEV, key: 'Ia' }] }))
    expect(bad).toHaveLength(1)
    expect(bad[0]).toMatchObject({ level: 'error', path: '/widgets/w1/bindings/pt.ia' })
    expect(bad[0]!.message).toMatch(/必须是单个对象/)
  })

  it('未匹配(含「只有前缀」)仍是 warning,不阻断', () => {
    const issues = validateWidgetAgainstRegistry(
      widget({ nope: { mode: 'const', value: 1 }, 'pt.': { mode: 'const', value: 1 } })
    )
    expect(issues.map(i => i.level)).toEqual(['warning', 'warning'])
    expect(issues[0]!.message).toMatch(/没有绑定槽位 "nope"/)
  })

  it('没有 dynamicSlots 的组件行为不变:未知槽位 warning', () => {
    resetRegistry()
    registerWidget(dynDef({ dynamicSlots: undefined }))
    const issues = validateWidgetAgainstRegistry(widget({ 'pt.ia': { mode: 'ts', entity: DEV, key: 'Ia' } }))
    expect(issues).toHaveLength(1)
    expect(issues[0]!.level).toBe('warning')
  })
})

describe('binding-resolver:stamped', () => {
  const collect = () => {
    const seen: Array<[string, string, SlotValue]> = []
    return { seen, onValue: (wid: string, slot: string, v: SlotValue) => void seen.push([wid, slot, v]) }
  }
  const spec =
    (s: Partial<BindingSlotSpec>) =>
    (_w: WidgetConfig, slot: string): BindingSlotSpec => ({ name: slot, valueType: 'number', ...s })

  it('ts:拿到 { v, ts },v 按 valueType 整形,ts 为数据点时间戳(不是到达时间)', () => {
    vi.useFakeTimers()
    vi.setSystemTime(9_999_999)
    const ds = createMockDataSource()
    const { seen, onValue } = collect()
    const h = resolveBindings({ widgets: [widget({ 'pt.ia': { mode: 'ts', entity: DEV, key: 'Ia' } })] }, ds, {
      onValue,
      slotSpec: spec({ stamped: true }),
    })
    // 订阅前先置 null,再是首包(mock:ts=1000,value=1)
    expect(seen.map(s => s[2])).toEqual([null, { v: 1, ts: 1000 }])
    ds.pushTs(DEV, 'Ia', '12.5')
    expect(h.values.w1!['pt.ia']).toEqual({ v: 12.5, ts: 10_001 })
    h.dispose()
  })

  it('attr:ts 取 lastUpdateTs;数据源给不出则 Date.now()', () => {
    vi.useFakeTimers()
    vi.setSystemTime(5_000_000)
    const bindings: WidgetConfig['bindings'] = {
      'pt.pos': { mode: 'attr', entity: DEV, scope: 'SERVER_SCOPE', key: 'pos' },
    }
    const ds = createMockDataSource()
    const h = resolveBindings({ widgets: [widget(bindings)] }, ds, {
      onValue: () => {},
      slotSpec: spec({ stamped: true, valueType: 'string' }),
    })
    expect(h.values.w1!['pt.pos']).toEqual({ v: 'v0', ts: 1000 })
    ds.pushAttr(DEV, 'pos', 'closed')
    expect(h.values.w1!['pt.pos']).toEqual({ v: 'closed', ts: 10_001 })
    h.dispose()

    // 给不出 ts 的数据源
    const ds2 = createMockDataSource()
    const orig = ds2.subscribeAttr.bind(ds2)
    ds2.subscribeAttr = (e, scope, keys, cb, onErr) =>
      orig(e, scope, keys, ups => cb(ups.map(u => ({ ...u, ts: undefined as unknown as number }))), onErr)
    const h2 = resolveBindings({ widgets: [widget(bindings)] }, ds2, {
      onValue: () => {},
      slotSpec: spec({ stamped: true, valueType: 'string' }),
    })
    expect(h2.values.w1!['pt.pos']).toEqual({ v: 'v0', ts: 5_000_000 })
    h2.dispose()
  })

  it('const:{ v, ts: Date.now() }', () => {
    vi.useFakeTimers()
    vi.setSystemTime(7_000_000)
    const ds = createMockDataSource()
    const h = resolveBindings({ widgets: [widget({ 'pt.k': { mode: 'const', value: 42 } })] }, ds, {
      onValue: () => {},
      slotSpec: spec({ stamped: true }),
    })
    expect(h.values.w1!['pt.k']).toEqual({ v: 42, ts: 7_000_000 })
    expect(ds.calls).toHaveLength(0)
  })

  it('非 stamped 槽位输出与改动前一致:裸值,无时间戳', () => {
    const run = (slotSpec?: (w: WidgetConfig, slot: string) => BindingSlotSpec | undefined) => {
      const ds = createMockDataSource()
      const { seen, onValue } = collect()
      const h = resolveBindings(
        {
          widgets: [
            widget({
              a: { mode: 'ts', entity: DEV, key: 'P' },
              b: { mode: 'attr', entity: DEV, scope: 'SERVER_SCOPE', key: 'pos' },
              c: { mode: 'const', value: { any: 1 } },
            }),
          ],
        },
        ds,
        { onValue, ...(slotSpec ? { slotSpec } : {}) }
      )
      ds.pushTs(DEV, 'P', '7')
      ds.pushAttr(DEV, 'pos', 'open')
      h.dispose()
      return seen
    }
    const expected: Array<[string, string, SlotValue]> = [
      ['w1', 'a', null],
      ['w1', 'a', 1],
      ['w1', 'b', null],
      ['w1', 'b', 'v0'],
      ['w1', 'c', { any: 1 }],
      ['w1', 'a', '7'],
      ['w1', 'b', 'open'],
    ]
    // 无规格 / 有规格但 stamped 缺省 / 显式 false:都是裸值
    expect(run()).toEqual(expected)
    expect(run(spec({ valueType: 'any' }))).toEqual(expected)
    expect(run(spec({ valueType: 'any', stamped: false }))).toEqual(expected)
  })
})

describe('widget-runtime:动态规格回退 + 设计态 sampleData(cfg)', () => {
  it('live:动态槽位走 stamped;同一组件的静态槽位仍是裸值', () => {
    registerWidget(dynDef())
    const ds = createMockDataSource()
    const rt = useBindingRuntime()
    rt.setup(
      [widget({ 'pt.ia': { mode: 'ts', entity: DEV, key: 'Ia' }, title: { mode: 'ts', entity: DEV, key: 'name' } })],
      ds,
      false
    )
    expect(rt.values.w1!['pt.ia']).toEqual({ v: 1, ts: 1000 })
    expect(rt.values.w1!.title).toBe('1')
    const subs = rt.stats()!.subscriptions
    expect(subs).toBe(2)
    rt.teardown()
    expect(ds.unsubscribed()).toBe(subs)
  })

  it('design:sampleData 收到该组件的配置,可按 cfg.bindings 的 pt.* 键出占位值;零订阅;const 与运行态同形', () => {
    const sampleData = vi.fn((cfg?: WidgetConfig) =>
      Object.fromEntries(
        Object.keys(cfg?.bindings ?? {})
          .filter(k => k.startsWith('pt.'))
          .map(k => [k, { v: 0, ts: 1 }])
      )
    )
    registerWidget(dynDef({ sampleData }))
    const ds = createMockDataSource()
    const rt = useBindingRuntime()
    const w = widget({
      'pt.ia': { mode: 'ts', entity: DEV, key: 'Ia' },
      'pt.k': { mode: 'const', value: 5 },
      title: { mode: 'const', value: '一号主变' },
    })
    rt.setup([w], ds, true)
    expect(sampleData).toHaveBeenCalledTimes(1)
    expect(sampleData.mock.calls[0]![0]).toBe(w)
    expect(rt.values.w1!['pt.ia']).toEqual({ v: 0, ts: 1 })
    expect(rt.values.w1!['pt.k']).toMatchObject({ v: 5 })
    expect(typeof (rt.values.w1!['pt.k'] as { ts: number }).ts).toBe('number')
    expect(rt.values.w1!.title).toBe('一号主变')
    expect(ds.calls).toHaveLength(0)
  })

  it('无参 sampleData 照常可用', () => {
    registerWidget(dynDef({ sampleData: () => ({ title: '示例' }) }))
    const rt = useBindingRuntime()
    rt.setup([widget({})], null, false)
    expect(rt.values.w1).toEqual({ title: '示例' })
  })
})
