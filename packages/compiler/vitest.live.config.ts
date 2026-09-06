// live 用例:连真实 TB(镜像),CI 外手动跑:pnpm -F @grid/tbsite-compiler test:live
// 与默认 vitest.config.ts 的 include 不重叠(*.live.ts),所以 pnpm test 永远不会碰到它们。
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['test/live/**/*.live.ts'],
    testTimeout: 180_000,
    hookTimeout: 180_000,
    // 用例之间共享同一个 TB,串行跑
    fileParallelism: false,
    sequence: { concurrent: false },
  },
})
