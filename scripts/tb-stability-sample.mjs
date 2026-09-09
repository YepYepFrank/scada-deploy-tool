// 里程碑 C「规则链 24 小时稳定」采样:对镜像上 xrs-mirror-test 的产物取最近 24h 的更新间隔、告警触发/清除、规则节点 STATS/ERROR 事件。
// 只读。用法:node tb-stability-sample.mjs [--hours 24] [--out <md 文件>]
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
const envPath = 'D:/Coding/Demo - Copy/dev/.env.local'
if (existsSync(envPath))
  for (const line of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/)
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
  }
const arg = (k, d) => {
  const i = process.argv.indexOf(k)
  return i > 0 ? process.argv[i + 1] : d
}
const HOURS = Number(arg('--hours', 24))
const OUT = arg('--out', null)
const { TB_BASE = 'http://192.168.20.61:8080', TB_USER, TB_PASSWORD } = process.env
const { token } = await (
  await fetch(`${TB_BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: TB_USER, password: TB_PASSWORD }),
  })
).json()
const H = { 'X-Authorization': `Bearer ${token}` }
const get = async u => {
  const r = await fetch(TB_BASE + u, { headers: H })
  if (!r.ok) return { __err: r.status, __body: (await r.text()).slice(0, 200) }
  return r.json()
}
const me = await get('/api/auth/user')
const tenantId = me.tenantId.id
const now = Date.now()
const start = now - HOURS * 3600e3
const fmt = ts => new Date(ts).toISOString().replace('T', ' ').slice(0, 19) + 'Z'
const cfg = JSON.parse(readFileSync('D:/Coding/Demo - Copy/dev/sites/xrs-mirror-test.tbsite.json', 'utf8'))
// 与编译器一致:按 Profile 选(声明里 SSP1_DP1_IED1 是 default,不在模板内)
const ieds = cfg.devices.filter(d => d.profile === 'IED').map(d => d.name)
const P = cfg.outputPrefix

const series = async (type, id, key, agg = 'NONE') => {
  const r = await get(`/api/plugins/telemetry/${type}/${id}/values/timeseries?keys=${key}&startTs=${start}&endTs=${now}&limit=200000&agg=${agg}&orderBy=ASC`)
  return (r?.[key] ?? []).map(p => p.ts).sort((a, b) => a - b)
}
const stat = ts => {
  if (!ts.length) return { n: 0 }
  const gaps = []
  for (let i = 1; i < ts.length; i++) gaps.push(ts[i] - ts[i - 1])
  gaps.sort((a, b) => a - b)
  const med = gaps.length ? gaps[Math.floor(gaps.length / 2)] : 0
  return { n: ts.length, first: ts[0], last: ts[ts.length - 1], med, max: gaps.length ? gaps[gaps.length - 1] : 0, age: now - ts[ts.length - 1] }
}
const s = ms => (ms >= 3600e3 ? (ms / 3600e3).toFixed(1) + 'h' : ms >= 60e3 ? (ms / 60e3).toFixed(1) + 'm' : (ms / 1e3).toFixed(0) + 's')
const row = (label, st) => (st.n ? `| ${label} | ${st.n} | ${s(st.med)} | ${s(st.max)} | ${s(st.age)} 前 | ${fmt(st.first)} → ${fmt(st.last)} |` : `| ${label} | 0 | — | — | — | 无数据 |`)
const lines = []
const out = l => {
  lines.push(l)
  console.log(l)
}
out(`# 规则链 24 小时稳定采样 · ${fmt(now)}(窗口 ${HOURS}h,${fmt(start)} 起)`)
out('')

// 1. 设备 CF calc_pqSum + 原始 P
out(`## 1. 设备级 CF \`${P}pqSum\`(${ieds.length} 台 IED)与原始 \`P\` 对照`)
out('')
out('| 设备 | P 点数 | pqSum 点数 | pqSum 中位间隔 | pqSum 最大间隔 | pqSum 最近一点 |')
out('|---|---|---|---|---|---|')
const devIds = {}
let sumP = 0,
  sumPq = 0,
  worstGap = 0,
  worstAge = 0,
  stale = []
for (const name of ieds) {
  const d = await get(`/api/tenant/devices?deviceName=${encodeURIComponent(name)}`)
  if (!d?.id) {
    out(`| ${name} | 设备不存在 | | | | |`)
    continue
  }
  devIds[name] = d.id.id
  const [p, pq] = await Promise.all([series('DEVICE', d.id.id, 'P'), series('DEVICE', d.id.id, `${P}pqSum`)])
  const sp = stat(p),
    spq = stat(pq)
  sumP += sp.n
  sumPq += spq.n
  worstGap = Math.max(worstGap, spq.max ?? 0)
  worstAge = Math.max(worstAge, spq.age ?? 0)
  if (!spq.n || spq.age > 10 * 60e3) stale.push(name)
  out(`| ${name} | ${sp.n} | ${spq.n} | ${spq.n ? s(spq.med) : '—'} | ${spq.n ? s(spq.max) : '—'} | ${spq.n ? s(spq.age) + ' 前' : '无'} |`)
}
out('')
out(`合计:P ${sumP} 点,pqSum ${sumPq} 点(比值 ${(sumPq / Math.max(sumP, 1)).toFixed(2)});最大间隔 ${s(worstGap)},最久未更新 ${s(worstAge)};超过 10 分钟没更新的设备:${stale.length ? stale.join(', ') : '无'}`)
out('')

// 2. 汇聚资产 calc_totalP
out(`## 2. 汇聚资产 \`xrs-mirror-test-agg\`(分层 CF)`)
out('')
const agg = (await get('/api/tenant/assets?assetName=xrs-mirror-test-agg'))
out('| key | 点数 | 中位间隔 | 最大间隔 | 最近一点 | 范围 |')
out('|---|---|---|---|---|---|')
if (agg?.id) {
  const keys = (await get(`/api/plugins/telemetry/ASSET/${agg.id.id}/keys/timeseries`)) ?? []
  for (const k of keys.filter(k => k.startsWith(P))) out(row(`\`${k}\``, stat(await series('ASSET', agg.id.id, k))))
} else out('| 资产不存在 | | | | | |')
out('')

// 3. 级联归档
out(`## 3. 级联归档(\`window.cascade\`,SSP1_GP1_IED1 / SSP1_GP8_IED1)`)
out('')
out('| 设备 · key | 点数 | 中位间隔 | 最大间隔 | 最近一点 | 范围 |')
out('|---|---|---|---|---|---|')
for (const name of ['SSP1_GP1_IED1', 'SSP1_GP8_IED1']) {
  const id = devIds[name]
  if (!id) continue
  const keys = ((await get(`/api/plugins/telemetry/DEVICE/${id}/keys/timeseries`)) ?? []).filter(k => k.startsWith(P) && k !== `${P}pqSum`).sort()
  for (const k of keys) out(row(`${name} · \`${k}\``, stat(await series('DEVICE', id, k))))
}
out('')

// 4. 告警
out(`## 4. 告警「功率越限告警」(\`P > 45\` 边沿,窗口内)`)
out('')
const al = await get(`/api/v2/alarms?pageSize=1000&page=0&startTime=${start}&endTime=${now}&sortProperty=createdTime&sortOrder=DESC`)
const alarms = (al?.data ?? []).filter(a => a.type === '功率越限告警')
const created = alarms.filter(a => a.createdTime >= start)
const cleared = alarms.filter(a => a.cleared || a.clearTs > 0)
const active = alarms.filter(a => !(a.cleared || a.clearTs > 0))
const prop = alarms.filter(a => a.propagate)
const byDev = {}
for (const a of alarms) byDev[a.originatorName ?? a.originator?.id] = (byDev[a.originatorName ?? a.originator?.id] ?? 0) + 1
out(`- 窗口内命中的告警 ${alarms.length} 条(新建 ${created.length},已清除 ${cleared.length},仍激活 ${active.length},propagate=true ${prop.length});全租户窗口内告警总数 ${al?.totalElements ?? '?'}`)
out(`- 按设备:${Object.entries(byDev).map(([k, v]) => `${k} ${v}`).join(', ') || '无'}`)
const lastAlarms = alarms.slice(0, 5)
if (lastAlarms.length) {
  out('')
  out('| 设备 | 严重度 | 创建 | 清除 | 详情 |')
  out('|---|---|---|---|---|')
  for (const a of lastAlarms) out(`| ${a.originatorName ?? ''} | ${a.severity} | ${fmt(a.startTs ?? a.createdTime)} | ${a.clearTs ? fmt(a.clearTs) : '—'} | ${JSON.stringify(a.details ?? {}).slice(0, 80)} |`)
}
out('')

// 5. 规则链 STATS / ERROR
out(`## 5. 规则链节点事件(STATS 每小时一条;ERROR 逐条)`)
out('')
const chains = (await get('/api/ruleChains?pageSize=100&page=0')).data ?? []
const mine = chains.filter(c => c.name.endsWith('· xrs-mirror-test'))
const rootChain = chains.find(c => c.root)
out('| 规则链 | 节点 | 处理消息 | 节点错误 | ERROR 事件 | STATS 条数 | 最忙节点 |')
out('|---|---|---|---|---|---|---|')
const events = async (id, type) => {
  const r = await get(`/api/events/RULE_NODE/${id}/${type}?tenantId=${tenantId}&pageSize=1000&page=0&startTime=${start}&endTime=${now}`)
  return r?.data ?? []
}
const chainRows = []
for (const c of [...mine, rootChain]) {
  const meta = await get(`/api/ruleChain/${c.id.id}/metadata`)
  let msgs = 0,
    errs = 0,
    errEvents = 0,
    statsN = 0,
    busiest = ['', 0]
  const nodeStats = []
  for (const n of meta.nodes) {
    const st = await events(n.id.id, 'STATS')
    const er = await events(n.id.id, 'ERROR')
    const m = st.reduce((a, e) => a + (e.body?.messagesProcessed ?? 0), 0)
    const e = st.reduce((a, e) => a + (e.body?.errorsOccurred ?? 0), 0)
    msgs += m
    errs += e
    errEvents += er.length
    statsN += st.length
    nodeStats.push({ name: n.name, type: n.type.split('.').pop(), m, e, er: er.length })
    if (m > busiest[1]) busiest = [n.name, m]
  }
  const label = c.root ? `${c.name}(Root,只计与本站相关不可分,列全链)` : c.name
  out(`| ${label} | ${meta.nodes.length} | ${msgs} | ${errs} | ${errEvents} | ${statsN} | ${busiest[0]} ${busiest[1]} |`)
  chainRows.push({ name: c.name, nodeStats })
}
out('')
for (const cr of chainRows.filter(x => !x.name.startsWith('Root'))) {
  out(`<details><summary>${cr.name} 逐节点</summary>`)
  out('')
  out('| 节点 | 类型 | 处理消息 | 错误 | ERROR 事件 |')
  out('|---|---|---|---|---|')
  for (const n of cr.nodeStats) out(`| ${n.name} | ${n.type} | ${n.m} | ${n.e} | ${n.er} |`)
  out('')
  out('</details>')
  out('')
}
// 设备上报速率对照:窗口内 32 台 P 点数合计 vs 告警链入口节点处理消息
out(`设备上报(P)合计 ${sumP} 点 / ${HOURS}h ≈ ${(sumP / HOURS / 60).toFixed(1)} 条/分钟;告警链处理消息见上表(同量级即无回环)。`)
if (OUT) writeFileSync(OUT, lines.join('\n') + '\n')
