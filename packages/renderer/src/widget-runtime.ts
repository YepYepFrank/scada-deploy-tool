/**
 * 组件绑定运行时:把一组 WidgetConfig 的绑定接进 Vue 响应式状态(values / bindErrors)。
 * <ScadaPage>(整页)与 <ScadaWidget>(单张卡)共用这一份;逻辑就是原来 ScadaPage 的 setup():
 *   design 或无数据源 → 用组件 sampleData(cfg)(+ const 绑定)画;否则 resolveBindings 建订阅,teardown 全部退订。
 * 槽位规格统一走 findSlotSpec:静态槽位找不到时回退到动态槽位(前缀匹配)。
 */
import { reactive } from 'vue'
import type { DataSource, EntityRef } from '@grid/tb-client'
import type { WidgetConfig } from './schema/page-config'
import type { WidgetEventPayload } from './schema/scada-page'
import { findSlotSpec, getWidget } from './registry'
import { resolveBindings, type ResolverHandle, type SlotValue } from './binding-resolver'
import { applyContext, type BindingContext, type ConcreteWidget, type ContextStatus } from './binding-context'

/** 组件因上下文而处于的非正常状态(0.9.0):empty = 未选择设备等;hide = 不画;error = 上下文不对 */
export interface WidgetContextState {
  status: Exclude<ContextStatus, 'ok'>
  message: string
}

export interface BindingRuntime {
  /** values[widgetId][slotName] */
  readonly values: Record<string, Record<string, SlotValue>>
  /** bindErrors[widgetId][slotName] = 错误文本 */
  readonly bindErrors: Record<string, Record<string, string>>
  /** ctxStates[widgetId]:缺上下文 / 上下文不对的组件;正常的组件不在里面 */
  readonly ctxStates: Record<string, WidgetContextState>
  /** resolved[widgetId]:绑定已换成具体值的组件配置(给声明了 receivesBindings 的组件、事件里带实体用) */
  readonly resolved: Record<string, ConcreteWidget>
  /**
   * 对账式重建(0.9.0 起按组件粒度):只动「具体绑定」变了的组件,其余订阅原样保留——
   * 上下文换设备时固定绑定的汇总卡不断流、不闪。数据源 / design 变了才全部重来。
   * design / 无数据源时只放 sampleData,不订阅、不看上下文。
   */
  setup(widgets: WidgetConfig[], ds: DataSource | null, design: boolean, context?: BindingContext | null): void
  /** 退订全部(卸载时调用) */
  teardown(): void
  /** 解析器统计(测试 / 排障):存活与已退役订阅的累计;从未建立过订阅时为 null */
  stats(): ResolverHandle['stats'] | null
}

export function useBindingRuntime(
  onBindError?: (widgetId: string, slot: string, message: string) => void
): BindingRuntime {
  const values = reactive<Record<string, Record<string, SlotValue>>>({})
  const bindErrors = reactive<Record<string, Record<string, string>>>({})
  const ctxStates = reactive<Record<string, WidgetContextState>>({})
  const resolved = reactive<Record<string, ConcreteWidget>>({}) as Record<string, ConcreteWidget>
  /** 每个组件一份订阅句柄 + 它当时的「具体绑定」指纹 */
  const live = new Map<string, { sig: string; handle: ResolverHandle | null }>()
  const retired = { subscriptions: 0, unsubscribed: 0, errors: 0 }
  let everLive = false
  let lastDs: DataSource | null = null
  let lastDesign: boolean | null = null

  function drop(id: string) {
    const cur = live.get(id)
    if (cur?.handle) {
      cur.handle.dispose()
      retired.subscriptions += cur.handle.stats.subscriptions
      retired.unsubscribed += cur.handle.stats.unsubscribed
      retired.errors += cur.handle.stats.errors
    }
    live.delete(id)
    delete values[id]
    delete bindErrors[id]
    delete ctxStates[id]
    delete resolved[id]
  }

  function teardown() {
    for (const id of [...live.keys()]) drop(id)
  }

  function setup(widgets: WidgetConfig[], ds: DataSource | null, design: boolean, context?: BindingContext | null) {
    if (ds !== lastDs || design !== lastDesign) teardown()
    lastDs = ds
    lastDesign = design

    if (design || !ds) {
      // 设计态没有订阅,整体重放(sampleData 可能依赖 props,不值得做指纹)
      teardown()
      for (const w of widgets) {
        live.set(w.id, { sig: '', handle: null })
        const def = getWidget(w.type)
        // 把组件配置传给 sampleData:有动态槽位的组件(sld)按 cfg.bindings 的键出占位值
        const sample = def?.sampleData?.(w) ?? {}
        values[w.id] = { ...sample }
        for (const [slot, b] of Object.entries(w.bindings)) {
          const one = Array.isArray(b) ? b[0] : b
          if (!one || one.mode !== 'const') continue
          // stamped 槽位的 const 与运行态同形({ v, ts }),组件不用分两种读法
          const stamped = def ? findSlotSpec(def, slot)?.stamped : false
          values[w.id]![slot] = stamped ? { v: one.value, ts: Date.now() } : (one.value as SlotValue)
        }
      }
      return
    }

    const keep = new Set(widgets.map(w => w.id))
    for (const id of [...live.keys()]) if (!keep.has(id)) drop(id)

    for (const w of widgets) {
      const res = applyContext(w, context)
      const sig = JSON.stringify(
        res.status === 'ok' ? [w.type, res.widget!.bindings] : [w.type, res.status, res.message ?? '']
      )
      if (live.get(w.id)?.sig === sig) {
        // 订阅不用动;但 receivesBindings 的组件要拿到最新的配置对象(props 可能改了)
        if (res.widget) resolved[w.id] = res.widget
        continue
      }
      drop(w.id)
      if (res.status !== 'ok' || !res.widget) {
        live.set(w.id, { sig, handle: null })
        ctxStates[w.id] = { status: res.status as WidgetContextState['status'], message: res.message ?? '' }
        if (res.status === 'error') {
          ;(bindErrors[w.id] ??= {})['(context)'] = res.message ?? ''
          onBindError?.(w.id, '(context)', res.message ?? '')
        }
        continue
      }
      resolved[w.id] = res.widget
      everLive = true
      // 已经是具体绑定,解析器里的 applyContext 原样放行,不用再传上下文
      const handle = resolveBindings({ widgets: [res.widget as unknown as WidgetConfig] }, ds, {
        onValue: (wid, slot, v) => {
          ;(values[wid] ??= {})[slot] = v
        },
        onError: (wid, slot, err) => {
          const message = err instanceof Error ? err.message : String(err)
          ;(bindErrors[wid] ??= {})[slot] = message
          onBindError?.(wid, slot, message)
        },
        slotSpec: (cfg, slot) => {
          const def = getWidget(cfg.type)
          return def ? findSlotSpec(def, slot) : undefined
        },
      })
      live.set(w.id, { sig, handle })
    }
  }

  function stats() {
    if (!everLive) return null
    const out = { ...retired }
    for (const { handle } of live.values()) {
      if (!handle) continue
      out.subscriptions += handle.stats.subscriptions
      out.unsubscribed += handle.stats.unsubscribed
      out.errors += handle.stats.errors
    }
    return out
  }

  return { values, bindErrors, ctxStates, resolved, setup, teardown, stats }
}

/**
 * 组件事件 → 对外载荷:组件内 `emit('widget-event', { name, detail? })`,这里补上 widgetId / type。
 * 形状不对(没有字符串 name)返回 null,调用方不抛——组件写错不该让宿主收到半截事件。
 */
/** 这张卡的(具体)绑定里只出现过一个实体时返回它;多个 / 没有返回 undefined */
export function soleEntityOf(w: Pick<ConcreteWidget, 'bindings'> | undefined): EntityRef | undefined {
  if (!w) return undefined
  const seen = new Map<string, EntityRef>()
  for (const b of Object.values(w.bindings))
    for (const one of Array.isArray(b) ? b : [b]) {
      const e = 'entity' in one ? one.entity : (one as { params?: { entity?: EntityRef } }).params?.entity
      if (e && typeof e === 'object' && typeof e.id === 'string') seen.set(`${e.type}:${e.id}`, e)
    }
  return seen.size === 1 ? [...seen.values()][0] : undefined
}

/** 整卡点击事件(0.9.0):任何组件都抛;该卡只绑了一个实体时 detail 里带上它 */
export function clickEventOf(cfg: WidgetConfig, concrete: ConcreteWidget | undefined): WidgetEventPayload {
  const entity = soleEntityOf(concrete)
  return { widgetId: cfg.id, type: cfg.type, name: 'click', detail: entity ? { entity } : {} }
}

export function toWidgetEvent(cfg: WidgetConfig, ev: unknown): WidgetEventPayload | null {
  if (!ev || typeof ev !== 'object') return null
  const { name, detail } = ev as { name?: unknown; detail?: unknown }
  if (typeof name !== 'string' || !name) return null
  return { widgetId: cfg.id, type: cfg.type, name, ...(detail !== undefined ? { detail } : {}) }
}

/**
 * 组件 props:defaults + 配置(先过组件的 migrateProps 把旧键名正规化);
 * 组件定义声明 `receivesBindings` 时再附上它自己的绑定(prop `bindings`,只读)。
 * <ScadaPage> / <ScadaWidget> / 放大层都经这里取 props,三处行为一致。
 */
export function widgetPropsOf(cfg: WidgetConfig, concrete?: ConcreteWidget): Record<string, unknown> {
  const def = getWidget(cfg.type)
  const raw = (cfg.props ?? {}) as Record<string, unknown>
  const props = { ...(def?.defaults ?? {}), ...(def?.migrateProps ? def.migrateProps(raw) : raw) }
  // 有上下文解析结果就给具体绑定(0.9.0):组件看到的永远是「实体 id + 测点 key」,不用懂 source: 'context'
  return def?.receivesBindings ? { ...props, bindings: (concrete ?? cfg).bindings } : props
}
