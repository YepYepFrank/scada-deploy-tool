/**
 * 「绑定」面板 + 从设备树拖设备进画布(T5.6)。骨架用 import.meta.glob 自动发现本文件。
 * 页签角标 = 选中节点(或选中的单个数值标签)名下没绑上的测点引用数。
 */
import { defineSldExtension } from '../../ext'
import BindingPanel from './BindingPanel.vue'
import { ENTITY_DRAG_TYPE, parseEntityDragData, placeEntity } from './drop'
import { unboundCount } from './ops'

export default defineSldExtension({
  panels: [
    {
      id: 'binding',
      title: '绑定',
      order: 20,
      component: BindingPanel,
      badge: ctx => unboundCount(ctx.content.value, ctx.selection.value) || undefined,
    },
  ],
  drops: [
    {
      type: ENTITY_DRAG_TYPE,
      onDrop: (ctx, raw, at) => {
        const data = parseEntityDragData(raw)
        if (data) void placeEntity(ctx, data, at)
      },
    },
  ],
})
