import type { WidgetDefinition } from '../../schema/registry'
import DualAxis from './DualAxis.vue'
import { sampleSeries } from '../line'

export const dualAxisWidget: WidgetDefinition = {
  type: 'dual-axis',
  name: '双轴组合图',
  category: 'chart',
  description: '主序列面积线(左轴)+ 副序列(右轴)',
  component: DualAxis,
  propsSchema: {
    type: 'object',
    properties: {
      title: { type: 'string', title: '标题', default: '' },
      subtitle: { type: 'string', title: '副标', default: '' },
      unitL: { type: 'string', title: '左轴单位', default: '' },
      unitR: { type: 'string', title: '右轴单位', default: '' },
      decimals: { type: 'integer', title: '小数位', minimum: 0, maximum: 4, default: 1 },
    },
    additionalProperties: false,
  },
  bindingSlots: [
    {
      name: 'primary',
      title: '主序列(左轴)',
      valueType: 'series',
      required: true,
      modes: ['ts-history', 'ext', 'const'],
    },
    { name: 'secondary', title: '副序列(右轴)', valueType: 'series', modes: ['ts-history', 'ext', 'const'] },
  ],
  defaults: { title: '', unitL: '', unitR: '', decimals: 1 },
  sampleData: () => ({ primary: sampleSeries('有功 P', 0, 120, 40), secondary: sampleSeries('无功 Q', 2, 30, 12) }),
}
