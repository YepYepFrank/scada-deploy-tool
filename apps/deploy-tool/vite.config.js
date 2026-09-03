import { resolve } from 'path'
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  plugins: [vue()],
  // 多页入口:演示首页 + 站点声明工具 + 站点大屏(npm run build 一起产出)
  build: {
    chunkSizeWarningLimit: 1500,
    rollupOptions: {
      input: {
        index: resolve(__dirname, 'index.html'),
        provisioner: resolve(__dirname, 'provisioner.html'),
        site: resolve(__dirname, 'site.html'),
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
