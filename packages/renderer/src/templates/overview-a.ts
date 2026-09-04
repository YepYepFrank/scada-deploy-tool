import type { TemplateDefinition } from '../schema/registry'

/** 态势总览台(← 现有 LAYOUT_TEMPLATES.console):4 指标位 + 双列四图 + 顶部告警横幅;1920×1080 设计稿,整体缩放。 */
export const overviewA: TemplateDefinition = {
  id: 'overview-a',
  name: '态势总览台',
  description: '四个指标位 + 双列四图,适合站点全景监控',
  kind: 'scaled',
  design: { w: 1920, h: 1080 },
  slots: [
    {
      name: 'banner',
      title: '告警横幅',
      area: { x: 40, y: 24, w: 1840, h: 56 },
      fixed: { type: 'alarm-list', props: { compact: true }, hideable: true },
    },
    {
      name: 's1',
      title: '指标 1',
      area: { x: 40, y: 104, w: 440, h: 176 },
      accepts: ['number-card', 'gauge', 'status-light', 'text'],
    },
    {
      name: 's2',
      title: '指标 2',
      area: { x: 506, y: 104, w: 440, h: 176 },
      accepts: ['number-card', 'gauge', 'status-light', 'text'],
    },
    {
      name: 's3',
      title: '指标 3',
      area: { x: 974, y: 104, w: 440, h: 176 },
      accepts: ['number-card', 'gauge', 'status-light', 'text'],
    },
    {
      name: 's4',
      title: '指标 4',
      area: { x: 1440, y: 104, w: 440, h: 176 },
      accepts: ['number-card', 'gauge', 'status-light', 'text'],
    },
    { name: 'g1', title: '图表 1', area: { x: 40, y: 304, w: 908, h: 364 }, required: true },
    { name: 'g2', title: '图表 2', area: { x: 972, y: 304, w: 908, h: 364 } },
    { name: 'g3', title: '图表 3', area: { x: 40, y: 692, w: 908, h: 364 } },
    { name: 'g4', title: '图表 4', area: { x: 972, y: 692, w: 908, h: 364 } },
  ],
}
