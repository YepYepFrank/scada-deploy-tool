/** 示例扩展(验证扩展点):「适应窗口」工具,走契约里的 ctx.view。 */
import { defineSldExtension } from '../../ext'

export default defineSldExtension({
  tools: [
    {
      id: 'fit',
      title: '适应窗口',
      group: 'view',
      order: 40,
      shortcut: 'ctrl+0',
      run: ctx => ctx.view.fit(),
    },
  ],
})
