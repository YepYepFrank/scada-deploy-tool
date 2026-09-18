/**
 * 组件绑定运行时:把一组 WidgetConfig 的绑定接进 Vue 响应式状态(values / bindErrors)。
 * <ScadaPage>(整页)与 <ScadaWidget>(单张卡)共用这一份;逻辑就是原来 ScadaPage 的 setup():
 *   design 或无数据源 → 用组件 sampleData(cfg)(+ const 绑定)画;否则 resolveBindings 建订阅,teardown 全部退订。
 * 槽位规格统一走 findSlotSpec:静态槽位找不到时回退到动态槽位(前缀匹配)。
 */
import { reactive } from 'vue'
import type { DataSource } from '@grid/tb-client'
import type { WidgetConfig } from './schema/page-config'
import type { WidgetEventPayload } from './schema/scada-page'
import { findSlotSpec, getWidget } from './registry'
import { resolveBindings, type ResolverHandle, type SlotValue } from './binding-resolver'

export interface BindingRuntime {
  /** values[widgetId][slotName] */
  readonly values: Record<string, Record<string, SlotValue>>
  /** bindErrors[widgetId][slotName] = 错误文本 */
  readonly bindErrors: Record<string, Record<string, string>>
  /** 重建:先退订旧的、清空状态,再按 widgets 建立订阅(design / 无数据源时只放 sampleData) */
  setup(widgets: WidgetConfig[], ds: DataSource | null, design: boolean): void
  /** 退订全部(卸载时调用;setup 内部也会先调) */
  teardown(): void
  /** 解析器统计(测试 / 排障);无订阅时为 null */
  stats(): ResolverHandle['stats'] | null
}

export function useBindingRuntime(
  onBindError?: (widgetId: string, slot: string, message: string) => void
): BindingRuntime {
  const values = reactive<Record<string, Record<string, SlotValue>>>({})
  const bindErrors = reactive<Record<string, Record<string, string>>>({})
  let handle: ResolverHandle | null = null

  function teardown() {
    handle?.dispose()
    handle = null
  }

  function setup(widgets: WidgetConfig[], ds: DataSource | null, design: boolean) {
    teardown()
    for (const k of Object.keys(values)) delete values[k]
    for (const k of Object.keys(bindErrors)) delete bindErrors[k]
    if (design || !ds) {
      for (const w of widgets) {
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
    handle = resolveBindings({ widgets }, ds, {
      onValue: (wid, slot, v) => {
        ;(values[wid] ??= {})[slot] = v
      },
      onError: (wid, slot, err) => {
        const message = err instanceof Error ? err.message : String(err)
        ;(bindErrors[wid] ??= {})[slot] = message
        onBindError?.(wid, slot, message)
      },
      slotSpec: (w, slot) => {
        const def = getWidget(w.type)
        return def ? findSlotSpec(def, slot) : undefined
      },
    })
  }

  return { values, bindErrors, setup, teardown, stats: () => handle?.stats ?? null }
}

/**
 * 组件事件 → 对外载荷:组件内 `emit('widget-event', { name, detail? })`,这里补上 widgetId / type。
 * 形状不对(没有字符串 name)返回 null,调用方不抛——组件写错不该让宿主收到半截事件。
 */
export function toWidgetEvent(cfg: WidgetConfig, ev: unknown): WidgetEventPayload | null {
  if (!ev || typeof ev !== 'object') return null
  const { name, detail } = ev as { name?: unknown; detail?: unknown }
  if (typeof name !== 'string' || !name) return null
  return { widgetId: cfg.id, type: cfg.type, name, ...(detail !== undefined ? { detail } : {}) }
}

/** 组件 props:defaults + 配置(先过组件的 migrateProps 把旧键名正规化) */
export function widgetPropsOf(cfg: WidgetConfig): Record<string, unknown> {
  const def = getWidget(cfg.type)
  const raw = (cfg.props ?? {}) as Record<string, unknown>
  return { ...(def?.defaults ?? {}), ...(def?.migrateProps ? def.migrateProps(raw) : raw) }
}
