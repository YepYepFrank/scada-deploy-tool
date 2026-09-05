#!/usr/bin/env node
// 用冻结的 Python 版重新生成 parity 快照:test/fixtures/<name>.plan.py.json
// 需要本机有 python(3.10+);CI 不跑这个,只比对已入库的快照。
// 用法:pnpm -F @grid/tbsite-compiler regen:py-plans   (可用 TBSITE_PY 指定脚本路径)
import { spawnSync } from 'node:child_process'
import { existsSync, readdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const fixtures = resolve(here, '../test/fixtures')
const py = process.env.TBSITE_PY || resolve(here, '../../../../tb-compiler/tbsite_compile.py')
if (!existsSync(py)) {
  console.error(`找不到 Python 版编译器:${py}(可用 TBSITE_PY 指定)`)
  process.exit(2)
}
const names = readdirSync(fixtures).filter(f => f.endsWith('.tbsite.json'))
for (const f of names) {
  const out = resolve(fixtures, f.replace(/\.tbsite\.json$/, '.plan.py.json'))
  const r = spawnSync('python', [py, resolve(fixtures, f), '--plan-json', out], { stdio: 'inherit' })
  if (r.status !== 0) process.exit(r.status ?? 1)
}
console.log(`已重新生成 ${names.length} 份快照`)
