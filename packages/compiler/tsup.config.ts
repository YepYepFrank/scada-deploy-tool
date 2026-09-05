import { defineConfig } from 'tsup'

export default defineConfig({
  entry: { index: 'src/index.ts', 'bin/tbsite': 'bin/tbsite.ts' },
  format: ['esm'],
  dts: { entry: { index: 'src/index.ts' } },
  sourcemap: true,
  clean: true,
  target: 'node20',
  platform: 'node',
})
