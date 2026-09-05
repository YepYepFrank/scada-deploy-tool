// 包内 /dev 展示页:列出注册表全部组件与模板,用 sampleData(mode:'const')渲染;
// 「镜像真数据」模式经 /tbm 代理连镜像 TB(含 WebSocket),凭据只从 monorepo 根 .env.local 的 VITE_TB_USER / VITE_TB_PASSWORD 预填。
import { resolve } from 'node:path'
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  root: resolve(__dirname, 'dev'),
  // 只读 monorepo 根的 .env*;Vite 只暴露 VITE_ 前缀,TB_PASSWORD 等不会进页面
  envDir: resolve(__dirname, '../..'),
  plugins: [vue()],
  resolve: { alias: { '@': resolve(__dirname, 'src') } },
  // echarts 子路径必须一起预构建,否则 echarts/core 与 echarts/charts 各自打成一份,use() 注册的渲染器与 init() 不在同一实例 → 图表空白
  optimizeDeps: { include: ['echarts/core', 'echarts/charts', 'echarts/components', 'echarts/renderers'] },
  server: {
    port: 5180,
    proxy: {
      // 生产镜像 TB(LXC 111):/tbm/api/... → http://192.168.20.61:8080/api/...,WS 同路
      '/tbm': {
        target: process.env.TB_BASE || 'http://192.168.20.61:8080',
        changeOrigin: true,
        ws: true,
        rewrite: p => p.replace(/^\/tbm/, ''),
      },
    },
  },
})
