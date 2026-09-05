import { resolve } from 'path'
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  plugins: [vue()],
  // 渲染器包按需引入 echarts 子路径,须一起预构建(否则 use()/init() 不在同一实例,图表空白)
  optimizeDeps: { include: ['echarts/core', 'echarts/charts', 'echarts/components', 'echarts/renderers'] },
  // 多页入口:站点声明工具 + 站点大屏(npm run build 一起产出)。早期演示首页 index.html 已于 2026-09-03 移除。
  build: {
    chunkSizeWarningLimit: 1500,
    rollupOptions: {
      input: {
        provisioner: resolve(__dirname, 'provisioner.html'),
        site: resolve(__dirname, 'site.html'),
        editor: resolve(__dirname, 'editor.html'),
      },
    },
  },
  // npm run preview(验证 dist 产物)与 dev 用同一套代理
  // 注:/api 与 /tbm 现在同指生产镜像 TB(192.168.20.61),演示环境 20.60 已不再使用
  preview: {
    port: 4173,
    proxy: {
      '/api': { target: 'http://192.168.20.61:8080', changeOrigin: true, ws: true },
      '/kz': { target: 'http://192.168.20.61:8099', changeOrigin: true, rewrite: (p) => p.replace(/^\/kz/, '') },
      '/tbm': { target: 'http://192.168.20.61:8080', changeOrigin: true, ws: true, rewrite: (p) => p.replace(/^\/tbm/, '') },
    },
  },
  server: {
    port: 5173,
    proxy: {
      // 生产镜像 TB (LXC 111) — 默认后端
      '/api': {
        target: 'http://192.168.20.61:8080',
        changeOrigin: true,
        ws: true,
      },
      // kzserver 扩展服务(自然日/月归档报表)
      '/kz': {
        target: 'http://192.168.20.61:8099',
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/kz/, ''),
      },
      // 生产镜像环境 (LXC 111):/tbm/api/... → http://192.168.20.61:8080/api/...
      '/tbm': {
        target: 'http://192.168.20.61:8080',
        changeOrigin: true,
        ws: true,
        rewrite: (p) => p.replace(/^\/tbm/, ''),
      },
    },
  },
})
