import { resolve } from 'path'
import { fileURLToPath } from 'url'
import { defineConfig, loadEnv } from 'vite'
import vue from '@vitejs/plugin-vue'

// 后端地址从 monorepo 根的 .env.local 读(TB_BASE / KZ_BASE,与 tbsite CLI、live 用例同名同义),
// 不填 = 生产镜像 LXC 111。切到新后端(LXC 110,2026-09-18 起)只需在 .env.local 里写
//   TB_BASE=http://192.168.20.60:8080   (KZ_BASE 不填则默认同主机 :8099)
const HERE = fileURLToPath(new URL('.', import.meta.url))
const ROOT = resolve(HERE, '../..')
const MIRROR = 'http://192.168.20.61:8080'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, ROOT, '')
  const TB = (env.TB_BASE || MIRROR).replace(/\/+$/, '')
  const KZ = (env.KZ_BASE || TB.replace(/:\d+$/, ':8099')).replace(/\/+$/, '')
  const proxy = {
    '/api': { target: TB, changeOrigin: true, ws: true },
    // kzserver 扩展服务(自然日/月归档报表):/kz/kzserver/... → {KZ}/kzserver/...
    '/kz': { target: KZ, changeOrigin: true, rewrite: (p) => p.replace(/^\/kz/, '') },
    // /tbm/api/... → {TB}/api/...
    '/tbm': { target: TB, changeOrigin: true, ws: true, rewrite: (p) => p.replace(/^\/tbm/, '') },
  }
  return {
    // 只读 monorepo 根的 .env*(VITE_ 前缀才会进页面):编辑器 / 大屏的开发期账号预填
    envDir: ROOT,
    // 把代理的真实目标告诉页面,第 1 步环境下拉的内置项按它显示,不再写死 IP
    define: { 'import.meta.env.VITE_TB_PROXY_TARGET': JSON.stringify(TB) },
    plugins: [vue()],
    // 渲染器包按需引入 echarts 子路径,须一起预构建(否则 use()/init() 不在同一实例,图表空白)
    optimizeDeps: { include: ['echarts/core', 'echarts/charts', 'echarts/components', 'echarts/renderers'] },
    // 多页入口:站点声明工具 + 站点大屏(npm run build 一起产出)。早期演示首页 index.html 已于 2026-09-03 移除。
    build: {
      chunkSizeWarningLimit: 1500,
      rollupOptions: {
        input: {
          provisioner: resolve(HERE, 'provisioner.html'),
          site: resolve(HERE, 'site.html'),
          editor: resolve(HERE, 'editor.html'),
        },
      },
    },
    // npm run preview(验证 dist 产物)与 dev 用同一套代理
    preview: { port: 4173, proxy },
    server: { port: 5173, proxy },
  }
})
