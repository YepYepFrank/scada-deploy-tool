/**
 * 「复制间隔 ×N」(T5.7):选中 ≥ 1 个图元 → Ctrl+D / 工具栏 → 对话框 → 一次 apply 复制 N 份并按规律改名改绑。
 * 场景:案例图 LP3 / LP4 / LP7「垂直母线 + 十几条向右的水平出线」,画好一条出线后向下复制。
 */
import { defineSldExtension } from '../../ext'
import DuplicateBayLayer from './DuplicateBayLayer.vue'
import { bayDialog } from './state'

export default defineSldExtension({
  tools: [
    {
      id: 'duplicate-bay',
      title: '复制间隔',
      group: 'bay',
      order: 10,
      shortcut: 'ctrl+d',
      enabled: ctx => !ctx.readonly.value && ctx.selection.value.nodes.length > 0,
      active: ctx => bayDialog(ctx).open,
      run: ctx => {
        const state = bayDialog(ctx)
        const s = ctx.selection.value
        state.sel = {
          nodes: [...s.nodes],
          buses: [...s.buses],
          wires: [...s.wires],
          labels: [...s.labels],
          frames: [...(s.frames ?? [])],
        }
        state.open = true
      },
    },
  ],
  layers: [{ id: 'duplicate-bay-dialog', z: 'over', component: DuplicateBayLayer }],
})
