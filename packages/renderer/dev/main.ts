import { createApp } from 'vue'
import '../src/theme/default.css'
// 可选字体包:/dev 也引一份,预览到的字形与交付页面一致
import '../src/theme/fonts.css'
import { registerBuiltins } from '../src/index'
import DevApp from './DevApp.vue'

registerBuiltins()
createApp(DevApp).mount('#app')
