import type { TemplateDefinition } from '../schema/registry'

/** 3×3 响应式栅格(后台类页面):9 个等大槽位,任意组件;CSS grid,随容器宽度自适应。 */
export const grid3x3: TemplateDefinition = {
  id: 'grid-3x3',
  name: '3×3 栅格',
  description: '九个等大槽位,响应式,适合后台页面',
  kind: 'grid',
  areas: ['r1c1 r1c2 r1c3', 'r2c1 r2c2 r2c3', 'r3c1 r3c2 r3c3'],
  slots: ['r1c1', 'r1c2', 'r1c3', 'r2c1', 'r2c2', 'r2c3', 'r3c1', 'r3c2', 'r3c3'].map(name => ({
    name,
    title: name.toUpperCase(),
    area: name,
    minSize: { w: 1, h: 1 },
  })),
}
