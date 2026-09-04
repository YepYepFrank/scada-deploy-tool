import type { WidgetDefinition } from '../../schema/registry'
import StatusLight from './StatusLight.vue'

export const statusLightWidget: WidgetDefinition = {
  type: 'status-light',
  name: '状态指示灯',
  category: 'value',
  description: '值等于 onValue 时显示 on 态(如断路器合闸 / 通讯正常)',
  component: StatusLight,
  propsSchema: {
    type: 'object',
    properties: {
      title: { type: 'string', title: '标题', default: '' },
      subtitle: { type: 'string', title: '副标', default: '' },
      onValue: { type: 'string', title: 'on 态取值', default: '1', description: '与绑定值按字符串比较;1 / true 等价' },
      onLabel: { type: 'string', title: 'on 态文字', default: '正常' },
      offLabel: { type: 'string', title: 'off 态文字', default: '异常' },
      onColor: { type: 'string', title: 'on 态颜色', format: 'color', default: '' },
      offColor: { type: 'string', title: 'off 态颜色', format: 'color', default: '' },
      sub: { type: 'string', title: '说明行', default: '' },
    },
    additionalProperties: false,
  },
  bindingSlots: [{ name: 'state', title: '状态值', valueType: 'any', required: true, modes: ['ts', 'attr', 'const'] }],
  defaults: { title: '', onValue: '1', onLabel: '正常', offLabel: '异常', onColor: '', offColor: '', sub: '' },
  sampleData: () => ({ state: 1 }),
}
