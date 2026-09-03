// 联调环境准备(T0.4 待办 ①):建 Customer 并把站点设备分配过去。幂等;不建用户(CUSTOMER_USER 由人在 TB 界面创建)、不动资产。
// 用法:node scripts/tb-customer-setup.mjs [--apply]   不带 --apply 只打印计划;凭据只从 dev/.env.local 读
// 站点匹配规则与客户名在下方常量里改(TITLE / isXrs)。
import { readFileSync } from 'node:fs'
for (const line of readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split(/\r?\n/)) {
  const m = /^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/.exec(line)
  if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
}
const APPLY = process.argv.includes('--apply')
const base = 'http://192.168.20.61:8080'
const login = await fetch(base + '/api/auth/login', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ username: process.env.TB_USER, password: process.env.TB_PASSWORD }),
}).then(r => r.json())
if (!login.token) {
  console.error('login failed')
  process.exit(1)
}
const H = { 'X-Authorization': 'Bearer ' + login.token, 'Content-Type': 'application/json' }
const api = async (p, init = {}) => {
  const r = await fetch(base + p, { ...init, headers: H })
  if (!r.ok) throw new Error(`${init.method || 'GET'} ${p} → ${r.status} ${await r.text()}`)
  return r.status === 204 ? null : r.json()
}
const TITLE = '仙人山服务区'
const custs = (await api('/api/customers?pageSize=100&page=0')).data
const cname = Object.fromEntries(custs.map(c => [c.id.id, c.title]))
let cust = custs.find(c => c.title === TITLE)
console.log(cust ? `customer exists: ${cust.id.id}` : `customer "${TITLE}" will be created`)
const all = (await api('/api/tenant/devices?pageSize=1000&page=0')).data
const isXrs = d => /^(SSP1|SSP2|PDR1|PDR2|PDR3|PDR4)(_|$)|^mgcc_xrs$|^xrs_/.test(d.name) || /仙人山/.test(d.label || '')
const devs = all.filter(isXrs)
const from = {}
for (const d of devs) {
  const k = cname[d.customerId.id] || '未分配'
  from[k] = (from[k] || 0) + 1
}
console.log('仙人山 devices', devs.length, 'current assignment', from)
if (!APPLY) {
  console.log('(dry run) 加 --apply 执行')
  process.exit(0)
}
if (!cust) {
  cust = await api('/api/customer', {
    method: 'POST',
    body: JSON.stringify({
      title: TITLE,
      additionalInfo: { description: '联调 / 验收客户(T0.4,2026-09-03,由部署工具项目创建)', managedBy: 'deploy-tool' },
    }),
  })
  console.log('created customer', cust.id.id)
}
let moved = 0,
  kept = 0,
  failed = []
for (const d of devs) {
  if (d.customerId.id === cust.id.id) {
    kept++
    continue
  }
  try {
    await api(`/api/customer/${cust.id.id}/device/${d.id.id}`, { method: 'POST' })
    moved++
  } catch (e) {
    failed.push(`${d.name}: ${e.message.slice(0, 80)}`)
  }
}
console.log(`assigned: moved ${moved}, already ${kept}, failed ${failed.length}`)
failed.slice(0, 5).forEach(f => console.log('  !', f))
const after = (await api(`/api/customer/${cust.id.id}/devices?pageSize=1000&page=0`)).totalElements
const pub = (await api(`/api/customer/03fe0130-55ac-11f1-90ba-53cf2ab0fe96/devices?pageSize=1000&page=0`)).data
console.log(
  `verify: customer now has ${after} devices; Public now has ${pub.length} devices (${pub.filter(isXrs).length} 仙人山): ${pub.map(d => d.name).join(', ')}`
)
console.log('customerId', cust.id.id)
