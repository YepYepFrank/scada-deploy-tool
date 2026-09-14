import type { TemplateDefinition } from '../schema/registry'

/**
 * 卡片库(2026-09-14,单卡片嵌入方案 P2):4 列 × 6 行 = 24 个等大槽位,任意组件,没有必填槽位。
 * 不是给大屏展示的页面——工程人员在这里配「可复用卡片」,宿主应用按「页面 id + 组件 id」把卡单独嵌进自己的页面
 * (<ScadaWidget>)。站点大屏的页面列表会跳过模板为 cards 的页面。满了再加更大的 cards-48。
 */
const COLS = 4
const ROWS = 6
const names = Array.from({ length: COLS * ROWS }, (_, i) => `c${String(i + 1).padStart(2, '0')}`)

export const cards: TemplateDefinition = {
  id: 'cards',
  name: '卡片库',
  description: '24 格可复用卡片(4×6),任意组件;宿主应用按卡片单独引用,不作为整页大屏',
  kind: 'grid',
  areas: Array.from({ length: ROWS }, (_, r) => names.slice(r * COLS, (r + 1) * COLS).join(' ')),
  slots: names.map((name, i) => ({ name, title: `卡 ${i + 1}`, area: name, minSize: { w: 1, h: 1 } })),
}
