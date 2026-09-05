#!/usr/bin/env node
// 里程碑 A 临时脚本(T2.7):把一份 PageConfig JSON 写进镜像 TB 的 ScadaPage 资产(契约 §5 存储约定)。
// T3.7 发布器完成后删除。凭据只从 dev/.env.local 读(TB_BASE / TB_USER / TB_PASSWORD,需租户账号)。
//
// 用法:node packages/compiler/scripts/put-pageconfig.mjs <page.json> --name "<资产名>" --site <站点资产名>
//         [--customer <客户名>] [--by <发布者>] [--delete]
// 幂等:资产按名称找,存在则更新 pageConfig 并把上一版压进 pageConfigHistory(最近 10 版),version +1。
import { existsSync, readFileSync } from 'node:fs'
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
const file = argv.find(a => !a.startsWith('--'))
const flag = k => {
  const i = argv.indexOf('--' + k)
  return i >= 0 ? (argv[i + 1]?.startsWith('--') ? true : (argv[i + 1] ?? true)) : undefined
}
const name = flag('name')
const site = flag('site')
const customer = flag('customer')
const by = flag('by') || TB_USER
if (!file || !name || !site || !TB_USER || !TB_PASSWORD) {
  console.error(
    '用法:put-pageconfig.mjs <page.json> --name "<资产名>" --site <站点资产名> [--customer <客户名>] [--by <发布者>] [--delete];需 .env.local 的 TB_USER / TB_PASSWORD'
  )
  process.exit(2)
}

// 1. 本地校验:JSON Schema(渲染器 dist/schema)+ 注册表(模板 / 槽位 / 组件 / 绑定模式)
const config = JSON.parse(readFileSync(resolve(file), 'utf8'))
const schema = await import(pathToFileURL(resolve(root, 'packages/renderer/dist/schema/index.js')).href)
const sv = schema.validatePageConfig(config)
if (!sv.ok) {
  console.error('✗ PageConfig 不符合 schema:')
  for (const e of sv.errors) console.error('  -', e.path, e.message)
  process.exit(1)
}
console.log(`✓ schema 校验通过 · 模板 ${config.template} · ${config.widgets.length} 个组件`)
try {
  const r = await import(pathToFileURL(resolve(root, 'packages/renderer/dist/index.js')).href)
  r.registerBuiltins()
  const issues = r.validateAgainstRegistry(config)
  if (issues.length) {
    console.error('✗ 注册表校验:')
    for (const i of issues) console.error('  -', i.path, i.message)
    process.exit(1)
  }
  console.log(`✓ 注册表校验通过 · 组件类型 ${[...new Set(config.widgets.map(w => w.type))].join(', ')}`)
} catch (e) {
  console.log('~ 跳过注册表校验(渲染器 dist 在 Node 里加载失败):', e instanceof Error ? e.message.split('\n')[0] : e)
}

// 2. TB
let token = ''
const api = async (url, data, method) => {
  const r = await fetch(TB_BASE + url, {
    method: method || (data ? 'POST' : 'GET'),
    headers: { 'Content-Type': 'application/json', ...(token ? { 'X-Authorization': `Bearer ${token}` } : {}) },
    body: data != null ? JSON.stringify(data) : undefined,
  })
  if (!r.ok) throw new Error(`${url.split('?')[0]} → HTTP ${r.status} ${(await r.text()).slice(0, 200)}`)
  const t = await r.text()
  return t ? JSON.parse(t) : null
}
token = (await api('/api/auth/login', { username: TB_USER, password: TB_PASSWORD })).token
const findAsset = async n =>
  (await api(`/api/tenant/assets?pageSize=100&page=0&textSearch=${encodeURIComponent(n)}`)).data.find(a => a.name === n)
const siteAsset = await findAsset(site)
if (!siteAsset) throw new Error(`站点资产「${site}」不存在`)
let page = await findAsset(name)

if (flag('delete')) {
  if (!page) console.log(`(无)ScadaPage「${name}」不存在`)
  else {
    await api(`/api/asset/${page.id.id}`, null, 'DELETE')
    console.log(`已删除 ScadaPage「${name}」(${page.id.id})`)
  }
  process.exit(0)
}

// 2a. 资产:建或改 additionalInfo(managedBy / version)
let history = []
let version = 1
if (page) {
  if (page.type !== 'ScadaPage') throw new Error(`同名资产「${name}」类型是 ${page.type},不是 ScadaPage,拒绝覆盖`)
  const attrs = await api(
    `/api/plugins/telemetry/ASSET/${page.id.id}/values/attributes/SERVER_SCOPE?keys=pageConfig,pageConfigHistory`
  )
  const prev = attrs.find(a => a.key === 'pageConfig')?.value
  const rawHist = attrs.find(a => a.key === 'pageConfigHistory')?.value
  history = (typeof rawHist === 'string' ? JSON.parse(rawHist) : rawHist) || []
  version = (page.additionalInfo?.version ?? history.length) + 1
  if (prev)
    history.unshift({
      ts: Date.now(),
      publishedBy: by,
      version: version - 1,
      config: typeof prev === 'string' ? JSON.parse(prev) : prev,
    })
  history = history.slice(0, 10)
  page = await api('/api/asset', {
    ...page,
    additionalInfo: { ...(page.additionalInfo || {}), managedBy: 'deploy-tool', version },
  })
  console.log(`= 已有 ScadaPage「${name}」→ version ${version}(历史 ${history.length} 版)`)
} else {
  page = await api('/api/asset', {
    name,
    type: 'ScadaPage',
    label: config.title || name,
    additionalInfo: { managedBy: 'deploy-tool', version },
  })
  console.log(`+ 新建 ScadaPage「${name}」${page.id.id}`)
}
// 2b. 属性
await api(`/api/plugins/telemetry/ASSET/${page.id.id}/attributes/SERVER_SCOPE`, {
  pageConfig: JSON.stringify(config),
  pageConfigHistory: history,
})
console.log('  pageConfig / pageConfigHistory 已写入')
// 2c. 关系:站点 Contains → 页面
await api('/api/relation', {
  from: { entityType: 'ASSET', id: siteAsset.id.id },
  to: { entityType: 'ASSET', id: page.id.id },
  type: 'Contains',
  typeGroup: 'COMMON',
})
console.log(`  关系 ${site} —Contains→ ${name}`)
// 2d. 分给 Customer(契约 §5:不再用 Public)
if (customer) {
  const c = (await api(`/api/customers?pageSize=50&page=0&textSearch=${encodeURIComponent(customer)}`)).data.find(
    x => x.title === customer
  )
  if (!c) throw new Error(`客户「${customer}」不存在`)
  await api(`/api/customer/${c.id.id}/asset/${page.id.id}`, {})
  console.log(`  已分配给客户「${customer}」`)
}
console.log(`\n完成:ScadaPage 资产 id = ${page.id.id}(宿主 /scada/${page.id.id})`)
