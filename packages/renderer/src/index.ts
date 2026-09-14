// @grid/scada-renderer 公共入口。
export const version = '0.3.1'
export * from './schema'
export { default as ScadaPage } from './ScadaPage.vue'
/** 单张卡片入口(0.3.0):把页面里的某张卡单独嵌进宿主自己的页面;配 pickWidget 按「页面 id + 组件 id」取卡 */
export { default as ScadaWidget, type ScadaWidgetProps } from './ScadaWidget.vue'
export { pickWidget, listWidgetRefs } from './pick'
export { useBindingRuntime, widgetPropsOf, type BindingRuntime } from './widget-runtime'
export {
  registerWidget,
  registerTemplate,
  getWidget,
  getTemplate,
  listWidgets,
  listTemplates,
  resetRegistry,
  validateAgainstRegistry,
  validateWidgetAgainstRegistry,
  migrateConfigProps,
  type RegistryIssue,
} from './registry'
export { resolveBindings, type ResolverHandle, type SeriesValue, type SlotValue } from './binding-resolver'
export { DATA_SOURCE_KEY, provideDataSource, useDataSource } from './provide'
export { PALETTE, colorAt } from './widgets/_shared/echarts'

export { textWidget } from './widgets/text'
export { numberCardWidget } from './widgets/number-card'
export { gaugeWidget } from './widgets/gauge'
export { lineWidget } from './widgets/line'
export { dualAxisWidget } from './widgets/dual-axis'
export { overviewCardWidget } from './widgets/overview-card'
export { alarmListWidget } from './widgets/alarm-list'
export { statusLightWidget } from './widgets/status-light'
export { tableWidget } from './widgets/table'
export { imageWidget } from './widgets/image'
export { overviewA, monitor3col, grid3x3, cards, builtinTemplates, CARDS_TEMPLATE_ID } from './templates'

import { registerWidget, registerTemplate } from './registry'
import type { WidgetDefinition } from './schema/registry'
import { textWidget } from './widgets/text'
import { numberCardWidget } from './widgets/number-card'
import { gaugeWidget } from './widgets/gauge'
import { lineWidget } from './widgets/line'
import { dualAxisWidget } from './widgets/dual-axis'
import { overviewCardWidget } from './widgets/overview-card'
import { alarmListWidget } from './widgets/alarm-list'
import { statusLightWidget } from './widgets/status-light'
import { tableWidget } from './widgets/table'
import { imageWidget } from './widgets/image'
import { builtinTemplates } from './templates'

/** 包内自带组件:T2.1 迁入 6 种 + T2.2 新建 status-light / table / image + text */
export const builtinWidgets: WidgetDefinition[] = [
  numberCardWidget,
  gaugeWidget,
  lineWidget,
  dualAxisWidget,
  overviewCardWidget,
  alarmListWidget,
  statusLightWidget,
  tableWidget,
  imageWidget,
  textWidget,
]

/** 注册包内自带的组件与模板(宿主启动时调用一次)。重复调用安全。 */
export function registerBuiltins(): void {
  for (const w of builtinWidgets) registerWidget(w)
  for (const t of builtinTemplates) registerTemplate(t)
}
