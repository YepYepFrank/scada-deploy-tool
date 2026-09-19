/**
 * 「重置走线」「拉直」(T5.7;ADR-005 Spike A:节点拖离原列后缺省折线会出 U 形回环,靠手工拐点修,这里给两个快捷修法)。
 * 作用对象:选中的连线;没选中连线时是选中节点相关的连线。只处理带手工拐点的线,没有就禁用。
 */
import { lookupSldSymbol } from '@grid/scada-renderer'
import { defineSldExtension } from '../../ext'
import { resetRoutes, straightenWires, wiresWithVertices } from './ops'

export default defineSldExtension({
  tools: [
    {
      id: 'reroute-reset',
      title: '重置走线',
      group: 'arrange',
      order: 30,
      enabled: ctx => !ctx.readonly.value && wiresWithVertices(ctx.content.value.doc, ctx.selection.value).length > 0,
      run: ctx => {
        const ids = wiresWithVertices(ctx.content.value.doc, ctx.selection.value)
        ctx.apply(d => (resetRoutes(d.doc, ids) ? undefined : false), '重置走线')
      },
    },
    {
      id: 'reroute-straighten',
      title: '拉直',
      group: 'arrange',
      order: 31,
      enabled: ctx => !ctx.readonly.value && wiresWithVertices(ctx.content.value.doc, ctx.selection.value).length > 0,
      run: ctx => {
        const ids = wiresWithVertices(ctx.content.value.doc, ctx.selection.value)
        ctx.apply(d => (straightenWires(d.doc, ids, lookupSldSymbol) ? undefined : false), '拉直走线')
      },
    },
  ],
})
