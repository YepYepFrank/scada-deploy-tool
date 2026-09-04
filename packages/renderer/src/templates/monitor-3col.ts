import type { TemplateDefinition } from '../schema/registry'

const SIDE = [
  'number-card',
  'gauge',
  'status-light',
  'overview-card',
  'alarm-list',
  'line',
  'dual-axis',
  'table',
  'image',
  'text',
]

/**
 * 三栏监控屏(← 现有 LAYOUT_TEMPLATES.monitor3):左右各三块面板 + 中央主视区 + 主视区下方双图。
 * 原「主视区预留」改为开放槽位 `main`(接线图暂缓,一期放 image / table / line)。
 */
export const monitor3col: TemplateDefinition = {
  id: 'monitor-3col',
  name: '三栏监控屏',
  description: '左右各三块面板 + 中央主视区与双图,复刻生产单站大屏结构',
  kind: 'scaled',
  design: { w: 1920, h: 1080 },
  slots: [
    {
      name: 'banner',
      title: '告警横幅',
      area: { x: 40, y: 24, w: 1840, h: 56 },
      fixed: { type: 'alarm-list', props: { compact: true }, hideable: true },
    },
    { name: 'l1', title: '左 1', area: { x: 40, y: 104, w: 440, h: 300 }, accepts: SIDE },
    { name: 'l2', title: '左 2', area: { x: 40, y: 428, w: 440, h: 300 }, accepts: SIDE },
    { name: 'l3', title: '左 3', area: { x: 40, y: 752, w: 440, h: 304 }, accepts: SIDE },
    {
      name: 'main',
      title: '主视区',
      area: { x: 504, y: 104, w: 912, h: 560 },
      accepts: ['image', 'table', 'line', 'dual-axis', 'text'],
    },
    {
      name: 'c1',
      title: '中下 1',
      area: { x: 504, y: 688, w: 444, h: 368 },
      accepts: ['line', 'dual-axis', 'overview-card', 'alarm-list', 'table'],
    },
    {
      name: 'c2',
      title: '中下 2',
      area: { x: 972, y: 688, w: 444, h: 368 },
      accepts: ['line', 'dual-axis', 'overview-card', 'alarm-list', 'table'],
    },
    { name: 'r1', title: '右 1', area: { x: 1440, y: 104, w: 440, h: 300 }, accepts: SIDE },
    { name: 'r2', title: '右 2', area: { x: 1440, y: 428, w: 440, h: 300 }, accepts: SIDE },
    { name: 'r3', title: '右 3', area: { x: 1440, y: 752, w: 440, h: 304 }, accepts: SIDE },
  ],
}
