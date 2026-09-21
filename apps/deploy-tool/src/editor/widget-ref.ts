/**
 * 前端引用一张卡的文本(2026-09-14 P3;2026-09-17 抽出来给卡片库列表共用):
 * 引用 = { pageId, widgetId };接入代码 = 四行 pickWidget + <ScadaWidget>。
 */
import { contextKeysOf, type WidgetConfig } from '@grid/scada-renderer'

/** 卡片标题:props.title 有就用,否则回退到给定的名字(组件类型名) */
export const widgetTitle = (w: WidgetConfig, fallback = w.type): string =>
  (typeof w.props?.title === 'string' && w.props.title.trim()) || fallback

export const refJson = (pageId: string | null, widgetId: string): string => JSON.stringify({ pageId, widgetId })

/** 这张卡要宿主喂哪些上下文键(渲染器 0.9.0 BindingContext);不跟随上下文的卡返回空数组 */
export const widgetContextKeys = (w: WidgetConfig): string[] => contextKeysOf([w])

export function refSnippet(pageId: string | null, w: WidgetConfig, title = widgetTitle(w)): string {
  const keys = widgetContextKeys(w)
  return [
    `// 页面资产 ${pageId ?? '<发布后的页面 id>'} · 组件 ${w.id}(${w.type}${title !== w.type ? ' · ' + title : ''})`,
    ...(keys.length
      ? [
          `// 这张卡跟随页面上下文,需要宿主提供:${keys.join('、')}(:binding-context 或 provideBindingContext();渲染器 ≥ 0.9.0)`,
        ]
      : []),
    `const page = validatePageConfig(JSON.parse(raw.pageConfig)).value   // 该资产 SERVER_SCOPE 属性 pageConfig`,
    `const card = pickWidget(page, '${w.id}')`,
    keys.length
      ? `<div class="my-cell"><ScadaWidget v-if="card" :config="card" :binding-context="ctx" /></div>`
      : `<div class="my-cell"><ScadaWidget v-if="card" :config="card" /></div>`,
  ].join('\n')
}
