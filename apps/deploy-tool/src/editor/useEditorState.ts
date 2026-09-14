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

  /** 连续编辑同一个字段(打字 / 拖颜色)合并成一个撤销步:上一次 commit 的合并键 */
  let lastCoalesce: string | null = null

  /**
   * 用一份完整配置作为新快照。传 coalesce 时,若与上一次 commit 的键相同,则不新增快照、只替换当前配置,
   * 这样属性面板里连续输入只占一个撤销步;任何其它操作(含 undo / redo)都会打断合并。
   */
  function commit(next: PageConfig, opts: { coalesce?: string } = {}) {
    if (!(opts.coalesce && opts.coalesce === lastCoalesce)) {
      past.push(clone(state.config))
      if (past.length > depth) past.shift()
      future.length = 0
    }
    lastCoalesce = opts.coalesce ?? null
    state.config = clone(next)
    sync()
  }
  /** 在当前配置的副本上修改,然后作为新快照 */
  function update(mutate: (draft: PageConfig) => void, opts: { coalesce?: string } = {}) {
    const draft = clone(state.config)
    mutate(draft)
    commit(draft, opts)
  }
  function undo(): boolean {
    lastCoalesce = null
    const prev = past.pop()
    if (!prev) return false
    future.push(clone(state.config))
    state.config = prev
    sync()
    return true
  }
  function redo(): boolean {
    lastCoalesce = null
    const next = future.pop()
    if (!next) return false
    past.push(clone(state.config))
    state.config = next
    sync()
    return true
  }
  /** 回到某份配置并清空历史(载入 / 导入) */
  function reset(next: PageConfig = initial) {
    lastCoalesce = null
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

  /**
   * 给槽位放一个组件(替换该槽位原有组件);返回新组件。
   * id 规则(2026-09-14,宿主按「页面 id + 组件 id」引用单张卡片,见 docs/方案讨论-单卡片嵌入-2026-09-14.md):
   * 创建时生成一次(`w_` + 8 位随机,与槽位、类型无关),之后改属性 / 绑定 / 换模板都不变;
   * 换组件类型 = 新组件 = 新 id。将来加「移动 / 复制」:移动只改 slot 不改 id,复制生成新 id。
   */
  function placeWidget(slot: string, def: WidgetDefinition, extra: Partial<WidgetConfig> = {}): WidgetConfig {
    const widget: WidgetConfig = {
      id: newWidgetId(state.config),
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
  function patchWidget(id: string, patch: (w: WidgetConfig) => void, opts: { coalesce?: string } = {}) {
    update(d => {
      const w = d.widgets.find(x => x.id === id)
      if (w) patch(w)
    }, opts)
  }
  /** 属性面板:整份 props 替换;同一组件连续修改合并为一个撤销步 */
  function setWidgetProps(id: string, props: Record<string, unknown>) {
    patchWidget(id, w => (w.props = props), { coalesce: `props:${id}` })
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
    setWidgetProps,
    widgetAt,
    /** 当前配置的深拷贝(导出用) */
    snapshot: () => clone(state.config) as PageConfig,
  }
}

export type EditorState = ReturnType<typeof useEditorState>

/** 页内唯一的稳定组件 id:`w_` + 8 位 [0-9a-z](contract pattern ^[A-Za-z0-9_-]+$);撞上已有 id 就重来 */
export function newWidgetId(cfg: Pick<PageConfig, 'widgets'>): string {
  const ids = new Set(cfg.widgets.map(w => w.id))
  for (;;) {
    const id = `w_${randomBase36(8)}`
    if (!ids.has(id)) return id
  }
}
function randomBase36(n: number): string {
  const bytes = new Uint8Array(n)
  const c = globalThis.crypto
  if (c?.getRandomValues) c.getRandomValues(bytes)
  else for (let i = 0; i < n; i++) bytes[i] = Math.floor(Math.random() * 256)
  return Array.from(bytes, b => (b % 36).toString(36)).join('')
}
