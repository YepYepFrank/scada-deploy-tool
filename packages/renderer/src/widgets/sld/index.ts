import type { WidgetDefinition } from '../../schema/registry'
import { emptySldDoc, SLD_ALARMS_SLOT, SLD_POINT_SLOT_PREFIX } from '../../sld'
import SldWidget from './SldWidget.vue'

/**
 * 一次接线图(ADR-005)。图在 props.doc;测点绑定走动态槽位 `pt.<pointId>`(值带数据时间戳),
 * 告警只有一个静态槽位 alarms(绑站点资产靠上卷;没开上卷时按设备数量级多绑几条)。
 */
export const sldWidget: WidgetDefinition = {
  type: 'sld',
  name: '一次接线图',
  category: 'diagram',
  description: '图元式一次接线图:开关分合、带电着色、测点数值;在部署工具的接线图编辑器里画',
  component: SldWidget,
  propsSchema: {
    type: 'object',
    properties: {
      doc: { type: 'object', title: '接线图', format: 'sld-doc' },
      staleSeconds: {
        type: 'integer',
        title: '数据过期(秒)',
        description: '测点数据时间戳早于这么久就按「未知」画;0 为不判',
        default: 600,
        minimum: 0,
      },
    },
    additionalProperties: false,
  },
  bindingSlots: [
    { name: SLD_ALARMS_SLOT, title: '告警', valueType: 'alarms', modes: ['alarm', 'const'], multiple: true },
  ],
  dynamicSlots: [
    { prefix: SLD_POINT_SLOT_PREFIX, title: '测点', valueType: 'any', modes: ['ts', 'attr', 'const'], stamped: true },
  ],
  defaults: { doc: emptySldDoc(), staleSeconds: 600 },
  // 设计态:给图里每个已绑定的测点一个占位值(开关按合位画,数值标签显示 1)
  sampleData: cfg => {
    const out: Record<string, unknown> = { [SLD_ALARMS_SLOT]: [] }
    const ts = Date.now()
    for (const slot of Object.keys(cfg?.bindings ?? {}))
      if (slot.startsWith(SLD_POINT_SLOT_PREFIX)) out[slot] = { v: 1, ts }
    return out
  },
  minSize: { w: 6, h: 4 },
}
