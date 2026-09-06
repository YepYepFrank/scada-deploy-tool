import type { WidgetDefinition } from '../../schema/registry'
import LineChartWidget from './LineChartWidget.vue'

const sampleSeries = (name: string, phase = 0, base = 100, amp = 40) => ({
  name,
  points: Array.from({ length: 48 }, (_, i) => ({
    ts: Date.now() - (48 - i) * 5 * 60_000,
    value: Math.round((base + Math.sin(i / 6 + phase) * amp) * 10) / 10,
  })),
})

export const lineWidget: WidgetDefinition = {
  type: 'line',
  name: '曲线',
  category: 'chart',
  description: '折线 / 面积 / 柱状,多序列',
  component: LineChartWidget,
  propsSchema: {
    type: 'object',
    properties: {
      title: { type: 'string', title: '标题', default: '' },
      subtitle: { type: 'string', title: '副标', default: '' },
      unit: { type: 'string', title: '单位', default: '' },
      chartStyle: {
        type: 'string',
        title: '样式',
        enum: ['line', 'area', 'bar'],
        enumNames: ['折线', '面积', '柱状'],
        default: 'line',
      },
      smooth: { type: 'boolean', title: '平滑', default: false },
      showLegend: { type: 'boolean', title: '图例', default: true },
      decimals: { type: 'integer', title: '小数位', minimum: 0, maximum: 4, default: 1 },
    },
    additionalProperties: false,
  },
  bindingSlots: [
    {
      name: 'series',
      title: '序列',
      valueType: 'series',
      required: true,
      multiple: true,
      modes: ['ts-history', 'ext', 'const'],
    },
  ],
  defaults: { title: '', unit: '', chartStyle: 'line', smooth: false, showLegend: true, decimals: 1 },
  /** 0.1.x 的 `style` 与 Vue 保留属性同名(test-utils 会警告),0.2.0 改为 chartStyle;旧配置在渲染前转一下 */
  migrateProps: props => {
    if (!('style' in props) || 'chartStyle' in props) return props
    const { style, ...rest } = props
    return { ...rest, chartStyle: style }
  },
  sampleData: () => ({ series: [sampleSeries('有功', 0), sampleSeries('无功', 1.2, 40, 15)] }),
}

export { sampleSeries }
