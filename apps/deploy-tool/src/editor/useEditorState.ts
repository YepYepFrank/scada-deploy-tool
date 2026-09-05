/**
 * 编辑器状态(T3.2):一份 PageConfig + 不可变快照栈实现撤销 / 重做(深度默认 50)。
 * 约定:每次修改都通过 update()/commit() 产生一份新快照,组件里不直接改 state.config;
 * 一个槽位只放一个组件(模板槽位 = 组件位),这是编辑器的简化,契约本身允许一槽多组件。
 */
import { computed, reactive, readonly } from 'vue'
import type { PageConfig, TemplateDefinition, WidgetConfig, WidgetDefinition } from '@grid/scada-renderer'

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T

export interface EditorStateOptions {
  /** 快照栈深度(撤销步数上限) */
  depth?: number
}

export function useEditorState(initial: PageConfig, opts: EditorStateOptions = {}) {
  const depth = opts.depth ?? 50
  const past: PageConfig[] = []
  const future: PageConfig[] = []
  const state = reactive({
    config: clone(initial),
    /** 每次快照变化 +1,便于 watch */
    version: 0,
    pastCount: 0,
    futureCount: 0,
  })
  const sync = () => {
    state.pastCount = past.length
    state.futureCount = future.length
    state.version++
  }

  /** 用一份完整配置作为新快照 */
  function commit(next: PageConfig) {
    past.push(clone(state.config))
    if (past.length > depth) past.shift()
    future.length = 0
    state.config = clone(next)
    sync()
  }
  /** 在当前配置的副本上修改,然后作为新快照 */
  function update(mutate: (draft: PageConfig) => void) {
    const draft = clone(state.config)
    mutate(draft)
    commit(draft)
  }
  function undo(): boolean {
    const prev = past.pop()
    if (!prev) return false
    future.push(clone(state.config))
    state.config = prev
    sync()
    return true
  }
  function redo(): boolean {
    const next = future.pop()
    if (!next) return false
    past.push(clone(state.config))
    state.config = next
    sync()
    return true
  }
  /** 回到某份配置并清空历史(载入 / 导入) */
  function reset(next: PageConfig = initial) {
    past.length = 0
    future.length = 0
    state.config = clone(next)
    sync()
  }

  // ---------- 面向槽位的便捷操作 ----------

  /**
   * 换模板:槽位名相同且 accepts 允许的组件原位保留,其余丢弃;返回被丢弃的组件 id。
   * 模板从注册表取,调用方传 TemplateDefinition(编辑器不 import 注册表以便测试)。
   */
  function setTemplate(tpl: TemplateDefinition): string[] {
    const dropped: string[] = []
    update(d => {
      d.template = tpl.id
      d.widgets = d.widgets.filter(w => {
        const slot = tpl.slots.find(s => s.name === w.slot)
        const ok =
          !!slot && (!slot.accepts || slot.accepts.includes(w.type)) && (!slot.fixed || slot.fixed.type === w.type)
        if (!ok) dropped.push(w.id)
        return ok
      })
    })
    return dropped
  }

  /** 给槽位放一个组件(替换该槽位原有组件);返回新组件 */
  function placeWidget(slot: string, def: WidgetDefinition, extra: Partial<WidgetConfig> = {}): WidgetConfig {
    const widget: WidgetConfig = {
      id: uniqueId(state.config, `${def.type}-${slot}`),
      slot,
      type: def.type,
      props: clone((def.defaults ?? {}) as Record<string, unknown>),
      bindings: {},
      ...extra,
    }
    update(d => {
      d.widgets = [...d.widgets.filter(w => w.slot !== slot), widget]
    })
    return widget
  }
  function removeWidget(slot: string) {
    update(d => {
      d.widgets = d.widgets.filter(w => w.slot !== slot)
    })
  }
  function patchWidget(id: string, patch: (w: WidgetConfig) => void) {
    update(d => {
      const w = d.widgets.find(x => x.id === id)
      if (w) patch(w)
    })
  }
  const widgetAt = (slot: string) => state.config.widgets.find(w => w.slot === slot)

  return {
    /** 只读视图;修改走 update / commit */
    state: readonly(state),
    config: computed(() => state.config as PageConfig),
    canUndo: computed(() => state.pastCount > 0),
    canRedo: computed(() => state.futureCount > 0),
    commit,
    update,
    undo,
    redo,
    reset,
    setTemplate,
    placeWidget,
    removeWidget,
    patchWidget,
    widgetAt,
    /** 当前配置的深拷贝(导出用) */
    snapshot: () => clone(state.config) as PageConfig,
  }
}

export type EditorState = ReturnType<typeof useEditorState>

function uniqueId(cfg: PageConfig, base: string): string {
  const ids = new Set(cfg.widgets.map(w => w.id))
  if (!ids.has(base)) return base
  let i = 2
  while (ids.has(`${base}-${i}`)) i++
  return `${base}-${i}`
}
