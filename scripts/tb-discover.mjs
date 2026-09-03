#!/usr/bin/env node
// 联调环境摸底:按站点名关键字在 TB 上找资产 / 设备 / 遥测 key / Customer,输出 Markdown 片段(供 docs/联调环境.md)。
// 凭据只从 dev/.env.local 读(TB_BASE / TB_USER / TB_PASSWORD),不接受命令行明文,不写日志。
// 用法:node scripts/tb-discover.mjs "润扬"            → 打印到 stdout
//       node scripts/tb-discover.mjs "润扬" --json     → 机器可读
import { readFileSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const envPath = resolve(here, '../.env.local')
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line)
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
  }
}
const { TB_BASE = 'http://192.168.20.61:8080', TB_USER, TB_PASSWORD } = process.env
const [keyword = '润扬', ...flags] = process.argv.slice(2)
const asJson = flags.includes('--json')
if (!TB_USER || !TB_PASSWORD || TB_PASSWORD.startsWith('<')) {
  console.error('缺少 TB_USER / TB_PASSWORD:请复制 .env.example 为 .env.local 并填写(不要提交)。')
  process.exit(2)
}

const base = TB_BASE.replace(/\/+$/, '')
let token = ''
async function api(path, init = {}) {
  const r = await fetch(base + path, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { 'X-Authorization': `Bearer ${token}` } : {}),
      ...(init.headers || {}),
    },
  })
  if (!r.ok) throw new Error(`${init.method || 'GET'} ${path} → ${r.status} ${await r.text().catch(() => '')}`)
  return r.status === 204 ? null : r.json()
}
async function pageAll(path, pageSize = 100) {
  const out = []
  for (let page = 0; ; page++) {
    const sep = path.includes('?') ? '&' : '?'
    const d = await api(`${path}${sep}pageSize=${pageSize}&page=${page}`)
    out.push(...(d.data || []))
    if (!d.hasNext) break
  }
  return out
}

;({ token } = await api('/api/auth/login', {
  method: 'POST',
  body: JSON.stringify({ username: TB_USER, password: TB_PASSWORD }),
}))

const kw = keyword.toLowerCase()
const hit = s => (s || '').toLowerCase().includes(kw)

// 1) 资产、设备、客户
const [assets, devices, customers] = await Promise.all([
  pageAll('/api/tenant/assets'),
  pageAll('/api/tenant/devices'),
  pageAll('/api/customers'),
])
const siteAssets = assets.filter(a => hit(a.name) || hit(a.label))
const siteCustomers = customers.filter(c => hit(c.title) || hit(c.name))
const custIds = new Set(siteCustomers.map(c => c.id.id))
// 设备:名称/标签命中,或归属命中客户
let siteDevices = devices.filter(d => hit(d.name) || hit(d.label) || custIds.has(d.customerId?.id))

// 2) 资产关系(Contains)下的设备也算
for (const a of siteAssets) {
  const rels = await api(`/api/relations/info?fromId=${a.id.id}&fromType=ASSET`).catch(() => [])
  for (const r of rels) {
    if (r.to?.entityType === 'DEVICE') {
      const d = devices.find(x => x.id.id === r.to.id)
      if (d && !siteDevices.includes(d)) siteDevices.push(d)
    }
  }
}

// 3) 网关 / 子设备
const gateways = siteDevices.filter(d => d.additionalInfo?.gateway === true || /gateway|网关/i.test(d.type || ''))
// 4) 每台设备的遥测 key(最多 40 台,避免打爆)
const byProfile = {}
for (const d of siteDevices.slice(0, 40)) {
  const keys = await api(`/api/plugins/telemetry/DEVICE/${d.id.id}/keys/timeseries`).catch(() => [])
  d._keys = keys
  ;(byProfile[d.type] ||= []).push(d)
}
// 5) 客户账号(CUSTOMER_USER)
const custUsers = []
for (const c of siteCustomers) {
  const us = await pageAll(`/api/customer/${c.id.id}/users`).catch(() => [])
  custUsers.push(
    ...us.map(u => ({ customer: c.title, email: u.email, name: [u.firstName, u.lastName].filter(Boolean).join(' ') }))
  )
}
// 6) 资产上的 siteConfig / pageConfig
for (const a of siteAssets) {
  const attrs = await api(
    `/api/plugins/telemetry/ASSET/${a.id.id}/values/attributes/SERVER_SCOPE?keys=siteConfig,pageConfig,managedBy`
  ).catch(() => [])
  a._attrs = Object.fromEntries(attrs.map(x => [x.key, x.value]))
}

if (asJson) {
  console.log(JSON.stringify({ base, keyword, siteAssets, siteDevices, gateways, siteCustomers, custUsers }, null, 2))
  process.exit(0)
}

const pick = (arr, n) => arr.slice(0, n)
const md = []
md.push(`<!-- 由 scripts/tb-discover.mjs "${keyword}" 于 ${new Date().toISOString().slice(0, 10)} 生成;TB ${base} -->`)
md.push(`\n### 资产(${siteAssets.length})\n`)
md.push('| 名称 | type | id | 属性 |', '|---|---|---|---|')
for (const a of siteAssets)
  md.push(`| ${a.name} | ${a.type} | \`${a.id.id}\` | ${Object.keys(a._attrs || {}).join(', ') || '—'} |`)
md.push(`\n### 客户(${siteCustomers.length})与客户账号\n`)
md.push('| 客户 | id | CUSTOMER_USER |', '|---|---|---|')
for (const c of siteCustomers) {
  const us = custUsers.filter(u => u.customer === c.title).map(u => u.email)
  md.push(`| ${c.title} | \`${c.id.id}\` | ${us.join('<br>') || '—'} |`)
}
md.push(`\n### 设备(${siteDevices.length};网关 ${gateways.length})——按 Profile\n`)
for (const [prof, list] of Object.entries(byProfile).sort((a, b) => b[1].length - a[1].length)) {
  md.push(`\n**${prof}**(${list.length} 台)\n`)
  md.push('| 设备 | id | 遥测 key(前 8) |', '|---|---|---|')
  for (const d of pick(list, 5))
    md.push(
      `| ${d.name}${d.label ? ` (${d.label})` : ''} | \`${d.id.id}\` | ${(d._keys || []).slice(0, 8).join(', ') || '—'} |`
    )
  if (list.length > 5) md.push(`| … 另 ${list.length - 5} 台 | | |`)
}
console.log(md.join('\n'))
