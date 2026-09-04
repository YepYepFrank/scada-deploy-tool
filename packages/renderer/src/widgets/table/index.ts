import type { WidgetDefinition } from '../../schema/registry'
import TableWidget from './TableWidget.vue'
import { sampleSeries } from '../line'

export const tableWidget: WidgetDefinition = {
  type: 'table',
  name: '表格',
  category: 'value',
  description: 'latest:多个量的当前值一览;timeline:按时间合并的明细(kz 逐日报表)',
  component: TableWidget,
  propsSchema: {
    type: 'object',
    properties: {
      title: { type: 'string', title: '标题', default: '' },
      subtitle: { type: 'string', title: '副标', default: '' },
      mode: {
        type: 'string',
        title: '模式',
        enum: ['latest', 'timeline'],
        enumNames: ['当前值一览', '时间明细'],
        default: 'latest',
      },
      maxRows: { type: 'integer', title: '最多行数', minimum: 1, maximum: 500, default: 50 },
      timeFormat: {
        type: 'string',
        title: '时间格式',
        enum: ['time', 'datetime', 'date'],
        enumNames: ['时:分:秒', '日期 时间', '日期'],
        default: 'datetime',
      },
      columns: {
        type: 'array',
        title: '列(与绑定顺序对应)',
        items: {
          type: 'object',
          properties: {
            label: { type: 'string', title: '标签' },
            unit: { type: 'string', title: '单位' },
            decimals: { type: 'integer', title: '小数位', minimum: 0, maximum: 4 },
          },
        },
        maxItems: 12,
      },
    },
    additionalProperties: false,
  },
  bindingSlots: [
    {
      name: 'rows',
      title: '数据列',
      valueType: 'series',
      required: true,
      multiple: true,
      modes: ['ts', 'ts-history', 'ext', 'attr', 'const'],
    },
  ],
  defaults: { title: '', mode: 'latest', maxRows: 50, timeFormat: 'datetime', columns: [] },
  sampleData: () => ({
    rows: [sampleSeries('Ia', 0, 100, 20), sampleSeries('Ib', 1, 98, 20), sampleSeries('Ic', 2, 102, 20)],
  }),
}
