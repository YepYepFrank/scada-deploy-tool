// 图元总览页入口(T5.2,给人目检用):`pnpm -F @grid/scada-renderer dev` 后访问 /sld-gallery.html。
// 只依赖 src/sld,不连 TB、不读环境变量。
import { createApp } from 'vue'
import { registerBuiltinSldSymbols } from '../src/sld'
import SldGallery from './SldGallery.vue'

registerBuiltinSldSymbols()
createApp(SldGallery).mount('#app')
