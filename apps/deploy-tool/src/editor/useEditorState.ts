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

/** 换模板的结果:挪了槽位的、从「收起来」里放回的、这次放不下被收起来的(都是组件 id) */
export interface TemplateSwitchResult {
  moved: Array<{ id: string; from: string; to: string }>
  restored: string[]
  parked: string[]
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
   * 换模板时放不进新模板的组件先收在这里(只在内存,不进页面 JSON、不发布);之后再换到放得下的模板会自动放回。
   * 2026-09-21:此前放不下的直接丢——画了半天的一次接线图,换个模板看一眼再换回来就没了,只能靠撤销救。
   */
  const parked: WidgetConfig[] = []

  /**
   * 换模板,**尽量不丢组件**:
   * 1. 槽位名相同且新槽位收这种组件 → 原位保留;
   * 2. 其余的(连同之前收起来的)挪到新模板里**空着、又收这种组件**的槽位:接线图优先、挑面积最大的槽位,
   *    其他组件按模板里的槽位顺序;固定槽位只放它指定的类型;
   * 3. 实在放不下的收进 parked(见上),下次换模板再试。
   * 模板从注册表取,调用方传 TemplateDefinition(编辑器不 import 注册表以便测试)。
   */
  function setTemplate(tpl: TemplateDefinition): TemplateSwitchResult {
    const result: TemplateSwitchResult = { moved: [], restored: [], parked: [] }
    const fits = (w: WidgetConfig, slot: TemplateDefinition['slots'][number]): boolean =>
      slot.fixed ? slot.fixed.type === w.type : !slot.accepts || slot.accepts.includes(w.type)
    const areaOf = (slot: TemplateDefinition['slots'][number]): number =>
      typeof slot.area === 'string' ? 0 : slot.area.w * slot.area.h
    update(d => {
      d.template = tpl.id
      const present = new Set(d.widgets.map(w => w.id))
      const fromPark = parked.filter(w => !present.has(w.id)).map(w => clone(w))
      const parkedIds = new Set(fromPark.map(w => w.id))
      const taken = new Map<string, WidgetConfig>()
      const rest: WidgetConfig[] = []
      // ① 原位保留(页面上现有的优先于收起来的)
      for (const w of [...d.widgets, ...fromPark]) {
        const slot = tpl.slots.find(s => s.name === w.slot)
        if (slot && fits(w, slot) && !taken.has(slot.name)) taken.set(slot.name, w)
        else rest.push(w)
      }
      // ② 挪到空着的兼容槽位:接线图先挑、挑最大的
      rest.sort((a, b) => Number(b.type === 'sld') - Number(a.type === 'sld'))
      const left: WidgetConfig[] = []
      for (const w of rest) {
        const free = tpl.slots.filter(s => !taken.has(s.name) && fits(w, s))
        const slot = w.type === 'sld' ? [...free].sort((a, b) => areaOf(b) - areaOf(a))[0] : free[0]
        if (!slot) {
          left.push(w)
          continue
        }
        if (slot.name !== w.slot) result.moved.push({ id: w.id, from: w.slot, to: slot.name })
        w.slot = slot.name
        taken.set(slot.name, w)
      }
      for (const w of taken.values()) if (parkedIds.has(w.id)) result.restored.push(w.id)
      // 按模板的槽位顺序落盘,页面 JSON 稳定好 diff
      d.widgets = tpl.slots.flatMap(s => (taken.has(s.name) ? [taken.get(s.name)!] : []))
      // ③ 放不下的收起来
      const placed = new Set(d.widgets.map(w => w.id))
      for (let i = parked.length - 1; i >= 0; i--) if (placed.has(parked[i]!.id)) parked.splice(i, 1)
      for (const w of left) {
        result.parked.push(w.id)
        if (!parked.some(p => p.id === w.id)) parked.push(clone(w))
      }
    })
    return result
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
