// @grid/scada-renderer 库构建(T1.2 起,替代 tsup):ESM + .d.ts,vue / @grid/tb-client 外置。
import { resolve } from 'node:path'
import { copyFileSync, mkdirSync, readdirSync } from 'node:fs'
import { defineConfig, type Plugin } from 'vite'
import vue from '@vitejs/plugin-vue'
import dts from 'vite-plugin-dts'

/** 生成的 JSON Schema 原样带进 dist(供非 JS 工具读取;JS 侧走 pageConfigJsonSchema 导出) */
const emitSchemaJson: Plugin = {
  name: 'emit-page-config-schema',
  writeBundle() {
    mkdirSync(resolve(__dirname, 'dist/schema'), { recursive: true })
    copyFileSync(
      resolve(__dirname, 'src/schema/page-config.schema.json'),
      resolve(__dirname, 'dist/schema/page-config.schema.json')
    )
  },
}

/**
 * 可选字体包(0.5.0):`@grid/scada-renderer/fonts.css` 不被 index.ts 引用,不会进主 bundle,
 * 所以原样拷进 dist(css 里的 url 是相对的 ./fonts/*.woff2,连同字体一起拷就能用)。
 * 宿主不 import 这个文件就一个字节都不加载。
 */
const emitFonts: Plugin = {
  name: 'emit-optional-fonts',
  writeBundle() {
    mkdirSync(resolve(__dirname, 'dist/fonts'), { recursive: true })
    copyFileSync(resolve(__dirname, 'src/theme/fonts.css'), resolve(__dirname, 'dist/fonts.css'))
    for (const f of readdirSync(resolve(__dirname, 'src/theme/fonts')))
      copyFileSync(resolve(__dirname, 'src/theme/fonts', f), resolve(__dirname, 'dist/fonts', f))
  },
}

export default defineConfig({
  plugins: [
    vue(),
    dts({ tsconfigPath: './tsconfig.build.json', entryRoot: 'src', outDir: 'dist', copyDtsFiles: true }),
    emitSchemaJson,
    emitFonts,
  ],
  build: {
    lib: {
      entry: { index: resolve(__dirname, 'src/index.ts'), 'schema/index': resolve(__dirname, 'src/schema/index.ts') },
      formats: ['es'],
      fileName: (_f, name) => `${name}.js`,
    },
    rollupOptions: {
      external: ['vue', '@grid/tb-client', /^echarts/],
      output: { globals: { vue: 'Vue' } },
    },
    sourcemap: true,
    target: 'es2022',
    emptyOutDir: true,
  },
})
