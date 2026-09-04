import type { WidgetDefinition } from '../../schema/registry'
import AlarmList from './AlarmList.vue'

export const alarmListWidget: WidgetDefinition = {
  type: 'alarm-list',
  name: '告警列表',
  category: 'alarm',
  description: '当前活动告警;compact 为单行横幅',
  component: AlarmList,
  propsSchema: {
    type: 'object',
    properties: {
      title: { type: 'string', title: '标题', default: '实时告警' },
      subtitle: { type: 'string', title: '副标', default: '' },
      maxRows: { type: 'integer', title: '最多行数', minimum: 1, maximum: 100, default: 20 },
      compact: { type: 'boolean', title: '横幅模式', default: false },
    },
    additionalProperties: false,
  },
  bindingSlots: [{ name: 'alarms', title: '告警', valueType: 'alarms', required: true, modes: ['alarm', 'const'] }],
  defaults: { title: '实时告警', maxRows: 20, compact: false },
  sampleData: () => ({
    alarms: [
      {
        id: 'a1',
        type: '电压越限',
        severity: 'MAJOR',
        status: 'ACTIVE_UNACK',
        startTs: Date.now() - 320_000,
        originator: { type: 'DEVICE', id: 'd1' },
        originatorName: 'SSP1_GP1_IED1',
      },
      {
        id: 'a2',
        type: '通讯中断',
        severity: 'CRITICAL',
        status: 'ACTIVE_ACK',
        startTs: Date.now() - 5_400_000,
        originator: { type: 'DEVICE', id: 'd2' },
        originatorName: 'PDR4_LP1_ATS1',
      },
      {
        id: 'a3',
        type: '断路器变位',
        severity: 'WARNING',
        status: 'ACTIVE_UNACK',
        startTs: Date.now() - 40_000,
        originator: { type: 'DEVICE', id: 'd3' },
        originatorName: 'SSP2_GP3_IED1',
      },
    ],
  }),
}
