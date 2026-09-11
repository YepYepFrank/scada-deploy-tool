// 冲突示例(2026-09-11):在镜像上建一个示例站点 conflict-demo,再模拟「同事在 TB 里改过」,
// 给向导第 3 步手动验证冲突的「查看差异」与「待定 / 以 TB 为准 / 以本工具为准」。
//   node scripts/tb-conflict-demo.mjs setup      建站点并造 3 处冲突(会先清掉上一轮留下的)
//   node scripts/tb-conflict-demo.mjs check      按平台上发布的配置跑一遍第 3 步同步,打印向导应显示的状态与差异
//   node scripts/tb-conflict-demo.mjs teardown   全部清掉(计算字段、规则链、结果资产、站点资产、A1 上的临时遥测)
// 只用两台测试设备 Test Device A1 / A2,不建告警、不碰 Root 链。
// 凭据只从 dev/.env.local 读(TB_USER / TB_PASSWORD,可选 TB_BASE),不打印 token,跑完登出。
// 先构建编译器:pnpm -F @grid/tbsite-compiler build
import { readFileSync } from 'node:fs'
import {
  cleanup,
  findAsset,
  listCfs,
  publish,
  readPlatformState,
  resolveDeviceIds,
} from '../packages/compiler/dist/index.js'

for (const line of readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*)$/)
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^['"]|['"]$/g, '')
}
const BASE = process.env.TB_BASE || 'http://192.168.20.61:8080'
let token = null
async function api(url, data, method) {
  const r = await fetch(BASE + url, {
    method: method || (data ? 'POST' : 'GET'),
    headers: { 'Content-Type': 'application/json', ...(token ? { 'X-Authorization': `Bearer ${token}` } : {}) },
    body: data ? JSON.stringify(data) : undefined,
  })
  if (!r.ok) throw new Error(`${url.split('?')[0]} → HTTP ${r.status}`)
  const t = await r.text()
  return t ? JSON.parse(t) : null
}

const SITE = 'conflict-demo'
const A = 'Test Device A1'
const B = 'Test Device A2'
const CALC = `${SITE}_CALC`
const SUM = `${SITE}_SUM`
const ROLLUP = `Site Rollups · ${SITE}`
const AVG_OUTPUT = 'calc_temperatureAvg15m' // A1 上 15 分钟均值的输出测点名

/** 与向导第 1~3 步产出的配置同形:向导载入这个站点后「向导当前」与这里发布的一致,冲突只来自 TB 上的改动 */
const configOf = types => ({
  schema: 'tbsite/v2',
  site: { name: SITE },
  outputPrefix: 'calc_',
  devices: [A, B].map(name => ({
    name,
    type: types[name] || 'default',
    profile: types[name] || 'default',
    keys: [{ key: 'temperature', label: 'temperature', unit: '' }],
  })),
  deviceTemplates: [],
  computations: [
    // ① 两台温度差的绝对值,存结果资产 conflict-demo_CALC(自定义四则 + 对整个结果取绝对值)
    {
      template: 'expr.custom',
      asset: CALC,
      output: 'dT',
      outputMode: 'ts',
      terms: [
        { kind: 'key', device: A, key: 'temperature' },
        { kind: 'key', device: B, key: 'temperature' },
      ],
      ops: ['-'],
      absAll: true,
    },
    // ② 两台温度之和,跨设备汇聚,存 conflict-demo_SUM
    {
      template: 'aggregate.crossEntity',
      name: '两台温度之和',
      selector: { profiles: [], prefixes: ['Test Device A'] },
      key: 'temperature',
      agg: 'sum',
      asset: SUM,
      output: 'tempSum',
    },
    // ③ A1 温度 15 分钟均值 → 规则链 Site Rollups · conflict-demo(定时 900 秒)
    { template: 'window.aggregate', device: A, keys: ['temperature'], aggs: ['avg'], window: '15m' },
  ],
  rollup: { chainName: ROLLUP },
  alarm: { propagate: true },
})

async function context() {
  const { devIds } = await resolveDeviceIds(api, [A, B])
  if (Object.keys(devIds).length !== 2) throw new Error(`镜像上找不到 ${A} / ${B}`)
  const types = {}
  for (const [name, id] of Object.entries(devIds)) types[name] = (await api(`/api/device/${id}`))?.type
  return { devIds, cfg: configOf(types) }
}

async function teardown({ devIds, cfg }) {
  await cleanup(cfg, devIds, api, () => {}).catch(e => console.log('  清理时出错(继续):', e.message))
  await api(
    `/api/plugins/telemetry/DEVICE/${devIds[A]}/timeseries/delete?keys=${AVG_OUTPUT}&deleteAllDataForKeys=true`,
    null,
    'DELETE'
  ).catch(() => {})
}

async function cfOn(assetName, match) {
  const a = await findAsset(api, assetName)
  if (!a) throw new Error(`资产 ${assetName} 不存在`)
  const cf = (await listCfs(api, 'ASSET', a.id.id)).find(c => match(c.name))
  if (!cf) throw new Error(`资产 ${assetName} 上没找到计算字段`)
  return cf
}

async function setup(ctx) {
  console.log('① 先清掉上一轮留下的示例对象')
  await teardown(ctx)

  console.log('② 以「部署工具」身份发布示例站点(写入时记下指纹)')
  const failures = await publish(ctx.cfg, ctx.devIds, api, () => {}, {
    publishedBy: 'conflict-demo',
    checkHealth: false,
  })
  if (failures.length) throw new Error('发布失败:' + failures.map(f => f.error).join(';'))

  console.log('③ 模拟同事在 TB 里手工改了 3 处(带版本号写回,和在 TB 界面里保存一样)')
  const dT = await cfOn(CALC, n => n === 'calc_dT')
  const before1 = dT.configuration.expression
  dT.configuration.expression = before1.replace(/^abs\((.*)\)$/, '$1')
  await api('/api/calculatedField', dT)
  console.log(`   · ${CALC} / calc_dT:${before1}  →  ${dT.configuration.expression}(去掉了 abs)`)

  const sum = await cfOn(SUM, n => n.includes('tempSum'))
  const before2 = sum.configuration.expression
  sum.configuration.expression = `(${before2}) * 2`
  await api('/api/calculatedField', sum)
  console.log(`   · ${SUM} / ${sum.name}:${before2}  →  ${sum.configuration.expression}`)

  const chains = (await api('/api/ruleChains?pageSize=100&page=0')).data
  const ch = chains.find(c => c.name === ROLLUP)
  const meta = await api(`/api/ruleChain/${ch.id.id}/metadata`)
  const gen = meta.nodes.find(n => n.type.endsWith('TbMsgGeneratorNode'))
  const before3 = gen.configuration.periodInSeconds
  gen.configuration.periodInSeconds = before3 * 2
  await api('/api/ruleChain/metadata', meta)
  console.log(`   · 规则链 ${ROLLUP} / 节点「${gen.name}」:定时周期 ${before3} 秒 → ${before3 * 2} 秒`)

  console.log(`
好了。在向导里这样验证:
  第 1 步  目标环境选镜像 → 登录 → 站点标识填 ${SITE} → 连接(会自动载入这个站点,A1 / A2 已认领)
  第 3 步  等「平台上已有的配置」同步完,「⚠ 冲突」一组里应有 3 条,都可以「查看差异」:
    1) ${CALC} · calc_dT       表达式:本工具 abs((v0) - v1) / 平台 (v0) - v1
       「以 TB 为准」→ 向导里这条运算的「对整个结果取绝对值」被取消(改成 TB 的写法,点别的选项可撤回)
    2) ${SUM} · ${sum.name}   表达式被乘了 2
       「以 TB 为准」→ 向导表达不了,进「以 TB 为准、发布时不覆盖」一组
    3) 规则链 ${ROLLUP}        节点「${gen.name}」· periodInSeconds:本工具 ${before3} / 平台 ${before3 * 2}
       「以 TB 为准」→ 同 2)
  第 5 步  发布确认框会列出各类几处。发布后回第 3 步:以本工具为准的回到一致,待定 / 保留 TB 版本的仍列为冲突。
  (可选)在向导里再改一条别的运算,第 3 步会出现在「待发布的修改」里,和冲突区分开。
  想重来:再跑一次 setup;用完:node scripts/tb-conflict-demo.mjs teardown`)
}

/** 按平台上发布的站点配置(向导第 1 步载入的就是它)跑第 3 步同步,打印本站点对象的状态与差异 */
async function check({ devIds }) {
  const site = await findAsset(api, SITE)
  if (!site) throw new Error(`站点 ${SITE} 不存在,先跑 setup`)
  const attrs = await api(`/api/plugins/telemetry/ASSET/${site.id.id}/values/attributes/SERVER_SCOPE?keys=siteConfig`)
  const raw = attrs.find(a => a.key === 'siteConfig')?.value
  const cfg = typeof raw === 'string' ? JSON.parse(raw) : raw
  const st = await readPlatformState(api, cfg, devIds)
  const label = {
    same: '一致',
    conflict: '冲突',
    pending: '待发布',
    mismatch: '不一致(旧对象)',
    orphan: '声明里已没有',
  }
  const rows = [
    ...st.cfs
      .filter(r => r.owner === 'mine')
      .map(r => ({ what: `${r.entity} · ${r.cf.name}`, drift: r.drift, diff: r.diff })),
    ...st.chains.filter(c => c.mine).map(c => ({ what: `规则链 ${c.name}`, drift: c.drift, diff: c.diff })),
  ]
  console.log(`按平台上发布的 ${SITE} 配置同步(与向导载入这个站点后看到的一致):`)
  for (const r of rows) {
    console.log(`  [${label[r.drift] ?? r.drift}] ${r.what}`)
    for (const d of r.diff ?? [])
      console.log(`      ${d.item}:本工具 ${JSON.stringify(d.tool)} / 平台 ${JSON.stringify(d.platform)}`)
  }
  if (cfg.keepPlatform?.length) console.log(`  以 TB 为准、发布时不覆盖:${cfg.keepPlatform.join('、')}`)
}

const cmd = process.argv[2]
if (!['setup', 'check', 'teardown'].includes(cmd)) {
  console.log('用法:node scripts/tb-conflict-demo.mjs setup | check | teardown')
  process.exit(1)
}
token = (await api('/api/auth/login', { username: process.env.TB_USER, password: process.env.TB_PASSWORD })).token
try {
  const ctx = await context()
  if (cmd === 'setup') await setup(ctx)
  else if (cmd === 'check') await check(ctx)
  else {
    await teardown(ctx)
    console.log(`已清掉示例站点 ${SITE} 的全部对象`)
  }
} finally {
  await api('/api/auth/logout', {}, 'POST').catch(() => {})
  token = null
}
