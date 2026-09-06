// 单文件大屏构建:把 site.html 连同全部 JS/CSS/字体/图片内联成一个 HTML。
// 产物 dist-site/site.html 可直接丢进任意静态目录(同事的 nginx / htService),
// 用 URL 参数指定站点与 TB 地址:site.html?site=<站点名>&base=<http://TB:8080>[&kz=<kz 地址>];打开后用自己的账号登录(T3.8,无匿名身份)
// 页面是配置驱动的——配置改了重新发布即可,这个文件本身无需重打。
// 构建:npm run build:site
import { resolve } from 'path'
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { viteSingleFile } from 'vite-plugin-singlefile'

export default defineConfig({
  plugins: [vue(), viteSingleFile()],
  build: {
    outDir: 'dist-site',
    chunkSizeWarningLimit: 20000,
    assetsInlineLimit: 100 * 1024 * 1024, // 字体/底图全部转 data URI 内联
    rollupOptions: { input: resolve(__dirname, 'site.html') },
  },
})
