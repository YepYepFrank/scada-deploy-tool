import type { WidgetDefinition } from '../../schema/registry'
import NumberCard from './NumberCard.vue'

export const numberCardWidget: WidgetDefinition = {
  type: 'number-card',
  name: '数字卡',
  category: 'value',
  component: NumberCard,
  propsSchema: {
    type: 'object',
    properties: {
      title: { type: 'string', title: '标题', default: '' },
      unit: { type: 'string', title: '单位', default: '' },
      decimals: { type: 'integer', title: '小数位', minimum: 0, maximum: 4, default: 1 },
    },
    additionalProperties: false,
  },
  bindingSlots: [{ name: 'value', title: '数值', valueType: 'number', required: true, modes: ['ts', 'attr', 'const'] }],
  defaults: { title: '', unit: '', decimals: 1 },
  sampleData: () => ({ value: 42.5 }),
}
