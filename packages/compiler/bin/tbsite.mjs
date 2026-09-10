#!/usr/bin/env node
// tbsite CLI 入口:源码在 bin/tbsite.ts,tsup 打包到 dist/bin/tbsite.js(先 pnpm build)。
import { existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const built = resolve(dirname(fileURLToPath(import.meta.url)), '../dist/bin/tbsite.js')
if (!existsSync(built)) {
  console.error('tbsite: 尚未构建,请先运行 pnpm -F @grid/tbsite-compiler build')
  process.exit(2)
}
await import(pathToFileURL(built).href)
