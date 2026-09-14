/**
 * 从页面配置里取一张卡(2026-09-14):宿主按「页面 id + 组件 id」引用单张卡片时用。
 * 组件 id 由工具在创建时生成一次、之后不变(改属性 / 绑定 / 换模板都不变;换组件类型 = 另一张卡 = 新 id)。
 */
import type { PageConfig, WidgetConfig } from './schema/page-config'

/** 找不到返回 undefined(不抛错:引用断了让宿主自己决定怎么提示) */
export function pickWidget(page: Pick<PageConfig, 'widgets'>, widgetId: string): WidgetConfig | undefined {
  return page?.widgets?.find(w => w.id === widgetId)
}

/** 页面里全部卡片的摘要(工具「复制引用」/ 命令行清单用) */
export function listWidgetRefs(
  page: Pick<PageConfig, 'widgets'>
): { id: string; type: string; slot: string; title: string | undefined }[] {
  return (page?.widgets ?? []).map(w => ({
    id: w.id,
    type: w.type,
    slot: w.slot,
    title: typeof w.props?.title === 'string' ? (w.props.title as string) : undefined,
  }))
}
