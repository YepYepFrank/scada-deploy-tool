// 里程碑 C「规则链 24 小时稳定」采样:对 xrs-mirror-test 的产物取窗口内的更新间隔、告警触发/清除、规则节点生命周期与错误事件,
// 最后按三项判据(calc_ 持续更新 / 告警按预期触发与清除 / 无回环)给出结论。只读。
// 用法:node tb-stability-sample.mjs [--hours 24] [--start <ISO 时刻>] [--out <md 文件>]
//   --start 给了就以它为窗口起点(例如重发布时刻),窗口 = [start, start + hours] 与「现在」取小。
//
// 2026-10-08 改:判定不再依赖 TB 的历史 STATS 事件。09-09 那轮发现 TB 每个节点只留最近 1 条 STATS,
// 按小时累加会把「没取到」读成「处理了 0 条」。现在的证据都来自产物本身:
//   · 告警:按原始 P 逐台数 `P > 45` 的上升沿(窗口前最后一点作初值),与实建告警逐台对账;收尾时仍激活的
//     告警应正好是最后一点仍越限的设备。
//   · 无回环:产物点数不放大(pqSum : P ≈ 1、告警数 ≈ 上升沿数),而不是看节点消息计数。
//   · 节点事件(LC_EVENT / ERROR / STATS)只作旁证,并先报出 TB 实际保留到哪一刻;保留不覆盖窗口时明说,不当 0 算。
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
const DEV = fileURLToPath(new URL('..', import.meta.url))
const envPath = DEV + '.env.local'
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
const START_ARG = arg('--start', null)
const { TB_BASE = 'http://192.168.20.61:8080', TB_USER, TB_PASSWORD } = process.env

const SITE = 'xrs-mirror-test'
const ALARM_TYPE = '功率越限告警'
const ALARM_KEY = 'P'
const ALARM_GT = 45
const CASCADE_DEVICES = ['SSP1_GP1_IED1', 'SSP1_GP8_IED1']
const TZ_OFFSET = 8 * 3600e3 // 日级归档按东八区自然日
const LIVE_GAP = 2 * 60e3 // calc_ 连续更新:相邻两点不超过 2 分钟、收尾时最近一点不超过 2 分钟

const login = await fetch(`${TB_BASE}/api/auth/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ username: TB_USER, password: TB_PASSWORD }),
  signal: AbortSignal.timeout(15000),
}).catch(e => {
  console.error(`连不上 ${TB_BASE}:${e.message}`)
  process.exit(2)
})
if (!login.ok) {
  console.error(`登录 ${TB_BASE} 失败:HTTP ${login.status}`)
  process.exit(2)
}
const { token } = await login.json()
const H = { 'X-Authorization': `Bearer ${token}` }
const get = async u => {
  const r = await fetch(TB_BASE + u, { headers: H })
  if (!r.ok) return { __err: r.status, __body: (await r.text()).slice(0, 200) }
  return r.json()
}
const me = await get('/api/auth/user')
const tenantId = me.tenantId.id
const start = START_ARG ? Date.parse(START_ARG) : Date.now() - HOURS * 3600e3
if (Number.isNaN(start)) throw new Error(`--start 不是合法时刻:${START_ARG}`)
const now = Math.min(Date.now(), start + HOURS * 3600e3)
const span = now - start
const fmt = ts => new Date(ts).toISOString().replace('T', ' ').slice(0, 19) + 'Z'
const cfg = JSON.parse(readFileSync(`${DEV}sites/${SITE}.tbsite.json`, 'utf8'))
// 与编译器一致:按 Profile 选(声明里 SSP1_DP1_IED1 是 default,不在模板内)
const ieds = cfg.devices.filter(d => d.profile === 'IED').map(d => d.name)
const P = cfg.outputPrefix

const points = async (type, id, key, from = start, to = now) => {
  const r = await get(
    `/api/plugins/telemetry/${type}/${id}/values/timeseries?keys=${key}&startTs=${from}&endTs=${to}&limit=200000&agg=NONE&orderBy=ASC`
  )
  return (r?.[key] ?? []).map(p => ({ ts: p.ts, v: Number(p.value) })).sort((a, b) => a.ts - b.ts)
}
const lastBefore = async (type, id, key, ts) => {
  const r = await get(
    `/api/plugins/telemetry/${type}/${id}/values/timeseries?keys=${key}&startTs=${ts - 24 * 3600e3}&endTs=${ts - 1}&limit=1&agg=NONE&orderBy=DESC`
  )
  const p = r?.[key]?.[0]
  return p ? Number(p.value) : null
}
const stat = pts => {
  const ts = pts.map(p => p.ts)
  if (!ts.length) return { n: 0 }
  const gaps = []
  for (let i = 1; i < ts.length; i++) gaps.push(ts[i] - ts[i - 1])
  // 窗口首尾也算空档:窗口开头到第一点、最后一点到收尾
  const edgeGap = Math.max(ts[0] - start, now - ts[ts.length - 1])
  gaps.sort((a, b) => a - b)
  return {
    n: ts.length,
    first: ts[0],
    last: ts[ts.length - 1],
    med: gaps.length ? gaps[Math.floor(gaps.length / 2)] : 0,
    max: Math.max(gaps.length ? gaps[gaps.length - 1] : 0, edgeGap),
    age: now - ts[ts.length - 1],
  }
}
/** `v > gt` 的上升沿 / 下降沿;init 是窗口前最后一点(没有就以第一点为初值,不计沿) */
const edges = (pts, gt, init) => {
  let prev = init == null ? null : init > gt
  let up = 0,
    down = 0
  for (const p of pts) {
    const cur = p.v > gt
    if (prev != null && cur !== prev) {
      if (cur) up++
      else down++
    }
    prev = cur
  }
  return { up, down, end: prev, seeded: init != null }
}
const s = ms =>
  ms >= 3600e3
    ? (ms / 3600e3).toFixed(1) + 'h'
    : ms >= 60e3
      ? (ms / 60e3).toFixed(1) + 'm'
      : (ms / 1e3).toFixed(0) + 's'
const row = (label, st) =>
  st.n
    ? `| ${label} | ${st.n} | ${s(st.med)} | ${s(st.max)} | ${s(st.age)} 前 | ${fmt(st.first)} → ${fmt(st.last)} |`
    : `| ${label} | 0 | — | — | — | 无数据 |`
const lines = []
const out = l => {
  lines.push(l)
  console.log(l)
}
const verdict = [] // { item, ok, note }
const judge = (item, ok, note) => verdict.push({ item, ok, note })

const body = []
const put = l => {
  body.push(l)
  console.log(l)
}

// 1. 设备 CF calc_pqSum + 原始 P,同时数告警上升沿
put(`## 1. 设备级 CF \`${P}pqSum\`(${ieds.length} 台 IED)与原始 \`P\` 对照`)
put('')
put(
  '| 设备 | P 点数 | pqSum 点数 | pqSum 中位间隔 | pqSum 最大间隔 | pqSum 最近一点 | P>45 上升沿 / 下降沿 | 收尾越限 |'
)
put('|---|---|---|---|---|---|---|---|')
const devIds = {}
const devEdges = {}
let sumP = 0,
  sumPq = 0,
  worstGap = 0,
  worstAge = 0
const stale = []
for (const name of ieds) {
  const d = await get(`/api/tenant/devices?deviceName=${encodeURIComponent(name)}`)
  if (!d?.id) {
    put(`| ${name} | 设备不存在 | | | | | | |`)
    stale.push(name)
    continue
  }
  devIds[name] = d.id.id
  const [p, pq, init] = await Promise.all([
    points('DEVICE', d.id.id, 'P'),
    points('DEVICE', d.id.id, `${P}pqSum`),
    lastBefore('DEVICE', d.id.id, ALARM_KEY, start),
  ])
  const sp = stat(p),
    spq = stat(pq)
  const e = edges(p, ALARM_GT, init)
  devEdges[name] = e
  sumP += sp.n
  sumPq += spq.n
  worstGap = Math.max(worstGap, spq.max ?? 0)
  worstAge = Math.max(worstAge, spq.age ?? 0)
  if (!spq.n || spq.max > LIVE_GAP || spq.age > LIVE_GAP) stale.push(name)
  put(
    `| ${name} | ${sp.n} | ${spq.n} | ${spq.n ? s(spq.med) : '—'} | ${spq.n ? s(spq.max) : '—'} | ${spq.n ? s(spq.age) + ' 前' : '无'} | ${e.up} / ${e.down}${e.seeded ? '' : '(无初值)'} | ${e.end ? '是' : '否'} |`
  )
}
const ratio = sumPq / Math.max(sumP, 1)
put('')
put(
  `合计:P ${sumP} 点,pqSum ${sumPq} 点(比值 ${ratio.toFixed(3)});最大间隔 ${s(worstGap)},最久未更新 ${s(worstAge)};间隔或滞后超过 ${s(LIVE_GAP)} 的设备:${stale.length ? stale.join(', ') : '无'}`
)
put('')
judge(
  `设备级 CF \`${P}pqSum\` 持续更新`,
  sumP > 0 && !stale.length && ratio > 0.99,
  `${ieds.length} 台,pqSum : P = ${sumPq} : ${sumP},最大间隔 ${s(worstGap)}`
)

// 2. 汇聚资产 calc_totalP
put(`## 2. 汇聚资产 \`${SITE}-agg\`(分层 CF)`)
put('')
const agg = await get(`/api/tenant/assets?assetName=${SITE}-agg`)
put('| key | 点数 | 中位间隔 | 最大间隔 | 最近一点 | 范围 |')
put('|---|---|---|---|---|---|')
if (agg?.id) {
  const keys = ((await get(`/api/plugins/telemetry/ASSET/${agg.id.id}/keys/timeseries`)) ?? []).filter(k =>
    k.startsWith(P)
  )
  let aggOk = keys.length > 0,
    aggMax = 0,
    aggN = 0
  for (const k of keys) {
    const st = stat(await points('ASSET', agg.id.id, k))
    put(row(`\`${k}\``, st))
    if (!st.n || st.max > LIVE_GAP) aggOk = false
    aggMax = Math.max(aggMax, st.max ?? 0)
    if (k === `${P}totalP`) aggN = st.n
  }
  judge(`汇聚 \`${P}totalP\` 持续更新`, aggOk, `${aggN} 点,${keys.length} 个 key 最大间隔 ${s(aggMax)}`)
} else {
  put('| 资产不存在 | | | | | |')
  judge(`汇聚 \`${P}totalP\` 持续更新`, false, '汇聚资产不存在')
}
put('')

// 3. 级联归档。日级点戳在那个自然日的 0 点(东八区),落库是在第二天第一拍,所以按「日」对账而不是按点戳落在窗口内。
put(`## 3. 级联归档(\`window.cascade\`,${CASCADE_DEVICES.join(' / ')})`)
put('')
const dayOf = ts => Math.floor((ts + TZ_OFFSET) / 86400e3)
const dayStart = d => d * 86400e3 - TZ_OFFSET
// 窗口内「整日结束且之后满一拍(1h + 余量)」的自然日,都应该有日点
const dueDays = []
for (let d = dayOf(start) - 1; dayStart(d + 1) + 75 * 60e3 <= now; d++) if (dayStart(d + 1) >= start) dueDays.push(d)
const dayName = d => new Date(dayStart(d) + TZ_OFFSET).toISOString().slice(0, 10)
put(
  `窗口 ${s(span)}:5m 应约 ${Math.floor(span / 300e3)} 点、1h 应约 ${Math.floor(span / 3600e3)} 点;日级应有的自然日(东八区):${dueDays.map(dayName).join('、') || '无(窗口里没有走完的自然日)'}`
)
put('')
put('| 设备 · key | 点数 | 中位间隔 | 最大间隔 | 最近一点 | 范围 |')
put('|---|---|---|---|---|---|')
let cascadeOk = true
const cascadeNotes = []
for (const name of CASCADE_DEVICES) {
  const id = devIds[name]
  if (!id) {
    cascadeOk = false
    cascadeNotes.push(`${name} 不存在`)
    continue
  }
  const keys = ((await get(`/api/plugins/telemetry/DEVICE/${id}/keys/timeseries`)) ?? [])
    .filter(k => k.startsWith(P) && k !== `${P}pqSum` && !k.includes('__'))
    .sort()
  if (!keys.length) {
    cascadeOk = false
    cascadeNotes.push(`${name} 没有归档 key`)
  }
  for (const k of keys) {
    if (/1d$/.test(k)) {
      const pts = await points('DEVICE', id, k, start - 2 * 86400e3, now)
      // 日点只认戳在那天 0 点(东八区)的;同一天别的时刻的点是别人写进来的,窗口内出现就算异常
      const onEdge = pts.filter(p => p.ts === dayStart(dayOf(p.ts)))
      const have = new Set(onEdge.map(p => dayOf(p.ts)))
      const miss = dueDays.filter(d => !have.has(d))
      const got = onEdge.filter(p => dueDays.includes(dayOf(p.ts)))
      const stray = pts.filter(p => p.ts !== dayStart(dayOf(p.ts)))
      const strayIn = stray.filter(p => p.ts >= start && p.ts <= now)
      const strayNote = stray.length
        ? `;非 0 点的点 ${stray.length} 个(窗口内 ${strayIn.length},${fmt(stray[0].ts)} → ${fmt(stray[stray.length - 1].ts)})`
        : ''
      put(
        `| ${name} · \`${k}\` | ${got.length} / ${dueDays.length} 日 | — | — | — | ${got.map(p => `${dayName(dayOf(p.ts))}=${p.v.toFixed(2)}`).join(',') || '无'}${miss.length ? `;**缺 ${miss.map(dayName).join('、')}**` : ''}${strayNote} |`
      )
      if (miss.length || strayIn.length) {
        cascadeOk = false
        cascadeNotes.push(
          `${name} ${k}${miss.length ? ` 缺 ${miss.map(dayName).join('、')}` : ''}${strayIn.length ? ` 窗口内有 ${strayIn.length} 个非 0 点的日点` : ''}`
        )
      }
      continue
    }
    const st = stat(await points('DEVICE', id, k))
    put(row(`${name} · \`${k}\``, st))
    const period = /5m$/.test(k) ? 300e3 : /1h$/.test(k) ? 3600e3 : null
    if (period) {
      const expect = Math.floor(span / period)
      // 允许少 1 拍(窗口首尾对不齐);间隔超过 1.5 个周期说明漏拍
      if (st.n < expect - 1 || st.max > period * 2.5) {
        cascadeOk = false
        cascadeNotes.push(`${name} ${k} ${st.n}/${expect} 点、最大间隔 ${st.n ? s(st.max) : '—'}`)
      }
    }
  }
}
put('')
judge('级联归档 5m / 1h / 1d', cascadeOk, cascadeNotes.join(';') || '各级点数与日点齐全')

// 4. 告警:与上升沿逐台对账
put(`## 4. 告警「${ALARM_TYPE}」(\`${ALARM_KEY} > ${ALARM_GT}\` 边沿,窗口内新建的)`)
put('')
const alarms = []
let totalInWindow = 0
for (let page = 0; ; page++) {
  const al = await get(
    `/api/v2/alarms?pageSize=1000&page=${page}&startTime=${start}&endTime=${now}&sortProperty=createdTime&sortOrder=ASC`
  )
  if (al?.__err) {
    put(`(告警查询失败:HTTP ${al.__err})`)
    break
  }
  totalInWindow = al.totalElements ?? totalInWindow
  alarms.push(...(al.data ?? []).filter(a => a.type === ALARM_TYPE))
  if (!al.hasNext) break
}
const isCleared = a => a.cleared || a.clearTs > 0
const byDev = {}
for (const a of alarms) {
  const k = a.originatorName ?? a.originator?.id
  ;(byDev[k] ??= []).push(a)
}
// 收尾时仍激活的(不限窗口内新建,窗口前建的、现在还没清的也算)
const act = await get(
  `/api/v2/alarms?pageSize=1000&page=0&statusList=ACTIVE&typeList=${encodeURIComponent(ALARM_TYPE)}&sortProperty=createdTime&sortOrder=DESC`
)
const activeNow = new Set((act?.data ?? []).map(a => a.originatorName))
// 只有收尾就是「现在」时才能对激活状态;用 --start 回看历史窗口时跳过
const checkActive = Date.now() - now < 5 * 60e3
put('| 设备 | 上升沿 | 新建告警 | 差 | 已清除 | 收尾越限 | 收尾有激活告警 |')
put('|---|---|---|---|---|---|---|')
let alarmOk = true
const alarmNotes = []
let sumUp = 0
for (const name of ieds) {
  const e = devEdges[name]
  if (!e) continue
  const list = byDev[name] ?? []
  const diff = list.length - e.up
  sumUp += e.up
  // 允许差 1:窗口开头那一刻告警与采样点的先后
  const okCount = Math.abs(diff) <= 1
  const okActive = !checkActive || e.end === activeNow.has(name)
  if (!okCount || !okActive) {
    alarmOk = false
    alarmNotes.push(`${name} 沿 ${e.up} / 告警 ${list.length}${okActive ? '' : ',激活状态与收尾越限不符'}`)
  }
  if (!e.up && !list.length) continue
  put(
    `| ${name} | ${e.up} | ${list.length} | ${diff > 0 ? '+' : ''}${diff} | ${list.filter(isCleared).length} | ${e.end ? '是' : '否'} | ${activeNow.has(name) ? '是' : '否'} |`
  )
}
const strays = Object.keys(byDev).filter(k => !ieds.includes(k))
if (strays.length) {
  alarmOk = false
  alarmNotes.push(`模板外的设备也建了告警:${strays.join(', ')}`)
}
if (!sumUp && !alarms.length) {
  alarmOk = false
  alarmNotes.push('窗口内没有越限,也没有告警,无从验证')
}
const prop = alarms.filter(a => a.propagate).length
if (prop !== alarms.length) {
  alarmOk = false
  alarmNotes.push(`propagate 只有 ${prop}/${alarms.length}`)
}
put('')
put(
  `- 窗口内新建 ${alarms.length} 条(已清除 ${alarms.filter(isCleared).length},propagate=true ${prop});上升沿合计 ${sumUp};全租户窗口内告警 ${totalInWindow} 条;当前激活 ${activeNow.size} 台`
)
put('')
judge(
  '告警按预期触发与清除',
  alarmOk,
  alarmNotes.join(';') || `${alarms.length} 条 = 上升沿 ${sumUp}(逐台差 ≤ 1),全部 propagate,收尾激活与越限一致`
)

// 5. 规则节点事件:只作旁证
put(`## 5. 规则节点事件(旁证;先看 TB 保留到哪一刻)`)
put('')
const chains = (await get('/api/ruleChains?pageSize=200&page=0')).data ?? []
const mine = chains.filter(c => c.name.endsWith(`· ${SITE}`))
const rootChain = chains.find(c => c.root)
// 级联归档在租户共用的定时链(镜像上叫 Periodic Rollups)里,链名不带站点;只取节点名里点了本站设备的那些节点
const metas = {}
for (const c of chains) metas[c.id.id] = await get(`/api/ruleChain/${c.id.id}/metadata`)
const ownNode = n => ieds.some(d => n.name.includes(` ${d} `) || n.name.endsWith(` ${d}`))
const shared = chains.filter(c => !c.root && !mine.includes(c) && (metas[c.id.id].nodes ?? []).some(ownNode))
const events = async (id, type, from, to) => {
  const q = from == null ? '' : `&startTime=${from}&endTime=${to}`
  const r = await get(`/api/events/RULE_NODE/${id}/${type}?tenantId=${tenantId}&pageSize=1000&page=0${q}`)
  return r?.data ?? []
}
put('| 规则链 | 节点 | 最早保留事件 | 窗口内启动 | 启动失败 | ERROR 事件 | 最近 STATS 错误 |')
put('|---|---|---|---|---|---|---|')
let earliestKept = Infinity,
  startFails = 0,
  errEvents = 0,
  statErrs = 0
const restarts = []
for (const c of [...mine, ...shared, rootChain].filter(Boolean)) {
  const all = metas[c.id.id]
  const meta = shared.includes(c) ? { nodes: all.nodes.filter(ownNode) } : all
  let chainEarliest = Infinity,
    started = 0,
    fails = 0,
    errs = 0,
    sErr = 0
  for (const n of meta.nodes ?? []) {
    const [lc, er, st] = await Promise.all([
      events(n.id.id, 'LC_EVENT'),
      events(n.id.id, 'ERROR', start, now),
      events(n.id.id, 'STATS'),
    ])
    for (const e of [...lc, ...st]) chainEarliest = Math.min(chainEarliest, e.createdTime)
    const inWin = lc.filter(e => e.createdTime >= start && e.createdTime <= now && e.body?.event === 'STARTED')
    started += inWin.length
    fails += inWin.filter(e => e.body?.success === false).length
    for (const e of inWin) restarts.push(e.createdTime)
    errs += er.length
    const latest = st.sort((a, b) => b.createdTime - a.createdTime)[0]
    sErr += latest?.body?.errorsOccurred ?? 0
  }
  const isMine = !c.root
  if (isMine) {
    earliestKept = Math.min(earliestKept, chainEarliest)
    startFails += fails
    errEvents += errs
    statErrs += sErr
  }
  put(
    `| ${c.root ? `${c.name}(Root,全链,不计入判定)` : shared.includes(c) ? `${c.name}(共用链,只计本站设备的节点)` : c.name} | ${meta.nodes?.length ?? '?'} | ${Number.isFinite(chainEarliest) ? fmt(chainEarliest) : '无'} | ${started} | ${fails} | ${errs} | ${sErr} |`
  )
}
put('')
const covered = earliestKept <= start
put(
  covered
    ? `- 本站链的事件保留覆盖整个窗口。`
    : `- **TB 只保留到 ${Number.isFinite(earliestKept) ? fmt(earliestKept) : '(没有任何事件)'}**,窗口前段的 ERROR / 启停无从查;下面的 0 只代表保留范围内为 0。`
)
const restartMinutes = [...new Set(restarts.map(t => Math.floor(t / 60e3)))].map(m => fmt(m * 60e3).slice(0, 16))
put(`- 窗口内节点启动的时刻(按分钟去重):${restartMinutes.join('、') || '无'}`)
put('')

// 6. 无回环:看产物有没有被放大
const loopNotes = []
if (ratio > 1.01) loopNotes.push(`pqSum : P = ${ratio.toFixed(3)}`)
if (alarms.length > sumUp + ieds.length) loopNotes.push(`告警 ${alarms.length} 远超上升沿 ${sumUp}`)
if (errEvents || statErrs) loopNotes.push(`ERROR 事件 ${errEvents}、最近 STATS 错误 ${statErrs}`)
if (startFails) loopNotes.push(`节点启动失败 ${startFails} 次`)
judge(
  '无回环(产物不放大、无节点错误)',
  !loopNotes.length && sumP > 0,
  loopNotes.join(';') ||
    `pqSum : P = ${ratio.toFixed(3)},告警 ≈ 上升沿,ERROR 0${covered ? '' : '(事件保留只覆盖窗口后段)'}`
)
put(
  `设备上报(P)合计 ${sumP} 点 / ${s(span)} ≈ ${(sumP / (span / 60e3)).toFixed(1)} 条/分钟;pqSum 与告警都按它的量级出,没有放大即无回环。`
)

// 结论放最前面
out(`# 规则链 24 小时稳定采样 · ${fmt(now)}(窗口 ${s(span)},${fmt(start)} 起)`)
out('')
out(`后端 ${TB_BASE},站点 ${SITE}。脚本 \`scripts/tb-stability-sample.mjs\`(只读)。`)
out('')
out('## 结论')
out('')
out('| 判据 | 结果 | 说明 |')
out('|---|---|---|')
for (const v of verdict) out(`| ${v.item} | ${v.ok ? '✅' : '❌'} | ${v.note} |`)
out('')
const allOk = verdict.every(v => v.ok)
out(
  allOk
    ? `**${s(span)} 窗口全部通过。**${span < 24 * 3600e3 ? '(窗口不足 24h,只算中途检查。)' : ''}`
    : '**有判据没过,见上表与下文。**'
)
out('')
lines.push(...body)

await fetch(`${TB_BASE}/api/auth/logout`, { method: 'POST', headers: H }).catch(() => {})
if (OUT) writeFileSync(OUT, lines.join('\n') + '\n')
process.exitCode = allOk ? 0 : 1
