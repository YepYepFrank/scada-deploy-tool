// @grid/scada-renderer 库构建(T1.2 起,替代 tsup):ESM + .d.ts,vue / @grid/tb-client 外置。
import { resolve } from 'node:path'
import { copyFileSync, mkdirSync } from 'node:fs'
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

export default defineConfig({
  plugins: [
    vue(),
    dts({ tsconfigPath: './tsconfig.build.json', entryRoot: 'src', outDir: 'dist', copyDtsFiles: true }),
    emitSchemaJson,
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
