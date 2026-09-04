import { createApp } from 'vue'
import '../src/theme/default.css'
import { registerBuiltins } from '../src/index'
import DevApp from './DevApp.vue'

registerBuiltins()
createApp(DevApp).mount('#app')
