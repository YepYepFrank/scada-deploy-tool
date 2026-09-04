// @grid/scada-renderer 公共入口。
export const version = '0.1.0-dev'
export * from './schema'
export { default as ScadaPage } from './ScadaPage.vue'
export {
  registerWidget,
  registerTemplate,
  getWidget,
  getTemplate,
  listWidgets,
  listTemplates,
  resetRegistry,
  validateAgainstRegistry,
  type RegistryIssue,
} from './registry'
export { resolveBindings, type ResolverHandle, type SeriesValue, type SlotValue } from './binding-resolver'
export { DATA_SOURCE_KEY, provideDataSource, useDataSource } from './provide'
export { textWidget } from './widgets/text'
export { numberCardWidget } from './widgets/number-card'
export { overviewA } from './templates/overview-a'

import { registerWidget, registerTemplate } from './registry'
import { textWidget } from './widgets/text'
import { numberCardWidget } from './widgets/number-card'
import { overviewA } from './templates/overview-a'

/** 注册包内自带的组件与模板(宿主启动时调用一次;T2.x 组件陆续加入)。重复调用安全。 */
export function registerBuiltins(): void {
  registerWidget(textWidget)
  registerWidget(numberCardWidget)
  registerTemplate(overviewA)
}
