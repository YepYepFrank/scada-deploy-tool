import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['test/**/*.test.ts'],
    // migrate.test 要加载渲染器 dist 并编译 ajv schema,机器忙时会超过默认 5s
    testTimeout: 20_000,
  },
})
