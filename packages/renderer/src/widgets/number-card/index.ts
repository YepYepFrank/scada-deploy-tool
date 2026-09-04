import type { WidgetDefinition } from '../../schema/registry'
import NumberCard from './NumberCard.vue'

export const numberCardWidget: WidgetDefinition = {
  type: 'number-card',
  name: '数字卡',
  category: 'value',
  description: '单个数值 + 单位 + 说明',
  component: NumberCard,
  propsSchema: {
    type: 'object',
    properties: {
      title: { type: 'string', title: '标题', default: '' },
      subtitle: { type: 'string', title: '副标(英文)', default: '' },
      unit: { type: 'string', title: '单位', default: '' },
      decimals: { type: 'integer', title: '小数位', minimum: 0, maximum: 4, default: 1 },
      sub: { type: 'string', title: '说明行', default: '' },
      color: { type: 'string', title: '色条', format: 'color', default: '#3987e5' },
    },
    additionalProperties: false,
  },
  bindingSlots: [{ name: 'value', title: '数值', valueType: 'number', required: true, modes: ['ts', 'attr', 'const'] }],
  defaults: { title: '', subtitle: '', unit: '', decimals: 1, sub: '', color: '#3987e5' },
  sampleData: () => ({ value: 42.5 }),
}
