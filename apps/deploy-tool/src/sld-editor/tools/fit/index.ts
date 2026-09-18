/** 示例扩展(验证扩展点):「适应窗口」工具。视口操作不在 ext.ts 契约里,走骨架的 ctx.view(见 context.ts)。 */
import { defineSldExtension } from '../../ext'
import { hasView } from '../../context'

export default defineSldExtension({
  tools: [
    {
      id: 'fit',
      title: '适应窗口',
      group: 'view',
      order: 40,
      shortcut: 'ctrl+0',
      enabled: ctx => hasView(ctx),
      run: ctx => {
        if (hasView(ctx)) ctx.view.fit()
      },
    },
  ],
})
