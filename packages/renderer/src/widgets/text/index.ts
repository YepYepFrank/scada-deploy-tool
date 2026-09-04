import type { WidgetDefinition } from '../../schema/registry'
import TextWidget from './TextWidget.vue'

export const textWidget: WidgetDefinition = {
  type: 'text',
  name: '文本',
  category: 'text',
  description: '静态文本或带 {{value}} 插值的动态文本',
  component: TextWidget,
  propsSchema: {
    type: 'object',
    properties: {
      content: { type: 'string', title: '内容', format: 'multiline', default: '' },
      size: { type: 'integer', title: '字号', minimum: 10, maximum: 96, default: 16 },
      align: {
        type: 'string',
        title: '对齐',
        enum: ['left', 'center', 'right'],
        enumNames: ['左', '中', '右'],
        default: 'left',
      },
    },
    additionalProperties: false,
  },
  bindingSlots: [{ name: 'value', title: '插值', valueType: 'any', modes: ['ts', 'attr', 'const'] }],
  defaults: { content: '', size: 16, align: 'left' },
  sampleData: () => ({ value: '示例文本' }),
}
