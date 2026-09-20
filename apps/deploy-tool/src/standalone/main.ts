// 独立单文件大屏薄壳(T3.8,替代 siteview/):登录 → 页面列表 → 标头 / 时钟 / 菜单 + <ScadaPage>
import { createApp } from 'vue'
import '@grid/scada-renderer/style.css'
// 可选字体包(渲染器 0.5.0):标题用优设标题黑、数字用 Barlow —— 挂墙大屏上这两款才是「成品」的样子
import '@grid/scada-renderer/fonts.css'
import './standalone.css'
import StandaloneApp from './StandaloneApp.vue'

createApp(StandaloneApp).mount('#app')
