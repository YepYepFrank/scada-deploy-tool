// 包内 /dev 展示页:列出注册表全部组件与模板,用 sampleData(mode:'const')渲染;不依赖 TB。
import { resolve } from 'node:path'
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  root: resolve(__dirname, 'dev'),
  plugins: [vue()],
  resolve: { alias: { '@': resolve(__dirname, 'src') } },
  server: { port: 5180 },
})
