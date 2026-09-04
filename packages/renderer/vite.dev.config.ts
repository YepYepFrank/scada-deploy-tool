// 包内 /dev 展示页:列出注册表全部组件与模板,用 sampleData(mode:'const')渲染;不依赖 TB。
import { resolve } from 'node:path'
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  root: resolve(__dirname, 'dev'),
  plugins: [vue()],
  resolve: { alias: { '@': resolve(__dirname, 'src') } },
  // echarts 子路径必须一起预构建,否则 echarts/core 与 echarts/charts 各自打成一份,use() 注册的渲染器与 init() 不在同一实例 → 图表空白
  optimizeDeps: { include: ['echarts/core', 'echarts/charts', 'echarts/components', 'echarts/renderers'] },
  server: { port: 5180 },
})
