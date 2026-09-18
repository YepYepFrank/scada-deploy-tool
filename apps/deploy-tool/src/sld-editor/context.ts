/**
 * 骨架在 `SldEditorContext`(ext.ts,只读契约)之外多给的一点东西:视口操作。
 * 契约里没有「适应窗口 / 缩放」这类入口,而扩展又不许直接碰 X6——骨架自带的「适应窗口」工具靠它。
 * 这是骨架内部约定,不是契约;建议把 `view` 收进 ext.ts(见 T5.5 交付说明)。扩展要用先 `hasView(ctx)` 判一下。
 */
import type { Ref } from 'vue'
import type { SldEditorContext } from './ext'

export interface SldEditorView {
  /** 当前缩放倍数(1 = 100%) */
  readonly zoom: Readonly<Ref<number>>
  /** 整张图缩放到窗口内并居中(最大不超过 100%) */
  fit(): void
  /** 以视口中心为基准缩放:factor > 1 放大 */
  zoomBy(factor: number): void
  /** 回到 100% */
  resetZoom(): void
}

export interface SldEditorContextEx extends SldEditorContext {
  readonly view: SldEditorView
}

export const hasView = (ctx: SldEditorContext): ctx is SldEditorContextEx =>
  typeof (ctx as Partial<SldEditorContextEx>).view?.fit === 'function'
