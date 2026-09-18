/** 接线图编辑器的独立开发入口(T5.5):不连 TB、不走部署工具的向导,直接挂 DevHost(mock 图 + mock 绑定)。 */
import { createApp } from 'vue'
import { registerBuiltinSldSymbols } from '@grid/scada-renderer'
import DevHost from './DevHost.vue'

registerBuiltinSldSymbols()
createApp(DevHost).mount('#app')
