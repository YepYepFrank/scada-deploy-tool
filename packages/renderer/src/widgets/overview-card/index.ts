import type { WidgetDefinition } from '../../schema/registry'
import OverviewCard from './OverviewCard.vue'

export const overviewCardWidget: WidgetDefinition = {
  type: 'overview-card',
  name: '多指标概览卡',
  category: 'value',
  description: '一列指标:标签 · 当前值 · 单位',
  component: OverviewCard,
  propsSchema: {
    type: 'object',
    properties: {
      title: { type: 'string', title: '标题', default: '' },
      subtitle: { type: 'string', title: '副标', default: '' },
      compact: { type: 'boolean', title: '紧凑', default: false },
      items: {
        type: 'array',
        title: '指标(与绑定顺序对应)',
        items: {
          type: 'object',
          properties: {
            label: { type: 'string', title: '标签' },
            unit: { type: 'string', title: '单位' },
            decimals: { type: 'integer', title: '小数位', minimum: 0, maximum: 4 },
          },
        },
        minItems: 0,
        maxItems: 8,
      },
    },
    additionalProperties: false,
  },
  bindingSlots: [
    {
      name: 'items',
      title: '指标',
      valueType: 'number',
      required: true,
      multiple: true,
      modes: ['ts', 'attr', 'const'],
    },
  ],
  defaults: { title: '', compact: false, items: [] },
  sampleData: () => ({
    items: [
      { name: '总有功', value: 1234.5 },
      { name: '总无功', value: 213.2 },
      { name: '功率因数', value: 0.97 },
      { name: '频率', value: 50.02 },
    ],
  }),
}
