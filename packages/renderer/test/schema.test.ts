/**
 * 契约校验测试(T0.2 完成标准):
 * - 示例 JSON 通过 schema;
 * - 故意构造的非法样本(缺 slot / 未知 mode / actions 绑 ASSET / 窗口格式错 / 版本号错)全部被拒;
 * - 生成的 schema 与源码同步(重新生成后无差异)。
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import { validatePageConfig, isPageConfig, SCHEMA_VERSION } from '../src/schema'
import { parseWindow } from '@grid/tb-client'

const here = dirname(fileURLToPath(import.meta.url))
const fixtures = resolve(here, 'fixtures')
const load = (p: string) => JSON.parse(readFileSync(p, 'utf8'))

describe('PageConfig JSON Schema', () => {
  it('架构 §12 风格的示例配置通过校验', () => {
    const cfg = load(resolve(fixtures, 'overview-a.example.json'))
    const r = validatePageConfig(cfg)
    if (!r.ok) console.error(r.issues)
    expect(r.ok).toBe(true)
    expect(isPageConfig(cfg)).toBe(true)
    expect(cfg.schemaVersion).toBe(SCHEMA_VERSION)
  })

  const invalidDir = resolve(fixtures, 'invalid')
  const expectedPaths: Record<string, RegExp> = {
    'missing-slot.json': /^\/widgets\/0$/,                 // required: slot
    'unknown-mode.json': /^\/widgets\/0\/bindings\/value/, // mode 不在 5 种之内
    'action-on-asset.json': /^\/widgets\/0\/actions\/toggle/, // entity.type 必须为 DEVICE
    'bad-window.json': /^\/widgets\/0\/bindings\/series/,  // window pattern
    'wrong-version.json': /^\/schemaVersion$/,
  }
  for (const f of readdirSync(invalidDir)) {
    it(`非法样本被拒:${f}`, () => {
      const r = validatePageConfig(load(resolve(invalidDir, f)))
      expect(r.ok).toBe(false)
      if (r.ok) return
      expect(r.issues.length).toBeGreaterThan(0)
      const re = expectedPaths[f]
      expect(re, `fixture ${f} 缺少期望路径登记`).toBeDefined()
      expect(r.issues.some(i => re!.test(i.path)), `期望错误定位到 ${re},实际:${r.issues.map(i => i.path).join(', ')}`).toBe(true)
    })
  }

  it('生成的 schema 与 page-config.ts 同步(gen:schema 后无变更)', () => {
    const schemaPath = resolve(here, '../src/schema/page-config.schema.json')
    const before = readFileSync(schemaPath, 'utf8')
    execFileSync(process.execPath, [resolve(here, '../scripts/gen-schema.mjs')], { stdio: 'pipe' })
    const after = readFileSync(schemaPath, 'utf8')
    expect(after).toBe(before)
  })
})

describe('parseWindow', () => {
  it('解析 m / h / d', () => {
    expect(parseWindow('15m')).toBe(15 * 60_000)
    expect(parseWindow('24h')).toBe(24 * 3_600_000)
    expect(parseWindow('7d')).toBe(7 * 86_400_000)
  })
  it('拒绝非法格式', () => {
    for (const bad of ['yesterday', '1w', '15', 'h24', '1.5h', '']) expect(() => parseWindow(bad)).toThrow()
  })
})
