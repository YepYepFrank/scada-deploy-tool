/**
 * 「底图描摹」(T5.7):导入现有一次图的图片垫在画布下层照着画。
 * 没有底图时点按钮 = 选图片;有底图时点按钮 = 开 / 关浮层(显隐、透明度、位置、缩放、换图、移除)。
 * 按钮高亮 = 有底图且正在显示。ADR-005 D10:底图不发布(发布前剥离归 T5.8)。
 */
import { defineSldExtension } from '../../ext'
import BackgroundImage from './BackgroundImage.vue'
import BackgroundPanelLayer from './BackgroundPanelLayer.vue'
import { pickBackgroundFile } from './load'
import { bgState } from './state'

export default defineSldExtension({
  tools: [
    {
      id: 'background',
      title: '底图',
      group: 'file',
      order: 10,
      active: ctx => !!ctx.content.value.doc.background && bgState(ctx).visible,
      // 只读时还能开浮层切显隐,但没有底图时没什么可做
      enabled: ctx => !ctx.readonly.value || !!ctx.content.value.doc.background,
      run: ctx => {
        const state = bgState(ctx)
        if (!ctx.content.value.doc.background) {
          state.error = ''
          pickBackgroundFile(ctx)
          return
        }
        state.panel = !state.panel
      },
    },
  ],
  layers: [
    { id: 'background-image', z: 'under', component: BackgroundImage },
    { id: 'background-panel', z: 'over', component: BackgroundPanelLayer },
  ],
})
