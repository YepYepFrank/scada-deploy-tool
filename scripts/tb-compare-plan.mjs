#!/usr/bin/env node
// 只读对照:取镜像上某站点资产的 siteConfig,用 TS 版编译成写入计划,与镜像现有 CF / 规则链逐项对照。
// 用法:node scripts/tb-compare-plan.mjs <站点名> [--save 导出.tbsite.json]
// 凭据只从 dev/.env.local 读(TB_BASE / TB_USER / TB_PASSWORD),不接受命令行明文;先 pnpm build。
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const envPath = resolve(here, '../.env.local')
if (existsSync(envPath))
  for (const line of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/)
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
  }
const { TB_BASE = 'http://192.168.20.61:8080', TB_USER, TB_PASSWORD } = process.env
if (!TB_USER || !TB_PASSWORD) {
  console.error('缺少 TB_USER / TB_PASSWORD:请复制 .env.example 为 .env.local 并填写(不要提交)。')
  process.exit(2)
}
const [site, ...rest] = process.argv.slice(2)
if (!site) {
  console.error('用法:node scripts/tb-compare-plan.mjs <站点名> [--save 导出.tbsite.json]')
  process.exit(2)
}
const save = rest[rest.indexOf('--save') + 1]
const dist = resolve(here, '../packages/compiler/dist/index.js')
if (!existsSync(dist)) {
  console.error('先构建编译器:pnpm -F @grid/tbsite-compiler build')
  process.exit(2)
}
const { compile, resolveDeviceIds, listCfs, findAsset, summarizePlan } = await import(pathToFileURL(dist).href)

let token = ''
const api = async (url, data, method) => {
  const r = await fetch(TB_BASE + url, {
    method: method || (data ? 'POST' : 'GET'),
    headers: { 'Content-Type': 'application/json', ...(token ? { 'X-Authorization': `Bearer ${token}` } : {}) },
    body: data != null ? JSON.stringify(data) : undefined,
  })
  if (!r.ok) throw new Error(`${url} → HTTP ${r.status}`)
  const t = await r.text()
  return t ? JSON.parse(t) : null
}
token = (await api('/api/auth/login', { username: TB_USER, password: TB_PASSWORD })).token
console.log(`✓ 已登录 ${TB_BASE}`)

const asset = await findAsset(api, site)
if (!asset) {
  console.error(`站点资产「${site}」不存在`)
  process.exit(1)
}
const attrs = await api(
  `/api/plugins/telemetry/ASSET/${asset.id.id}/values/attributes/SERVER_SCOPE?keys=siteConfig,siteConfigHistory`
)
const raw = attrs.find(a => a.key === 'siteConfig')?.value
if (!raw) {
  console.error('资产上没有 siteConfig 属性')
  process.exit(1)
}
const cfg = typeof raw === 'string' ? JSON.parse(raw) : raw
const histRaw = attrs.find(a => a.key === 'siteConfigHistory')?.value
const hist = (typeof histRaw === 'string' ? JSON.parse(histRaw) : histRaw) || []
console.log(`站点配置 schema=${cfg.schema} · ${cfg.devices?.length ?? 0} 设备 · 历史 ${hist.length} 版`)
if (save) {
  writeFileSync(resolve(save), JSON.stringify(cfg, null, 2) + '\n')
  console.log(`已导出 ${save}`)
}

const { devIds, missing } = await resolveDeviceIds(
  api,
  cfg.devices.map(d => d.name)
)
if (missing.length) console.log(`! ${missing.length} 台设备在 TB 不存在:${missing.slice(0, 5).join(', ')}`)
const plan = compile(cfg, { devices: devIds })
for (const l of summarizePlan(plan)) console.log('  ', l)

let have = 0
const lack = []
const byDev = {}
for (const c of plan.cfs) (byDev[c.device] ||= []).push(c.output)
for (const [dev, outs] of Object.entries(byDev)) {
  if (!devIds[dev]) continue
  const list = await listCfs(api, 'DEVICE', devIds[dev])
  for (const o of outs) {
    if (list.some(x => x.name === o)) have++
    else lack.push(`${dev}.${o}`)
  }
}
console.log(
  `设备 CF:计划 ${plan.cfs.length} · 镜像已有 ${have} · 缺 ${lack.length}${lack.length ? ' ' + lack.slice(0, 5).join(', ') : ''}`
)
for (const a of plan.aggregates) {
  const as = await findAsset(api, a.asset)
  const list = as ? await listCfs(api, 'ASSET', as.id.id) : []
  console.log(
    `汇聚资产 ${a.asset}:计划 CF ${a.bodies.map(b => b.name).join(',')} · 镜像 ${list.map(x => x.name).join(',') || '(无)'}`
  )
}
const chains = (await api('/api/ruleChains?pageSize=100&page=0')).data
for (const [k, v] of Object.entries({ revenue: plan.revenue, rollup: plan.rollup, alarm: plan.alarm })) {
  if (!v) continue
  const c = chains.find(x => x.name === v.chainName)
  const meta = c ? await api(`/api/ruleChain/${c.id.id}/metadata`) : null
  console.log(
    `${k} 链「${v.chainName}」:计划 ${v.metadata.nodes.length} 节点 / ${v.metadata.connections.length} 连线 · 镜像 ${meta ? `${meta.nodes.length} / ${meta.connections.length}` : '不存在'}`
  )
}
if (plan.alarm) {
  const root = chains.find(c => c.root)
  const rm = await api(`/api/ruleChain/${root.id.id}/metadata`)
  console.log(
    `Root 转发节点「${plan.alarm.rootFlowName}」:${rm.nodes.some(n => n.name === plan.alarm.rootFlowName) ? '在' : '不在'}`
  )
}
