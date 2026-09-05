#!/usr/bin/env node
// T3.1 辅助脚本:把镜像上某站点资产的 siteConfig(或本地 tbsite.json)迁成 PageConfig 文件 + 迁移报告。
// 实体名 → id 在 TB 上解析(设备按名、资产按名);不写 TB。之后用 put-pageconfig.mjs 把页面写进 ScadaPage 资产。
// 用法:node packages/compiler/scripts/migrate-site.mjs <站点名 | 文件.tbsite.json> --out <目录>
// 凭据只从 dev/.env.local 读(TB_BASE / TB_USER / TB_PASSWORD)。先 pnpm -F @grid/tbsite-compiler build。
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '../../..')
for (const line of existsSync(resolve(root, '.env.local'))
  ? readFileSync(resolve(root, '.env.local'), 'utf8').split(/\r?\n/)
  : []) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/)
  if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
}
const { TB_BASE = 'http://192.168.20.61:8080', TB_USER, TB_PASSWORD } = process.env
const argv = process.argv.slice(2)
const target = argv.find(a => !a.startsWith('--'))
const outDir = argv[argv.indexOf('--out') + 1]
if (!target || argv.indexOf('--out') < 0 || !TB_USER || !TB_PASSWORD) {
  console.error('用法:migrate-site.mjs <站点名 | 文件.tbsite.json> --out <目录>;需 .env.local 的 TB_USER / TB_PASSWORD')
  process.exit(2)
}
const { migrateSiteConfig } = await import(pathToFileURL(resolve(here, '../dist/index.js')).href)

let token = ''
const api = async (url, data) => {
  const r = await fetch(TB_BASE + url, {
    method: data ? 'POST' : 'GET',
    headers: { 'Content-Type': 'application/json', ...(token ? { 'X-Authorization': `Bearer ${token}` } : {}) },
    body: data ? JSON.stringify(data) : undefined,
  })
  if (!r.ok) throw new Error(`${url.split('?')[0]} → HTTP ${r.status}`)
  const t = await r.text()
  return t ? JSON.parse(t) : null
}
token = (await api('/api/auth/login', { username: TB_USER, password: TB_PASSWORD })).token
const findByName = async (kind, name) =>
  (await api(`/api/tenant/${kind}?pageSize=100&page=0&textSearch=${encodeURIComponent(name)}`)).data.find(
    x => x.name === name
  )

// 1. 取配置
let cfg
if (target.endsWith('.json')) cfg = JSON.parse(readFileSync(resolve(target), 'utf8'))
else {
  const asset = await findByName('assets', target)
  if (!asset) throw new Error(`站点资产「${target}」不存在`)
  const attrs = await api(`/api/plugins/telemetry/ASSET/${asset.id.id}/values/attributes/SERVER_SCOPE?keys=siteConfig`)
  const raw = attrs.find(a => a.key === 'siteConfig')?.value
  if (!raw) throw new Error('资产上没有 siteConfig')
  cfg = typeof raw === 'string' ? JSON.parse(raw) : raw
}
console.log(`站点 ${cfg.site.name} · ${cfg.layout?.pages?.length ?? 0} 页 · ${cfg.devices?.length ?? 0} 设备`)

// 2. 解析实体 id:设备名 + 布局里引用到的资产名(agg 的 device 字段)+ 站点资产
const ids = { devices: {}, assets: {} }
for (const d of cfg.devices ?? []) {
  const dev = await findByName('devices', d.name)
  if (dev) ids.devices[d.name] = dev.id.id
}
const assetNames = new Set([cfg.site.name])
for (const p of cfg.layout?.pages ?? [])
  for (const s of Object.values(p.slots ?? {})) {
    if (s.kind === 'agg') assetNames.add(s.device)
    for (const e of s.extra ?? []) if (e.kind === 'agg') assetNames.add(e.device)
  }
for (const n of assetNames) {
  const a = await findByName('assets', n)
  if (a) ids.assets[n] = a.id.id
}

// 3. 迁移 + 落盘
const r = migrateSiteConfig(cfg, ids)
mkdirSync(resolve(outDir), { recursive: true })
for (const p of r.pages) {
  const f = resolve(outDir, `${cfg.site.name}.${p.legacyId}.pageconfig.json`)
  writeFileSync(f, JSON.stringify(p.config, null, 2) + '\n')
  console.log(`  → ${f}(${p.legacyTemplate} → ${p.config.template},${p.config.widgets.length} 个组件)`)
}
const report = [
  `# 迁移报告 · ${cfg.site.name}(${new Date().toISOString().slice(0, 10)})`,
  '',
  ...r.pages.map(
    p => `- 页 ${p.legacyId}「${p.title}」:${p.legacyTemplate} → ${p.config.template},${p.config.widgets.length} 个组件`
  ),
  '',
  r.unresolved.length ? `**未解析实体(不可发布)**:${r.unresolved.join('、')}` : '全部实体已解析为 id。',
  '',
  ...r.notes.map(n => `- [${n.level}]${n.page ? ` ${n.page}` : ''}${n.slot ? `/${n.slot}` : ''} ${n.message}`),
  '',
]
writeFileSync(resolve(outDir, `${cfg.site.name}.migration-report.md`), report.join('\n'))
console.log(`报告:${resolve(outDir, `${cfg.site.name}.migration-report.md`)}`)
console.log(
  `  提示 ${r.notes.length} 条(error ${r.notes.filter(n => n.level === 'error').length} / warn ${r.notes.filter(n => n.level === 'warn').length}) · 未解析 ${r.unresolved.length}`
)
