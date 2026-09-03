// ThingsBoard REST access — public-customer auth, no credentials in code.
// 两个内置环境现在都指向生产镜像 TB(192.168.20.61):demo 走 /api 代理、
// mirror 走 /tbm 代理,Public 客户 id 相同——演示环境 20.60 已退役。
// 仍保留 ?env=mirror 参数是为了兼容既有书签与向导生成的大屏链接——两条路径现在等价。
const ENVS = {
  demo:   { base: '',     publicId: '03fe0130-55ac-11f1-90ba-53cf2ab0fe96' },
  mirror: { base: '/tbm', publicId: '03fe0130-55ac-11f1-90ba-53cf2ab0fe96' },
}
const QS = new URLSearchParams(location.search)
const ENV = QS.get('env') === 'mirror' ? 'mirror' : 'demo'
// 自定义项目环境:向导发布后通过 ?base=<TB地址>&pub=<Public客户id> 打开大屏
const BASE_OVERRIDE = QS.get('base')
export const API_BASE = BASE_OVERRIDE !== null ? BASE_OVERRIDE.replace(/\/+$/, '') : ENVS[ENV].base
export const PUBLIC_ID = QS.get('pub') || ENVS[ENV].publicId
// kz 报表可用性 = 「同源存在 /kz 反代」。两个内置环境都走代理(vite dev/preview 或 nginx 的
// /kz 段),故都可用;只有 ?base= 直连/单文件部署没有 /kz 同源前缀(kz 请求写死 /kz/... 路径,
// 见 kzRevenueTrend / kzStations),此时仍关闭并降级为空态——待办 C4 参数化后可再放开。
export const HAS_KZ = BASE_OVERRIDE === null

// 只读报表账号(CUSTOMER_USER,仅用于通过 kzserver 的 TB token 校验;内网大屏场景)
// 报表账号凭据不入库(CONTRIBUTING §3):由 .env.local 的 VITE_REPORT_USER / VITE_REPORT_PASSWORD 注入;
// 未配置时 reportAuth() 静默返回 null,由前端鉴权条兜底。T3.8 将连同三级取数整体删除。
const REPORT_AUTH = {
  username: import.meta.env.VITE_REPORT_USER || '',
  password: import.meta.env.VITE_REPORT_PASSWORD || '',
}
let kzToken = null
async function kzLogin() {
  if (!REPORT_AUTH.username || !REPORT_AUTH.password) throw new Error('report account not configured (VITE_REPORT_USER/PASSWORD)')
  const r = await fetch(`${API_BASE}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(REPORT_AUTH),
  })
  if (!r.ok) throw new Error(`报表账号登录失败: ${r.status}`)
  kzToken = (await r.json()).token
}
// 收益趋势(kzserver 归档)。服务端语义(反编译确认):
//   queryType=2 本月逐日、queryType=3 本年逐月——日期范围由服务端自身时钟生成,
//   传入的 startTime/endTime 会被覆盖,不支持查任意历史区间。
// 本月尚无归档数据时自动降级为本年逐月视图。返回 { mode:'day'|'month', rows }。
export async function kzRevenueTrend(stationId, _retried = false) {
  if (!HAS_KZ) return { mode: 'day', rows: [] }
  if (!kzToken) await kzLogin()
  const q = async (queryType) => {
    const r = await fetch('/kz/kzserver/biz/power/stationRevenueTrend', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Authorization': `Bearer ${kzToken}` },
      body: JSON.stringify({ queryType, stationId }),
    })
    if (r.status === 401 && !_retried) return null
    const j = await r.json()
    if (j.code !== 200) throw new Error(j.msg || 'kz 报表查询失败')
    return j.data || []
  }
  const day = await q(2)
  if (day === null) { kzToken = null; await kzLogin(); return kzRevenueTrend(stationId, true) }
  if (day.length) return { mode: 'day', rows: day }
  const month = await q(3)
  if (month === null) { kzToken = null; await kzLogin(); return kzRevenueTrend(stationId, true) }
  return { mode: 'month', rows: month }
}
// 大屏第二只读身份(镜像):报表账号是「客户账号」客户下的 CUSTOMER_USER,
// 能读到划归该客户的真实设备(BS_*/RY_* 等)——这些设备 Public 身份看不见。
let reportCustomerId = null
export async function reportAuth() {
  // 与 kz 报表解耦:只要该 TB 上存在报表账号即可用(不存在则登录失败,静默返回 null,
  // 由大屏的前端鉴权兜底接手)——直连/单文件部署下同样生效
  try {
    if (!kzToken) await kzLogin()
    if (!reportCustomerId) {
      const r = await fetch(`${API_BASE}/api/auth/user`, { headers: { 'X-Authorization': `Bearer ${kzToken}` } })
      if (!r.ok) return null
      reportCustomerId = (await r.json()).customerId?.id || null
    }
    return reportCustomerId ? { token: kzToken, customerId: reportCustomerId } : null
  } catch { return null }
}
export async function getCustomerDevices(customerId, tok) {
  const out = []
  for (let p = 0, hasNext = true; hasNext; p++) {
    const r = await fetch(`${API_BASE}/api/customer/${customerId}/devices?pageSize=100&page=${p}`,
      { headers: { 'X-Authorization': `Bearer ${tok}` } })
    if (!r.ok) break
    const page = await r.json()
    out.push(...page.data)
    hasNext = page.hasNext
  }
  return out
}

// 站点(网关)清单——向导用工具自己的 token 调
export async function kzStations(tbToken) {
  const r = await fetch('/kz/kzserver/biz/power/getStationInfoList', {
    headers: { 'X-Authorization': `Bearer ${tbToken}` },
  })
  const j = await r.json()
  return j.code === 200 ? (j.data || []) : []
}

let token = null

export async function login() {
  const r = await fetch(`${API_BASE}/api/auth/login/public`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ publicId: PUBLIC_ID }),
  })
  if (!r.ok) throw new Error(`login failed: ${r.status}`)
  token = (await r.json()).token
  return token
}

export const getToken = () => token

async function req(url, tok = null) {
  const r = await fetch(API_BASE + url, { headers: { 'X-Authorization': `Bearer ${tok || token}` } })
  if (r.status === 401 && !tok) {
    await login()
    return req(url)
  }
  if (!r.ok) throw new Error(`${url} → ${r.status}`)
  return r.json()
}

export async function getDevices() {
  const out = []
  for (let p = 0, hasNext = true; hasNext; p++) {
    const page = await req(`/api/customer/${PUBLIC_ID}/devices?pageSize=100&page=${p}`)
    out.push(...page.data)
    hasNext = page.hasNext
  }
  return out
}

// history: { key: [[ts, num], ...] } sorted ascending
export async function getHistory(deviceId, keys, minutes = 15, entityType = 'DEVICE', tok = null) {
  const endTs = Date.now()
  const startTs = endTs - minutes * 60 * 1000
  const raw = await req(
    `/api/plugins/telemetry/${entityType}/${deviceId}/values/timeseries` +
      `?keys=${keys.join(',')}&startTs=${startTs}&endTs=${endTs}&limit=2000&agg=NONE`,
    tok,
  )
  const out = {}
  for (const [key, arr] of Object.entries(raw)) {
    out[key] = arr
      .map((p) => [p.ts, parseFloat(p.value)])
      .sort((a, b) => a[0] - b[0])
  }
  return out
}
