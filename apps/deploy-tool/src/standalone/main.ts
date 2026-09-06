// 独立单文件大屏薄壳(T3.8,替代 siteview/):登录 → 页面列表 → 标头 / 时钟 / 菜单 + <ScadaPage>
import { createApp } from 'vue'
import '@grid/scada-renderer/style.css'
import './standalone.css'
import StandaloneApp from './StandaloneApp.vue'

createApp(StandaloneApp).mount('#app')
