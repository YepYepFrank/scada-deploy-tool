/**
 * 「对齐 / 分布」(T5.7):工具栏上一个按钮,点开下拉菜单(8 种操作),不占 8 个按钮位。
 * 参与者是选中的图元、母线、分组框;选中 ≥ 2 个才可用(等距要 ≥ 3 个,在菜单里逐项禁用)。
 */
import { defineSldExtension } from '../../ext'
import AlignLayer from './AlignLayer.vue'
import { alignCount } from './ops'
import { alignMenu } from './state'

export default defineSldExtension({
  tools: [
    {
      id: 'align',
      title: '对齐 ▾',
      group: 'arrange',
      order: 20,
      enabled: ctx => !ctx.readonly.value && alignCount(ctx.selection.value) >= 2,
      active: ctx => alignMenu(ctx).open,
      run: ctx => {
        const state = alignMenu(ctx)
        state.open = !state.open
      },
    },
  ],
  layers: [{ id: 'align-menu', z: 'over', component: AlignLayer }],
})
