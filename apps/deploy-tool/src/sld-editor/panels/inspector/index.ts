/** 示例扩展(验证扩展点):「属性」面板——选中元素的基本属性,名称 / 文字可改,一律经 ctx.apply。 */
import { defineSldExtension } from '../../ext'
import InspectorPanel from './InspectorPanel.vue'

export default defineSldExtension({
  panels: [{ id: 'inspector', title: '属性', order: 10, component: InspectorPanel }],
})
