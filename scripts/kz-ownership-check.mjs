// 复核联调环境待办 ⑤b:kz 的 tskv/** 是否按实体归属过滤。
// 一条命令重复复测:node scripts/kz-ownership-check.mjs
//
// 判法要小心:kz 对「无权」和「无数据」的回法都是 `code 200` + 空,单看一个结果分不清。
// 所以这里对同一台设备、同一个查询,用【租户 token】和【客户 token】各问一次:
//   租户有数据、客户 0 点 → 确实按归属拦了
//   两边都有数据          → 没拦(⑤b 仍在)
//   租户就 0 点           → 这台设备没有归档数据,判不了,换一台
// TB 那边用 /api/device/{id}(无权必 403)判权限,不用遥测接口 —— 后者对没有该 key 的设备
// 也会回 200 空,同样分不清。
//
// 凭据只从 dev/.env.local 读(TB_USER / TB_PASSWORD / TB_CUSTOMER_USER / TB_CUSTOMER_PASSWORD),
// 不打印 token,邮箱脱敏。
import { readFileSync } from 'node:fs'

for (const line of readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split(/\r?\n/)) {
  const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line)
  if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
}
const TB = process.env.TB_BASE || 'http://192.168.20.61:8080'
const KZ = process.env.KZ_BASE || TB.replace(/:\d+$/, ':8099')
const NULL_ID = '13814000-1dd2-11b2-8080-808080808080'

const login = async (u, p) => {
  const r = await fetch(`${TB}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: u, password: p }),
  })
  if (!r.ok) throw new Error(`登录失败 HTTP ${r.status}`)
  return (await r.json()).token
}
const H = t => ({ 'X-Authorization': `Bearer ${t}` })
const j = async (t, path) => {
  const r = await fetch(TB + path, { headers: H(t) })
  return { status: r.status, body: r.ok ? await r.json() : null }
}

const tenant = await login(process.env.TB_USER, process.env.TB_PASSWORD)
const cust = await login(process.env.TB_CUSTOMER_USER, process.env.TB_CUSTOMER_PASSWORD)
const me = (await j(cust, '/api/auth/user')).body
console.log('客户:', String(me.email).replace(/(.{2}).+(@.*)/, '$1***$2'), '| customerId', me.customerId?.id)

const endTs = Date.now()
const startTs = endTs - 30 * 86400_000

/** kz 通用历史:回 {http, code, msg, 点数} */
async function kz(token, id, key) {
  const qs = new URLSearchParams({
    keys: key,
    startTs: String(startTs),
    endTs: String(endTs),
    interval: '86400000',
    agg: 'AVG',
  })
  const r = await fetch(`${KZ}/kzserver/tskv/day/telemetry/DEVICE/${id}/values/timeseries?${qs}`, { headers: H(token) })
  if (!r.ok) return { txt: `HTTP ${r.status}`, pts: -1 }
  const b = await r.json()
  const pts = b?.data?.[key]?.length ?? 0
  return { txt: `code ${b.code} ${b.msg ?? ''}`.trim(), pts, code: b.code }
}

const NAMES = ['SSP1_GP1_IED1', 'RY_GZ_ESS_PCS', 'Test Device A1', 'Test Device A2']
const rows = []
for (const name of NAMES) {
  const found = await j(tenant, `/api/tenant/devices?deviceName=${encodeURIComponent(name)}`)
  if (found.status !== 200) {
    console.log(`  (跳过 ${name}:镜像上没有)`)
    continue
  }
  const id = found.body.id.id
  const dev = (await j(tenant, `/api/device/${id}`)).body
  const owner = dev.customerId?.id && dev.customerId.id !== NULL_ID ? dev.customerId.id : null
  const own = owner ? (owner === me.customerId?.id ? '本客户' : '别的客户') : '未分配'

  // 这台设备有哪些遥测 key(租户视角);没有 key 的设备无法判定
  const keys = (await j(tenant, `/api/plugins/telemetry/DEVICE/${id}/keys/timeseries`)).body ?? []
  const key = keys.includes('P') ? 'P' : keys[0]
  if (!key) {
    console.log(`  (跳过 ${name}:没有任何遥测 key)`)
    continue
  }

  const tbCust = await j(cust, `/api/device/${id}`) // 权限判定:403 = TB 拦住
  const kzTen = await kz(tenant, id, key)
  const kzCust = await kz(cust, id, key)
  rows.push({ name, own, key, tb: tbCust.status, kzTen, kzCust })
}

console.log('\n设备                 归属       key            TB(客户)  kz(租户)      kz(客户)')
console.log('─'.repeat(96))
for (const r of rows)
  console.log(
    r.name.padEnd(21) +
      r.own.padEnd(11) +
      String(r.key).slice(0, 14).padEnd(15) +
      String(r.tb).padEnd(10) +
      `${r.kzTen.txt} / ${r.kzTen.pts} 点`.padEnd(26) +
      `${r.kzCust.txt} / ${r.kzCust.pts} 点`
  )

console.log('\n结论:')
for (const r of rows) {
  if (r.own === '本客户') continue
  if (r.kzTen.pts <= 0) console.log(`  ${r.name}:租户查也只有 ${r.kzTen.pts} 点,这台判不了(没有归档数据)`)
  else if (r.kzCust.pts > 0) console.log(`  ${r.name}:❌ 未拦 —— 客户 token 读到了 ${r.kzCust.pts} 点(⑤b 仍在)`)
  else console.log(`  ${r.name}:✅ 拦住了 —— 租户 ${r.kzTen.pts} 点,客户 ${r.kzCust.txt} / ${r.kzCust.pts} 点`)
}
