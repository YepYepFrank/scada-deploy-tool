#!/usr/bin/env node
// 联调环境核对(T0.4 / 第 4 周验收前提 §6):用 .env.local 的 CUSTOMER_USER 登录,检查可见设备数、隔离与站点资产可见性。
// 用法:node scripts/tb-verify-customer.mjs   凭据只从 dev/.env.local 读,不打印密码,邮箱脱敏。
import { readFileSync } from 'node:fs'
for (const line of readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split(/\r?\n/)) {
  const m = /^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/.exec(line)
  if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
}
const base = 'http://192.168.20.61:8080'
const u = process.env.TB_CUSTOMER_USER,
  p = process.env.TB_CUSTOMER_PASSWORD
if (!u || !p || p.startsWith('<')) {
  console.log('TB_CUSTOMER_USER/PASSWORD 未配置')
  process.exit(2)
}
const r = await fetch(base + '/api/auth/login', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ username: u, password: p }),
})
console.log('login', r.status)
if (!r.ok) process.exit(1)
const { token } = await r.json()
const H = { 'X-Authorization': 'Bearer ' + token }
const get = p =>
  fetch(base + p, { headers: H }).then(async x => ({ status: x.status, body: x.ok ? await x.json() : await x.text() }))
const me = await get('/api/auth/user')
console.log(
  'authority',
  me.body.authority,
  'customerId',
  me.body.customerId?.id,
  'user',
  me.body.email.replace(/(.{2}).+(@.*)/, '$1***$2')
)
const cid = me.body.customerId.id
const devs = await get(`/api/customer/${cid}/devices?pageSize=1000&page=0`)
console.log('devices visible', devs.body.totalElements)
const byPrefix = {}
for (const d of devs.body.data) {
  const k = d.name.split('_')[0]
  byPrefix[k] = (byPrefix[k] || 0) + 1
}
console.log('by prefix', byPrefix)
const assets = await get(`/api/customer/${cid}/assets?pageSize=100&page=0`)
console.log('assets visible', assets.body.totalElements)
const siteAsset = await get('/api/asset/22e38540-a2c1-11f1-b6b5-f5e88fe257c3')
console.log(
  'xrs-mirror-test asset access →',
  siteAsset.status,
  siteAsset.status === 200 ? '(可见)' : '(不可见,仍在 Public,T3.8 迁移)'
)
const ts = await get(
  '/api/plugins/telemetry/DEVICE/bafa3730-528e-11f1-90ba-53cf2ab0fe96/values/timeseries?keys=P,Uab,CB'
)
console.log(
  'SSP1_GP1_IED1 latest →',
  ts.status,
  ts.status === 200 ? JSON.stringify(Object.fromEntries(Object.entries(ts.body).map(([k, v]) => [k, v[0].value]))) : ''
)
const other = await get('/api/device/5727ae80-6fb8-11f1-8007-51b9f7714bbe')
console.log('润扬 RY_GZ_ESS_PCS access →', other.status, other.status === 200 ? '(!! 越权可见)' : '(不可见 ✓ 隔离生效)')

// 2026-09-10 补:同一台未分配设备,「最新值」与「历史区间」在 TB 里判得不一样 ——
// 最新值 403,带 startTs/endTs 的历史却回 200 带数据(镜像 TB 4.3.1.3 CE 实测,三台设备都这样)。
// 这一条留在这里常跑:哪天升级或改了配置能自动发现是否还漏。
const LEAK = { name: 'BS_2_CK(未分配)', id: 'b3ccd5e0-7c36-11f1-8007-51b9f7714bbe', key: 'DC_V' }
const now = Date.now()
const latest = await get(`/api/plugins/telemetry/DEVICE/${LEAK.id}/values/timeseries?keys=${LEAK.key}`)
const hist = await get(
  `/api/plugins/telemetry/DEVICE/${LEAK.id}/values/timeseries?keys=${LEAK.key}&startTs=${now - 3600_000}&endTs=${now}&limit=3&agg=NONE`
)
const histPts = hist.status === 200 ? (hist.body?.[LEAK.key] ?? []).length : 0
console.log(
  `${LEAK.name} 最新值 → ${latest.status} / 历史区间 → ${hist.status}${histPts ? ` (${histPts} 点)` : ''}`,
  latest.status !== 200 && histPts > 0
    ? '(!! 历史越权可读,联调环境待办 ⑦)'
    : latest.status !== 200 && hist.status !== 200
      ? '(两边都拒 ✓ 已修)'
      : '(判不了:这台设备可能已分配或没有数据,换一台)'
)
