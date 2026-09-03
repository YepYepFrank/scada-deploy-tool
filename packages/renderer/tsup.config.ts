import { defineConfig } from 'tsup'

// T0.3 过渡:只打包契约(schema);T1.2 起含 .vue 组件后改为 Vite library mode。
export default defineConfig({
  entry: { index: 'src/index.ts', 'schema/index': 'src/schema/index.ts' },
  format: ['esm'],
  dts: true,
  sourcemap: true,
  clean: true,
  target: 'es2022',
  external: ['vue', '@grid/tb-client'],
  onSuccess: 'node scripts/copy-schema.mjs',
})
