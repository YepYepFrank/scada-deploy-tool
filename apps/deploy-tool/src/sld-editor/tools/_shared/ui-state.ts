/**
 * 工具的界面状态(对话框开没开、底图显不显示…)按编辑器实例存:键是 SldEditorContext 对象本身。
 * 工具的 run(ctx) 与挂在图层里的组件 inject 到的是同一个 ctx,两边靠它对上;页面上同时开两个编辑器也互不串。
 */
import { reactive } from 'vue'
import type { SldEditorContext } from '../../ext'

export function perEditorState<T extends object>(init: () => T): (ctx: SldEditorContext) => T {
  const map = new WeakMap<SldEditorContext, T>()
  return ctx => {
    let state = map.get(ctx)
    if (!state) {
      state = reactive(init()) as T
      map.set(ctx, state)
    }
    return state
  }
}
