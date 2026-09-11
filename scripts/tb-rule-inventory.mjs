// 只读普查:TB 上的规则链与计算字段,分「本工具声明过的」与「别人的」,并判断别人的计算字段能不能套进向导模板。
// 给《第三步保存即写 TB + 同步》讨论稿用(docs/方案讨论-第三步保存即写TB与同步-2026-09-10.md)。
//
//   node scripts/tb-rule-inventory.mjs          # 汇总
//   node scripts/tb-rule-inventory.mjs --root   # 另列 Root 链全部节点
//
// 「本工具的」只按各站点资产当前 siteConfig 声明的输出名判断——这正是讨论稿里说的漏洞:
// 早先发布过、后来从声明里删掉的输出,这里会被算成「别人的」。
// 凭据只从 dev/.env.local 读(TB_USER / TB_PASSWORD),不打印 token,跑完登出。
import { readFileSync } from 'node:fs'

for (const line of readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split(/\r?\n/)) {
  const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line)
  if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
}
const TB = process.env.TB_BASE || 'http://192.168.20.61:8080'
const showRoot = process.argv.includes('--root')

const login = await fetch(`${TB}/api/auth/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ username: process.env.TB_USER, password: process.env.TB_PASSWORD }),
})
if (!login.ok) throw new Error(`登录失败 HTTP ${login.status}`)
const H = { 'X-Authorization': `Bearer ${(await login.json()).token}` }
const j = async p => {
  const r = await fetch(TB + p, { headers: H })
  return r.ok ? r.json() : null
}
const all = async p => {
  const out = []
  for (let i = 0, more = true; more; i++) {
    const pg = await j(`${p}${p.includes('?') ? '&' : '?'}pageSize=100&page=${i}`)
    out.push(...(pg?.data ?? []))
    more = !!pg?.hasNext
  }
  return out
}

const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
/** 别人的 SIMPLE 表达式能不能套进向导「自定义四则」(从左到右、每项可取绝对值) */
function fit(expr, argNames) {
  const e = String(expr ?? '').replace(/\s+/g, '')
  if (!argNames.some(a => new RegExp(`(^|[^\\w])${esc(a)}([^\\w]|$)`).test(e))) return '纯常数'
  // 2026-09-11 起向导支持「对整个结果取绝对值」:最外层整个包住的 abs 剥掉再判
  const whole = /^abs\((.*)\)$/.exec(e)
  const body = whole && !/abs\([^()]*[-+*/][^()]*\)/.test(whole[1]) ? whole[1] : e
  if (/abs\([^()]*[-+*/][^()]*\)/.test(body)) return 'abs 只包住一部分'
  const flat = body.replace(/abs\(([^()]*)\)/g, '$1').replace(/[()]/g, '')
  if (/[+-]/.test(flat) && /[*/]/.test(flat) && !body.startsWith('(')) return '有运算优先级'
  return body === e ? '能套模板' : '能套模板(整体取绝对值)'
}

try {
  // 1. 规则链
  const chains = await all('/api/ruleChains')
  const ours = /^(Site Alarms|Site Rollups|Site Revenue) · /
  console.log(`规则链 ${chains.length} 条`)
  for (const c of chains) {
    const m = await j(`/api/ruleChain/${c.id.id}/metadata`)
    const nodes = m?.nodes ?? []
    const gen = nodes.filter(n => /GeneratorNode$/.test(n.type)).length
    const rest = nodes.filter(n => /RestApiCallNode$/.test(n.type)).length
    console.log(
      `  ${c.root ? '[Root] ' : ''}${c.name} · ${nodes.length} 节点` +
        (gen ? ` · ${gen} 个定时器` : '') +
        (rest ? ` · ${rest} 个 REST 调用` : '') +
        ` · 版本 ${m?.version ?? '?'} · ${ours.test(c.name) ? '本工具' : '别人'}`
    )
    if (c.root) {
      const flows = nodes.filter(n => /^site alarms flow · /.test(n.name)).map(n => n.name)
      console.log(`      其中本工具的转发节点:${flows.join('、') || '无'}`)
      if (showRoot) for (const n of nodes) console.log(`      - ${n.type.split('.').pop()} 「${n.name}」`)
    }
  }

  // 2. 各站点当前声明的输出名
  const assets = await all('/api/tenant/assets')
  const declared = new Set()
  for (const s of assets.filter(a => a.type === 'tbsite')) {
    const at = (await j(`/api/plugins/telemetry/ASSET/${s.id.id}/values/attributes/SERVER_SCOPE?keys=siteConfig`)) ?? []
    const raw = at.find(a => a.key === 'siteConfig')?.value
    const cfg = typeof raw === 'string' ? JSON.parse(raw) : raw
    const pfx = cfg?.outputPrefix || ''
    const outs = [
      ...(cfg?.computations ?? []).map(c => c.output),
      ...(cfg?.deviceTemplates ?? []).flatMap(t => (t.items ?? []).map(i => i.output)),
    ].filter(Boolean)
    for (const o of outs) declared.add(o).add(pfx + o)
    console.log(`站点资产 ${s.name}:${cfg?.computations?.length ?? 0} 运算 · ${cfg?.deviceTemplates?.length ?? 0} 模板`)
  }

  // 3. 全部设备 / 资产上的计算字段
  const devices = await all('/api/tenant/devices')
  const rows = []
  for (const [type, e] of [...devices.map(d => ['DEVICE', d]), ...assets.map(a => ['ASSET', a])]) {
    const cfs = (await j(`/api/${type}/${e.id.id}/calculatedFields?pageSize=50&page=0`))?.data ?? []
    for (const f of cfs) {
      const args = Object.keys(f.configuration?.arguments ?? {})
      rows.push({
        ent: `${type === 'DEVICE' ? '设备' : '资产'} ${e.name}`,
        name: f.name,
        out: f.configuration?.output?.name ?? '',
        type: f.type,
        expr: f.configuration?.expression ?? '',
        ours: declared.has(f.name) || /__p\d+$/.test(f.name),
        fit: fit(f.configuration?.expression, args),
      })
    }
  }
  const foreign = rows.filter(r => !r.ours)
  console.log(
    `\n设备 ${devices.length} 台 · 资产 ${assets.length} 个 · 计算字段 ${rows.length} 个` +
      `(对得上当前声明 ${rows.length - foreign.length} / 对不上 ${foreign.length})`
  )
  const count = (list, f) => list.reduce((m, r) => ((m[f(r)] = (m[f(r)] ?? 0) + 1), m), {})
  console.log('按类型:', JSON.stringify(count(rows, r => r.type)))
  console.log('对不上的按「能否套进向导模板」:', JSON.stringify(count(foreign, r => r.fit)))
  console.log(
    '对不上的里「计算字段名 ≠ 输出测点名」:',
    foreign.filter(r => r.out && r.out !== r.name).length,
    '/',
    foreign.length
  )
  for (const r of foreign)
    console.log(`  ${r.ent} · ${r.name}${r.out && r.out !== r.name ? ` → ${r.out}` : ''} · ${r.fit} · ${r.expr}`)
  const per = count(rows, r => r.ent)
  console.log(
    '计算字段 ≥ 4 个的实体(TB 单实体上限 5):',
    Object.entries(per)
      .filter(([, n]) => n >= 4)
      .map(([k, n]) => `${k}=${n}`)
      .join(', ') || '无'
  )
} finally {
  await fetch(`${TB}/api/auth/logout`, { method: 'POST', headers: H })
}
