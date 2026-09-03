import { createApp } from 'vue'
import '../style.css'
import './provisioner.css'
import './theme-microgrid.css'
import Provisioner from './Provisioner.vue'
import { version as rendererVersion } from '@grid/scada-renderer'

// T0.3:workspace 包已可直接引用;T1.2 起渲染器在此提供 <ScadaPage> 预览
console.info(`[deploy-tool] @grid/scada-renderer ${rendererVersion}`)
window.__GRID_PKGS__ = { rendererVersion }

createApp(Provisioner).mount('#app')
