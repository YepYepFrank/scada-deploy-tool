import type { WidgetDefinition } from '../../schema/registry'
import { emptySldDoc, isSldDoc, sldPointSlot, SLD_ALARMS_SLOT, SLD_POINT_SLOT_PREFIX } from '../../sld'
import { DEFAULT_KV_COLORS, sampleValueFor } from './format'
import SldWidget from './SldWidget.vue'

export { DEFAULT_KV_COLORS, SLD_PHASE_COLORS, formatSldValue, kvColor, labelColor, type SldKvColor } from './format'
export { sldCoords, type SldScreenMapper } from './coords'

/**
 * 一次接线图(ADR-005)。图在 props.doc;测点绑定走动态槽位 `pt.<pointId>`(值带数据时间戳),
 * 告警只有一个静态槽位 alarms(绑站点资产靠上卷;没开上卷时按设备数量级多绑几条)。
 * 组件事件 `node-click`:detail = `{ nodeId, name?, entity?: { type, name } }`(entity 不带 id,见 CHANGELOG 0.4.0)。
 */
export const sldWidget: WidgetDefinition = {
  type: 'sld',
  name: '一次接线图',
  category: 'diagram',
  description: '图元式一次接线图:开关分合、带电着色、测点数值、过期变灰、告警闪烁;在部署工具的接线图编辑器里画',
  component: SldWidget,
  propsSchema: {
    type: 'object',
    properties: {
      doc: { type: 'object', title: '接线图', format: 'sld-doc' },
      staleSeconds: {
        type: 'integer',
        title: '数据过期(秒)',
        description: '测点数据时间戳早于这么久:开关按「未知」画、数值变灰;0 为不判',
        default: 600,
        minimum: 0,
      },
      showNames: { type: 'boolean', title: '显示设备名称', default: true },
      energizeColoring: {
        type: 'boolean',
        title: '带电着色',
        description: '按电压等级给带电部分上色、失电灰;关掉后全部用主题色。图中没有电源点时自动不着色',
        default: true,
      },
      interactive: {
        type: 'boolean',
        title: '缩放平移',
        description: '滚轮缩放、拖动平移、双击复位;关掉后仍可点击设备',
        default: true,
      },
      kvColors: {
        type: 'array',
        title: '电压等级配色',
        description: '未列出的等级用主题强调色;相差 15% 以内按最近一档(10.5 kV 归 10 kV)',
        items: {
          type: 'object',
          properties: {
            kv: { type: 'number', title: '电压等级(kV)', minimum: 0 },
            color: { type: 'string', title: '颜色', format: 'color' },
          },
        },
        maxItems: 12,
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
  defaults: {
    doc: emptySldDoc(),
    staleSeconds: 600,
    showNames: true,
    energizeColoring: true,
    interactive: true,
    kvColors: DEFAULT_KV_COLORS.map(c => ({ ...c })),
  },
  /**
   * 设计态占位:开关全合(按各节点 state.map 里映射到 closed 的那个值)、数值标签按单位给看起来合理的假值、告警为空。
   * 图里引用了但没绑定的测点也给值(编辑器里边画边看);绑定了但图里没引用的 pt.* 给 1。
   */
  sampleData: cfg => {
    const out: Record<string, unknown> = { [SLD_ALARMS_SLOT]: [] }
    const ts = Date.now()
    for (const slot of Object.keys(cfg?.bindings ?? {}))
      if (slot.startsWith(SLD_POINT_SLOT_PREFIX)) out[slot] = { v: 1, ts }
    const doc = (cfg?.props as Record<string, unknown> | undefined)?.doc
    if (!isSldDoc(doc)) return out
    for (const l of doc.labels)
      if (l.kind === 'value') out[sldPointSlot(l.pt)] = { v: sampleValueFor(l.format), ts }
    for (const n of doc.nodes) {
      if (!n.state) continue
      const closed = Object.entries(n.state.map).find(([, s]) => s === 'closed')?.[0]
      if (closed !== undefined) out[sldPointSlot(n.state.pt)] = { v: /^-?\d+$/.test(closed) ? Number(closed) : closed, ts }
    }
    return out
  },
  minSize: { w: 6, h: 4 },
}
