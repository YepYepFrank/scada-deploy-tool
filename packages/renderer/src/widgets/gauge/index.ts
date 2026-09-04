import type { WidgetDefinition } from '../../schema/registry'
import Gauge from './Gauge.vue'

export const gaugeWidget: WidgetDefinition = {
  type: 'gauge',
  name: '仪表盘',
  category: 'value',
  description: '半圆仪表:值相对量程的占比',
  component: Gauge,
  propsSchema: {
    type: 'object',
    properties: {
      title: { type: 'string', title: '标题', default: '' },
      subtitle: { type: 'string', title: '副标', default: '' },
      unit: { type: 'string', title: '单位', default: '' },
      min: { type: 'number', title: '量程下限', default: 0 },
      max: { type: 'number', title: '量程上限', default: 100 },
      color: { type: 'string', title: '颜色', format: 'color', default: '#3987e5' },
      decimals: { type: 'integer', title: '小数位', minimum: 0, maximum: 4, default: 1 },
    },
    additionalProperties: false,
  },
  bindingSlots: [{ name: 'value', title: '数值', valueType: 'number', required: true, modes: ['ts', 'attr', 'const'] }],
  defaults: { title: '', unit: '', min: 0, max: 100, color: '#3987e5', decimals: 1 },
  sampleData: () => ({ value: 63.5 }),
}
