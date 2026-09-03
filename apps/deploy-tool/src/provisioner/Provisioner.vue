<script setup>
import { computed, reactive, ref, watch } from 'vue'
import { TEMPLATES, CATEGORIES, WINDOWS, AGG_OPTIONS, ALARM_OPS, ALARM_SEVERITIES, ALARM_TRIGGERS, PRESETS } from './templates.js'
import { LAYOUT_TEMPLATES, STAT_SLOT_CARDS, GRID_SLOT_CARDS } from '../shared/layoutTemplates.js'
import { publish, cleanup } from './publisher.js'
import { kzStations } from '../api/tb.js'
import KeyPicker from '../components/KeyPicker.vue'

const STEPS = ['连接与站点', '设备与测点', '运算配置', '展示配置', '发布上线']
const step = ref(0)

/* 开屏加载页:固定 1.6s 品牌闪屏后淡出(纯观感,不阻塞任何逻辑) */
const booting = ref(true)
setTimeout(() => { booting.value = false }, 1600)

/* ── 通用确认弹窗(替代原生 confirm,主题样式,Promise 化)──
   确认按钮点击后立即 resolve,后续 window.open 仍在 transient
   user activation 窗口内(Chrome ~5s),不会被弹窗拦截。 */
const confirmBox = reactive({ open: false, title: '', text: '', okLabel: '确认', danger: false,
                              input: false, value: '', placeholder: '' })
let confirmResolve = null
function askConfirm({ title = '请确认', text = '', okLabel = '确认', danger = false } = {}) {
  Object.assign(confirmBox, { title, text, okLabel, danger, input: false, value: '', placeholder: '', open: true })
  return new Promise((res) => { confirmResolve = res })
}
/* 带输入框的确认:确定 → resolve 输入的字符串;取消 → resolve null */
function askPrompt({ title = '请输入', text = '', placeholder = '', value = '', okLabel = '确定' } = {}) {
  Object.assign(confirmBox, { title, text, okLabel, danger: false, input: true, value, placeholder, open: true })
  return new Promise((res) => { confirmResolve = res })
}
function confirmAnswer(v) {
  confirmBox.open = false
  const res = confirmResolve
  confirmResolve = null
  if (confirmBox.input) res?.(v ? confirmBox.value : null)
  else res?.(v)
}

/* ── connection & discovery ─────────────────────────────── */
/* 两个内置环境都指向生产镜像 TB(192.168.20.61),区别只是代理前缀:
   mirror 走 /tbm(默认,大屏链接带 ?env=mirror 时可用 kz 报表)、demo 走 /api。
   演示环境 20.60 已退役,密码不再内置——两个环境都需手工输入。 */
const ENVS = {
  demo:   { label: '生产镜像 · 192.168.20.61(/api 直连)', base: '', defUser: 'tenant@thingsboard.org', defPass: '' },
  mirror: { label: '生产镜像 · 192.168.20.61', base: '/tbm', defUser: 'tenant@thingsboard.org', defPass: '' },
}

/* ── 自定义项目环境:工程人员手动录入新项目的 TB 地址,存本机 ──
   内置环境走 vite 代理;自定义环境直连 http://IP:端口(需 TB 允许跨域,
   内网 TB CE 默认放行 /api)。 */
const LS_ENVS = 'gridops_custom_envs'
const customEnvs = ref([])
try { customEnvs.value = JSON.parse(localStorage.getItem(LS_ENVS)) || [] } catch { /* 忽略损坏数据 */ }
const allEnvs = computed(() => {
  const m = { ...ENVS }
  for (const e of customEnvs.value)
    m[e.id] = { label: e.label, base: e.base, defUser: 'tenant@thingsboard.org', defPass: '', custom: true }
  return m
})
const curEnv = computed(() => allEnvs.value[conn.env] || ENVS.mirror)
function persistEnvs() {
  try { localStorage.setItem(LS_ENVS, JSON.stringify(customEnvs.value)) } catch { /* 存储不可用时静默 */ }
}
const envModal = reactive({ open: false, editId: null, name: '', addr: '', msg: '' })
function openEnvModal(editId = null) {
  envModal.editId = editId
  const e = editId ? customEnvs.value.find((x) => x.id === editId) : null
  envModal.name = e?.label || ''
  envModal.addr = e?.base || ''
  envModal.msg = ''
  envModal.open = true
}
function saveEnvModal() {
  const name = envModal.name.trim()
  let addr = envModal.addr.trim().replace(/\/+$/, '')
  if (!name) { envModal.msg = '请给项目起个名字'; return }
  if (!addr) { envModal.msg = '请填写 TB 地址,如 http://192.168.1.100:8080'; return }
  if (!/^https?:\/\//i.test(addr)) addr = 'http://' + addr
  if (envModal.editId) {
    const e = customEnvs.value.find((x) => x.id === envModal.editId)
    if (e) { e.label = name; e.base = addr }
  } else {
    const id = 'c' + Date.now().toString(36)
    customEnvs.value.push({ id, label: name, base: addr })
    conn.env = id
  }
  persistEnvs()
  envModal.open = false
  switchEnv()
}
async function removeCustomEnv() {
  const e = customEnvs.value.find((x) => x.id === conn.env)
  if (!e) return
  if (!(await askConfirm({
    title: '删除项目',
    text: `删除项目「${e.label}」(${e.base})?本机为它保存的登录与草稿会一并清除。`,
    okLabel: '删除',
    danger: true,
  }))) return
  try {
    localStorage.removeItem(`gridops_login_${e.id}`)
    localStorage.removeItem(`gridops_drafts_${e.id}`)
    localStorage.removeItem(`gridops_draft_${e.id}`)
  } catch { /* 忽略 */ }
  customEnvs.value = customEnvs.value.filter((x) => x.id !== e.id)
  persistEnvs()
  conn.env = 'mirror'
  switchEnv()
}
const conn = reactive({
  env: 'mirror',
  username: ENVS.mirror.defUser,
  password: '',
  status: 'idle', // idle | busy | ok | err
  error: '',
  token: null,
  progress: '',
})
/* 记住登录(30 天):按环境存 localStorage(base64 混淆;内网工具场景) */
const rememberLogin = ref(false)
const LS_LOGIN = () => `gridops_login_${conn.env}`
function loadSavedLogin() {
  rememberLogin.value = false
  try {
    const raw = localStorage.getItem(LS_LOGIN())
    if (!raw) return
    const s = JSON.parse(decodeURIComponent(escape(atob(raw))))
    if (Date.now() - s.ts > 30 * 86400000) { localStorage.removeItem(LS_LOGIN()); return }
    conn.username = s.u
    conn.password = s.p
    rememberLogin.value = true
  } catch { /* 存储损坏时按未保存处理 */ }
}
function persistLogin() {
  try {
    if (rememberLogin.value)
      localStorage.setItem(LS_LOGIN(), btoa(unescape(encodeURIComponent(
        JSON.stringify({ u: conn.username, p: conn.password, ts: Date.now() })))))
    else localStorage.removeItem(LS_LOGIN())
  } catch { /* 隐私模式等存储不可用时静默 */ }
}
loadSavedLogin() // 启动时恢复本环境已保存的登录

function switchEnv() {
  conn.username = curEnv.value.defUser
  conn.password = curEnv.value.defPass
  conn.status = 'idle'
  conn.token = null
  devices.value = []
  sites.value = []
  restoreMsg.value = ''
  loadSavedLogin()
}
const site = reactive({ name: 'demo-site', label: 'GRID·OPS 演示站' })
const pubCustomerId = ref('') // 自定义项目的 Public 客户 id(连接时获取,传给大屏)
const devices = ref([]) // { name, tbId, open, claimed, keys: [{key,label,unit,claimed,latest,cn}] }
const keyDict = ref({}) // 测点中文字典 key → {name, unit, type}(来自生产平台的测量点定义)
const reportStations = ref([]) // kzserver 站点清单(自然日报表数据源;仅生产镜像)

// 设备类型的中文说明(现场常见类型;未知类型不显示)
const PROFILE_CN = {
  IED: '保护测控装置', METER: '计量仪表', ATS: '双电源切换开关', gateway: '通信网关',
  default: '通用设备', thermostat: '温控器', '公司开发的充电桩': '充电桩',
  '同步遥测类': '同步遥测', '计算类': '计算设备', 'OTA升级类': 'OTA 升级',
  JIZHAN_P1_DEVICELIST: '基站设备清单',
}
const profileCn = (p) => PROFILE_CN[p] || ''
// 派生测点(PAvg5m / totalP / revenue5mCostDaily 等)的中文合成
const AGG_CN2 = { Avg: '均值', Min: '最小', Max: '最大', Sum: '求和' }
const WIN_CN = { '5m': '5分钟', '15m': '15分钟', '1h': '1小时', '1d': '1天' }
function smartCn(key) {
  if (!key) return ''
  const direct = keyDict.value[key]?.name
  if (direct) return direct
  let m = key.match(/^(.*?)(Avg|Min|Max|Sum)(5m|15m|1h|1d)$/)
  if (m) return `${keyDict.value[m[1]]?.name || m[1]} · ${AGG_CN2[m[2]]}(${WIN_CN[m[3]]})`
  m = key.match(/^(.*?)(Used|Energy)(5m|15m|1h|1d)$/)
  if (m) return `${keyDict.value[m[1]]?.name || m[1]} · ${m[2] === 'Used' ? '区间用量' : '积分电量'}(${WIN_CN[m[3]]})`
  m = key.match(/^(.*?)(IncomeDaily|CostDaily|Income|Cost|Daily)$/)
  if (m) {
    const sfx = { IncomeDaily: '放电收入·当日累计', CostDaily: '充电成本·当日累计',
                  Income: '放电收入', Cost: '充电成本', Daily: '净收益·当日累计' }[m[2]]
    return `收益 · ${sfx}`
  }
  if (key.startsWith('total')) {
    const base = keyDict.value[key.slice(5)]?.name
    if (base) return `全站合计 · ${base}`
  }
  return ''
}
// 测点键名 → 「键名(中文)」,用于各处描述文本
const kd = (key) => {
  const cn = smartCn(key)
  return cn ? `${key}(${cn})` : key
}
const sites = ref([]) // 已发布的站点资产 [{name, id}]
const selectedSite = ref('')
const restoreMsg = ref('')

/* ── 命名草稿:第 2/3/4 步「保存并进入下一步」——配置存 localStorage,
   每个草稿有名字,可存多份(上限 10),同名保存即覆盖 ── */
const LS_DRAFTS = () => `gridops_drafts_${conn.env}`
const draftMsg = ref('')
const draftList = ref([]) // [{ id, name, ts, cfg }]
const lastDraftName = ref('') // 本次会话上一次用的草稿名,续存时默认沿用
let draftMsgTimer = null
function readDrafts() {
  try { return (JSON.parse(localStorage.getItem(LS_DRAFTS())) || []).filter((d) => d?.cfg?.site) }
  catch { return [] }
}
function writeDrafts(list) {
  try { localStorage.setItem(LS_DRAFTS(), JSON.stringify(list.slice(0, 10))) }
  catch (e) { draftMsg.value = `保存失败:${e.message}` }
}
async function saveDraft(advance = false) {
  const def = lastDraftName.value || `${site.label || site.name} 草稿`
  const name = await askPrompt({
    title: '保存草稿',
    text: `给这份草稿起个名字${advance ? ',保存后进入下一步' : ''}。同名草稿会被覆盖;只保存在本浏览器,不写入平台。`,
    placeholder: '草稿名称,如:仙人山二期 调试中',
    value: def,
    okLabel: advance ? '保存并继续' : '保存',
  })
  if (name === null) return
  const nm = name.trim() || def
  lastDraftName.value = nm
  const list = readDrafts()
  const entry = { id: Date.now().toString(36), name: nm, ts: Date.now(), cfg: siteJson.value }
  const i = list.findIndex((d) => d.name === nm)
  if (i >= 0) list.splice(i, 1, entry)
  else list.unshift(entry)
  writeDrafts(list)
  draftList.value = readDrafts()
  draftMsg.value = `✓ 已保存「${nm}」(${new Date().toLocaleTimeString('zh-CN', { hour12: false })})`
  clearTimeout(draftMsgTimer)
  draftMsgTimer = setTimeout(() => (draftMsg.value = ''), 4000)
  if (advance && step.value < 4) step.value++
}
function checkDraft() {
  // 旧版单草稿迁移为命名草稿
  try {
    const legacy = localStorage.getItem(`gridops_draft_${conn.env}`)
    if (legacy) {
      const d = JSON.parse(legacy)
      if (d?.cfg?.site) {
        const list = readDrafts()
        list.unshift({ id: 'legacy' + d.ts, name: '未命名草稿', ts: d.ts, cfg: d.cfg })
        writeDrafts(list)
      }
      localStorage.removeItem(`gridops_draft_${conn.env}`)
    }
  } catch { /* 旧草稿损坏时丢弃 */ }
  draftList.value = readDrafts()
}
async function loadDraftAt(i) {
  const d = draftList.value[i]
  if (!d) return
  if (!(await askConfirm({
    title: '载入草稿',
    text: `用草稿「${d.name}」(保存于 ${new Date(d.ts).toLocaleString('zh-CN')})覆盖当前向导内容?线上已发布版本不受影响。`,
    okLabel: '载入',
  }))) return
  hydrate(JSON.parse(JSON.stringify(d.cfg)))
  lastDraftName.value = d.name
  restoreMsg.value = `已载入草稿「${d.name}」(保存于 ${new Date(d.ts).toLocaleString('zh-CN')})`
  step.value = 1 // 载入后直接进入「设备与测点」
}
async function dropDraftAt(i) {
  const d = draftList.value[i]
  if (!d) return
  if (!(await askConfirm({
    title: '删除草稿',
    text: `删除草稿「${d.name}」?此操作不可恢复(线上已发布版本不受影响)。`,
    okLabel: '删除',
    danger: true,
  }))) return
  const list = readDrafts().filter((x) => x.id !== d.id)
  writeDrafts(list)
  draftList.value = readDrafts()
}

/* ── 权限分级(工具层软约束)──────────────────────────────
   角色存于 gridops-config 资产的 gridopsRoles 服务端属性:{ email: {role:'field'|'admin', sites:[...]} }
   未登记的账号默认 admin(向下兼容)。field 账号:只能发布/载入允许的站点、不能清理生成物。
   注:TB CE 无法细分租户写权限,这是工具层约束——真实生产的硬隔离靠操作规程 + 独立账号。*/
const perm = reactive({ role: 'admin', sites: [], cfgAssetId: null, roles: {}, email: '' })
const permEdit = ref([])   // 权限管理面板编辑区 [{email, role, sites(逗号分隔文本)}]
const permMsg = ref('')
const canPublishSite = computed(() =>
  perm.role !== 'field' || perm.sites.includes(site.name))
function permAddRow() { permEdit.value.push({ email: '', role: 'field', sites: '' }) }
async function permDelRow(i) {
  const r = permEdit.value[i]
  if (r?.email?.trim() && !(await askConfirm({
    title: '删除授权账号',
    text: `从权限列表移除「${r.email.trim()}」?点「保存权限配置」后生效。`,
    okLabel: '删除',
    danger: true,
  }))) return
  permEdit.value.splice(i, 1)
}
function permHydrate() {
  permEdit.value = Object.entries(perm.roles).map(([email, r]) =>
    ({ email, role: r.role || 'field', sites: (r.sites || []).join(', ') }))
}
async function savePerms() {
  if (!(await askConfirm({
    title: '保存权限配置',
    text: '权限配置将写入平台(gridops-config 资产),对所有打开本工具的账号生效。确认保存?',
    okLabel: '保存',
  }))) return
  permMsg.value = ''
  try {
    const roles = {}
    for (const r of permEdit.value) {
      const email = r.email.trim()
      if (!email) continue
      roles[email] = { role: r.role, sites: r.sites.split(/[,،,\s]+/).filter(Boolean) }
    }
    if (!perm.cfgAssetId) {
      const a = await api('/api/asset', { name: 'gridops-config', type: 'tbsite-config' })
      perm.cfgAssetId = a.id.id
    }
    await api(`/api/plugins/telemetry/ASSET/${perm.cfgAssetId}/attributes/SERVER_SCOPE`, { gridopsRoles: roles })
    perm.roles = roles
    permMsg.value = `已保存 ${Object.keys(roles).length} 个账号的权限配置`
  } catch (e) { permMsg.value = `保存失败:${e.message}` }
}

async function api(url, data, method) {
  const r = await fetch(curEnv.value.base + url, {
    method: method || (data ? 'POST' : 'GET'),
    headers: {
      'Content-Type': 'application/json',
      ...(conn.token ? { 'X-Authorization': `Bearer ${conn.token}` } : {}),
    },
    body: data ? JSON.stringify(data) : undefined,
  })
  if (!r.ok) throw new Error(`${url} → HTTP ${r.status}`)
  const text = await r.text()
  return text ? JSON.parse(text) : null
}

async function connect() {
  conn.status = 'busy'
  conn.error = ''
  try {
    conn.token = (await api('/api/auth/login', { username: conn.username, password: conn.password })).token
    persistLogin()
    // 自定义项目:取 Public 客户 id,发布后打开大屏时通过 URL 传给 site.html
    pubCustomerId.value = ''
    if (curEnv.value.custom) {
      try {
        // 注:/api/customers 带 textSearch 在部分 TB 版本会 500,故直接翻页匹配
        const cs = (await api('/api/customers?pageSize=100&page=0')).data
        pubCustomerId.value = cs.find((c) => c.additionalInfo?.isPublic || c.title === 'Public')?.id.id || ''
      } catch { /* 无 Public 客户时大屏链接不带 pub,届时手动处理 */ }
    }
    // 分页拉取全部设备(生产库 200+ 台,不能只取一页)
    const all = []
    for (let p = 0, hasNext = true; hasNext; p++) {
      const page = await api(`/api/tenant/devices?pageSize=100&page=${p}`)
      all.push(...page.data)
      hasNext = page.hasNext
    }
    // 网关识别:profile 为 gateway,或 additionalInfo.gateway 标记
    const gwById = {}
    for (const d of all)
      if (d.type === 'gateway' || d.additionalInfo?.gateway) gwById[d.id.id] = d.name
    // 并发探测测点(分批,避免打爆浏览器/TB)
    const found = []
    for (let i = 0; i < all.length; i += 12) {
      conn.progress = `探测测点 ${Math.min(i + 12, all.length)}/${all.length}`
      const batch = await Promise.all(all.slice(i, i + 12).map(async (d) => {
        const keys = await api(`/api/plugins/telemetry/DEVICE/${d.id.id}/keys/timeseries`).catch(() => [])
        // 最新值分批获取——中文键名多的设备(如 PCS 250+ 测点)一次拼 URL 会超长导致 400
        const latest = {}
        for (let j = 0; j < keys.length; j += 60) {
          const part = keys.slice(j, j + 60).map(encodeURIComponent).join(',')
          Object.assign(latest, await api(`/api/plugins/telemetry/DEVICE/${d.id.id}/values/timeseries?keys=${part}`).catch(() => ({})))
        }
        return {
          name: d.name,
          tbId: d.id.id,
          profile: d.type || 'default',
          desc: d.additionalInfo?.description || '',
          gwId: d.additionalInfo?.lastConnectedGateway || null,
          isGateway: !!gwById[d.id.id],
          open: false,
          claimed: false,
          keys: keys.map((k) => ({
            key: k, label: '', unit: '', claimed: false,
            latest: latest[k] ? latest[k][0].value : '—',
          })),
        }
      }))
      found.push(...batch)
    }
    conn.progress = ''
    for (const d of found) d.gwName = d.gwId ? gwById[d.gwId] || null : null
    devices.value = found
    reportStations.value = []
    if (conn.env === 'mirror') {
      try { reportStations.value = await kzStations(conn.token) } catch { /* kz 不可用时报表源为空 */ }
    }
    conn.status = 'ok'
    // 发现已发布的站点,自动载入上次配置
    const assets = (await api('/api/tenant/assets?pageSize=100&page=0')).data
    // 权限分级:读取当前账号与角色配置
    try {
      perm.email = (await api('/api/auth/user')).email
      const cfgAsset = assets.find((a) => a.name === 'gridops-config' && a.type === 'tbsite-config')
      perm.cfgAssetId = cfgAsset?.id.id || null
      perm.roles = {}
      if (cfgAsset) {
        const attrs = await api(`/api/plugins/telemetry/ASSET/${cfgAsset.id.id}/values/attributes/SERVER_SCOPE?keys=gridopsRoles`)
        const raw = attrs.find((a) => a.key === 'gridopsRoles')?.value
        perm.roles = (typeof raw === 'string' ? JSON.parse(raw) : raw) || {}
      }
      const mine = perm.roles[perm.email]
      perm.role = mine?.role === 'field' ? 'field' : 'admin'
      perm.sites = mine?.sites || []
      permHydrate()
    } catch { perm.role = 'admin' /* 权限配置不可读时不锁死管理员 */ }
    // 测点中文字典:生产平台把 key→{name,unit,type} 存在「单位名称匹配表」资产的服务端属性上
    keyDict.value = {}
    const dictAsset = assets.find((a) => a.type === '单位名称匹配表' || a.name === '遥测单位名称匹配接口')
    if (dictAsset) {
      try {
        const attrs = await api(`/api/plugins/telemetry/ASSET/${dictAsset.id.id}/values/attributes/SERVER_SCOPE`)
        const dict = {}
        for (const a of attrs) {
          const v = typeof a.value === 'string' ? JSON.parse(a.value) : a.value
          if (v && v.name) dict[a.key] = { name: v.name, unit: v.unit || '', type: v.type || '' }
        }
        keyDict.value = dict
        // 自动补全业务名称/单位(仅填空,不覆盖人工修改)
        for (const d of devices.value)
          for (const k of d.keys) {
            const e = dict[k.key]
            if (e) { k.cn = e.name; if (!k.label) k.label = e.name; if (!k.unit) k.unit = e.unit }
          }
      } catch { /* 字典资产不可读时静默降级 */ }
    }
    sites.value = assets.filter((a) => a.type === 'tbsite').map((a) => ({ name: a.name, id: a.id.id }))
    if (perm.role === 'field') {
      // 现场账号:只看得到/载得动允许的站点,站点标识锁定到授权范围
      sites.value = sites.value.filter((s) => perm.sites.includes(s.name))
      if (!perm.sites.includes(site.name)) site.name = perm.sites[0] || ''
    }
    if (sites.value.length) {
      selectedSite.value = sites.value.find((s) => s.name === site.name)?.name || sites.value[0].name
      await loadSite(selectedSite.value)
    }
    checkDraft()
  } catch (e) {
    conn.status = 'err'
    conn.error = String(e.message || e)
  }
}

async function loadSite(name, advance = false) {
  restoreMsg.value = ''
  const s = sites.value.find((x) => x.name === name)
  if (!s) return
  try {
    const attrs = await api(`/api/plugins/telemetry/ASSET/${s.id}/values/attributes/SERVER_SCOPE?keys=siteConfig`)
    const sc = attrs.find((a) => a.key === 'siteConfig')
    if (!sc) { restoreMsg.value = `站点 ${name} 没有已发布的配置`; return }
    hydrate(sc.value)
    restoreMsg.value = `已载入站点「${name}」上次发布的配置(${sc.value.devices?.length || 0} 设备 · ${sc.value.computations?.length || 0} 运算)`
    if (advance) step.value = 1 // 手动载入后直接进入「设备与测点」
  } catch (e) {
    restoreMsg.value = `载入失败:${e.message}`
  }
}

function hydrate(cfg) {
  site.name = cfg.site?.name || site.name
  site.label = cfg.site?.label || site.label
  rollupChainName.value = cfg.rollup?.chainName || rollupChainName.value
  // 回填认领状态与业务名/单位
  const byName = Object.fromEntries((cfg.devices || []).map((d) => [d.name, d]))
  for (const d of devices.value) {
    const saved = byName[d.name]
    if (!saved) { d.claimed = false; d.keys.forEach((k) => (k.claimed = false)); continue }
    const savedKeys = Object.fromEntries(saved.keys.map((k) => [k.key, k]))
    for (const k of d.keys) {
      const sk = savedKeys[k.key]
      k.claimed = !!sk
      if (sk) { k.label = sk.label !== k.key ? sk.label : k.label; k.unit = sk.unit || k.unit }
    }
    d.claimed = d.keys.every((k) => k.claimed)
  }
  // 回填运算与组态布局
  computations.value = (cfg.computations || []).map((c) => JSON.parse(JSON.stringify(c)))
  deviceTemplates.value = (cfg.deviceTemplates || []).map((t) => JSON.parse(JSON.stringify(t)))
  if (cfg.layout?.pages?.length) {
    pages.value = cfg.layout.pages
      .filter((p) => LAYOUT_TEMPLATES[p.template])
      .map((p) => ({ id: p.id, title: p.title || '页面', template: p.template,
                     slots: JSON.parse(JSON.stringify(p.slots || {})) }))
    if (!pages.value.length) pages.value = [{ id: 'p1', title: '总览', template: 'console', slots: {} }]
  } else if (cfg.layout?.template && LAYOUT_TEMPLATES[cfg.layout.template]) {
    // 旧版单页配置 → 包装成一个页面
    pages.value = [{ id: 'p1', title: '总览', template: cfg.layout.template,
                     slots: JSON.parse(JSON.stringify(cfg.layout.slots || {})) }]
  } else {
    pages.value = [{ id: 'p1', title: '总览', template: 'console', slots: {} }]
  }
  activePage.value = 0
  Object.assign(header, { title: '', subtitle: '', showClock: true, showDate: false },
                cfg.layout?.header || {})
}

function claimDevice(d, v) {
  d.claimed = v
  d.keys.forEach((k) => (k.claimed = v))
}

// 批量认领当前筛选出的全部有数据设备(整机全测点)
async function claimFiltered(v) {
  const hits = devices.value.filter((d) => !d.isGateway && d.keys.length && matchDev(d))
  const fresh = v ? hits.filter((d) => d.keys.some((k) => !k.claimed)) : hits
  if (v && fresh.length > 20 && !(await askConfirm({
    title: '批量认领',
    text: `将认领 ${fresh.length} 台设备的全部测点,继续?`,
    okLabel: '认领',
  }))) return
  for (const d of hits) claimDevice(d, v)
}

const claimedDevices = computed(() => devices.value.filter((d) => d.keys.some((k) => k.claimed)))

/* ── 分组与过滤(生产库百级设备) ───────────────────────── */
const devFilter = reactive({ q: '', profile: '' })
const emptyOpen = reactive({}) // 组名 → 是否展开“无数据设备”
const profileList = computed(() =>
  [...new Set(devices.value.map((d) => d.profile))].sort())
const dataDeviceCount = computed(() => devices.value.filter((d) => d.keys.length).length)
const claimedKeyCount = computed(() =>
  claimedDevices.value.reduce((n, d) => n + d.keys.filter((k) => k.claimed).length, 0))
const groupClaimed = (g) => g.withData.filter((d) => d.keys.some((k) => k.claimed)).length
const gatewayCount = computed(() => devices.value.filter((d) => d.isGateway).length)
function matchDev(d) {
  if (devFilter.profile && d.profile !== devFilter.profile) return false
  const q = devFilter.q.trim().toLowerCase()
  if (!q) return true
  return d.name.toLowerCase().includes(q) || (d.desc && d.desc.toLowerCase().includes(q)) ||
    d.keys.some((k) => k.key.toLowerCase().includes(q))
}
const deviceGroups = computed(() => {
  const map = new Map()
  for (const d of devices.value) {
    if (d.isGateway || !matchDev(d)) continue
    const g = d.gwName ? `网关 · ${d.gwName}` : '直连 / 未挂网关'
    if (!map.has(g)) map.set(g, { name: g, withData: [], empty: [] })
    ;(d.keys.length ? map.get(g).withData : map.get(g).empty).push(d)
  }
  const arr = [...map.values()]
  for (const g of arr) {
    g.withData.sort((a, b) => a.name.localeCompare(b.name))
    g.empty.sort((a, b) => a.name.localeCompare(b.name))
  }
  arr.sort((a, b) => a.name.localeCompare(b.name))
  return arr
})
const claimedKeys = computed(() =>
  claimedDevices.value.flatMap((d) =>
    d.keys.filter((k) => k.claimed).map((k) =>
      ({ device: d.name, key: k.key, label: k.label || k.key, cn: k.cn || '' })),
  ),
)

/* ── computations ───────────────────────────────────────── */
const computations = ref([])

// 配置汇总(含设备模板内的条目),用于第 3 步顶部进度条
const compSummary = computed(() => {
  const s = { cf: 0, rollup: 0, alarm: 0, site: 0 }
  const bump = (tplId) => {
    const t = TEMPLATES[tplId]
    if (!t) return
    if (t.kind === 'alarm') s.alarm++
    else if (t.kind === 'agg' || t.kind === 'revenue') s.site++
    else if (t.kind === 'rollup') s.rollup++
    else s.cf++
  }
  computations.value.forEach((c) => bump(c.template))
  deviceTemplates.value.forEach((t) => t.items.forEach((i) => bump(i.template)))
  return s
})
const modal = reactive({ open: false, tplId: null, form: {}, editIndex: null, target: null })

/* 网关分组折叠:默认只展开有已认领设备的组;搜索时强制全展开 */
const gwOpen = reactive({})
const isGwOpen = (g) =>
  devFilter.q ? true : (g.name in gwOpen ? gwOpen[g.name] : groupClaimed(g) > 0 || deviceGroups.value.length === 1)
const toggleGw = (g) => { gwOpen[g.name] = !isGwOpen(g) }

/* 第 3 步 方式一/方式二 折叠(默认折叠,组头带摘要) */
const wayOpen = reactive({ w1: false, w2: false })

/* 第 3 步运算弹窗:测点选择器分组(KeyPicker 组件内置过滤与按设备折叠) */
const keyPickerGroups = computed(() =>
  claimedKeyGroups.value.map((g) => ({
    label: g.device,
    items: g.items.map((k) => ({ value: `${k.device}||${k.key}`, label: `${k.key}${k.cn ? ' · ' + k.cn : ''}` })),
  })))

/* ── 设备模板(tbsite/v2 批量配置)───────────────────────── */
const deviceTemplates = ref([]) // { name, selector: {profiles:[], prefixes:[]}, items: [] }
const tplMgr = reactive({ open: false, editIndex: null, name: '', profiles: [], prefixes: '' })
const TPL_ALLOWED = ['alarm.threshold', 'window.aggregate', 'window.cascade', 'window.delta', 'window.integrate', 'expr.add', 'expr.subtract']

const claimedProfiles = computed(() =>
  [...new Set(claimedDevices.value.map((d) => d.profile))].sort())

function tplMatched(t) {
  return claimedDevices.value.filter((d) => {
    const sel = t.selector || {}
    if (sel.profiles?.length && !sel.profiles.includes(d.profile)) return false
    if (sel.prefixes?.length && !sel.prefixes.some((p) => p && d.name.startsWith(p))) return false
    return true
  })
}

function openTplMgr(i) {
  tplMgr.editIndex = i ?? null
  if (i !== null && i !== undefined) {
    const t = deviceTemplates.value[i]
    tplMgr.name = t.name
    tplMgr.profiles = [...(t.selector.profiles || [])]
    tplMgr.prefixes = (t.selector.prefixes || []).join(', ')
  } else {
    tplMgr.name = ''
    tplMgr.profiles = []
    tplMgr.prefixes = ''
  }
  tplMgr.open = true
}

function saveTplMgr() {
  const sel = {
    profiles: [...tplMgr.profiles],
    prefixes: tplMgr.prefixes.split(/[,,\s]+/).map((s) => s.trim()).filter(Boolean),
  }
  if (!tplMgr.name.trim() || (!sel.profiles.length && !sel.prefixes.length)) return
  const t = { name: tplMgr.name.trim(), selector: sel,
              items: tplMgr.editIndex !== null ? deviceTemplates.value[tplMgr.editIndex].items : [] }
  if (tplMgr.editIndex !== null) deviceTemplates.value.splice(tplMgr.editIndex, 1, t)
  else deviceTemplates.value.push(t)
  tplMgr.open = false
}

async function removeTpl(i) {
  const t = deviceTemplates.value[i]
  if (!(await askConfirm({
    title: '删除设备模板',
    text: `删除设备模板「${t.name}」及其 ${t.items.length} 项运算?`,
    okLabel: '删除',
    danger: true,
  }))) return
  deviceTemplates.value.splice(i, 1)
}
async function removeTplItem(t, ii) {
  if (!(await askConfirm({
    title: '删除模板运算',
    text: `从模板「${t.name}」中删除该项运算?`,
    okLabel: '删除',
    danger: true,
  }))) return
  t.items.splice(ii, 1)
}
async function removeComp(i) {
  if (!(await askConfirm({
    title: '删除运算',
    text: '删除这项已配置的运算?第 4 步中引用它的槽位需要重新指定数据源。',
    okLabel: '删除',
    danger: true,
  }))) return
  computations.value.splice(i, 1)
}

/* ── 电价配置编辑器(24 时段)── */
const priceModal = reactive({ open: false, asset: '', prices: Array(24).fill(''), msg: '',
                              exists: false, fillFrom: 0, fillTo: 23, fillVal: '' })
async function openPriceEditor(assetName) {
  priceModal.asset = (assetName || '').trim()
  if (!priceModal.asset) { alert('请先填写电价配置资产名'); return }
  priceModal.msg = '读取中…'
  priceModal.prices = Array(24).fill('')
  priceModal.exists = false
  priceModal.open = true
  try {
    const page = await api(`/api/tenant/assets?pageSize=100&page=0&textSearch=${encodeURIComponent(priceModal.asset)}`)
    const asset = page.data.find((a) => a.name === priceModal.asset)
    if (asset) {
      priceModal.exists = true
      const attrs = await api(`/api/plugins/telemetry/ASSET/${asset.id.id}/values/attributes/SERVER_SCOPE?keys=electricityPrice`)
      const raw = attrs.find((a) => a.key === 'electricityPrice')?.value
      const cfg = typeof raw === 'string' ? JSON.parse(raw) : raw
      if (cfg?.prices?.length === 24) priceModal.prices = cfg.prices.map((p) => String(p))
      priceModal.msg = cfg?.prices?.length === 24 ? '' : '该资产还没有电价配置,填好后保存即可'
    } else {
      priceModal.msg = '资产不存在——保存时会自动创建'
    }
  } catch (e) { priceModal.msg = `读取失败:${e.message}` }
}
function fillPriceRange() {
  const val = priceModal.fillVal.trim()
  if (val === '' || isNaN(Number(val))) { priceModal.msg = '请先填一个数字电价'; return }
  const a = Math.max(0, Math.min(23, Number(priceModal.fillFrom)))
  const b = Math.max(0, Math.min(23, Number(priceModal.fillTo)))
  for (let h = Math.min(a, b); h <= Math.max(a, b); h++) priceModal.prices[h] = val
  priceModal.msg = ''
}
const pricesValid = computed(() =>
  priceModal.prices.every((p) => p !== '' && !isNaN(Number(p))))
async function savePrices() {
  if (!pricesValid.value) { priceModal.msg = '24 个时段都要填数字电价'; return }
  if (!(await askConfirm({
    title: '保存电价配置',
    text: `把 24 时段电价写入资产「${priceModal.asset}」${priceModal.exists ? '(覆盖现有配置)' : '(资产将自动创建)'}?`,
    okLabel: '保存',
  }))) return
  priceModal.msg = '保存中…'
  try {
    const page = await api(`/api/tenant/assets?pageSize=100&page=0&textSearch=${encodeURIComponent(priceModal.asset)}`)
    let asset = page.data.find((a) => a.name === priceModal.asset)
    if (!asset) {
      asset = await api('/api/asset', { name: priceModal.asset, type: 'price-config' })
      await api(`/api/customer/public/asset/${asset.id.id}`, {})
    }
    await api(`/api/plugins/telemetry/ASSET/${asset.id.id}/attributes/SERVER_SCOPE`,
              { electricityPrice: { prices: priceModal.prices.map(Number) } })
    priceModal.msg = '已保存 ✓ 下个统计周期生效'
    priceModal.exists = true
  } catch (e) { priceModal.msg = `保存失败:${e.message}` }
}

/* ── 常用方案一键添加 ── */
function applyPreset(p) {
  const t = { name: p.tplName, selector: JSON.parse(JSON.stringify(p.selector)),
              items: JSON.parse(JSON.stringify(p.items)) }
  deviceTemplates.value.push(t)
  const matched = tplMatched(t)
  presetMsg.value = matched.length
    ? `已添加「${p.name}」,匹配 ${matched.length} 台设备;可在下方卡片里微调阈值`
    : `已添加「${p.name}」,但当前没有匹配的已认领设备——请先在第 2 步认领 IED 类设备,或编辑选择器`
}
const presetMsg = ref('')

/* ── 智能自动填写:选完测点后自动生成名称/文案/输出名(可改)── */
const OP_CN = { gt: '越上限', lt: '越下限', gte: '越上限', lte: '越下限', eq: '状态', ne: '异常' }
let autoFill = { alarmName: '', message: '', output: '', asset: '' }
function keyBase(encoded) {
  return (encoded || '').includes('||') ? encoded.split('||')[1] : encoded
}
function suggestAlarm() {
  if (modalTpl.value?.kind !== 'alarm') return
  const k = keyBase(modal.form.key)
  if (!k) return
  const cn = keyDict.value[k]?.name || k
  const isSwitch = ['eq', 'ne'].includes(modal.form.op)
  const name = `${cn}${isSwitch ? (modal.form.op === 'ne' ? '异常告警' : '状态告警') : '越限告警'}`
  const unit = keyDict.value[k]?.unit || ''
  const msg = isSwitch ? `${cn}${modal.form.op === 'ne' ? '异常' : '动作'}(当前值 {value})`
    : `${cn}越限:{value}${unit ? ' ' + unit : ''},请检查`
  if (!modal.form.alarmName || modal.form.alarmName === autoFill.alarmName) {
    modal.form.alarmName = name; autoFill.alarmName = name
  }
  if (!modal.form.message || modal.form.message === autoFill.message) {
    modal.form.message = msg; autoFill.message = msg
  }
}
function suggestOutput() {
  const tpl = modalTpl.value
  if (!tpl) return
  let out = ''
  const k = keyBase(modal.form.key)
  if (modal.tplId === 'window.delta' && k) out = `${k}Used${modal.form.window}`
  else if (modal.tplId === 'window.integrate' && k) out = `${k}Energy${modal.form.window}`
  else if (tpl.kind === 'agg' && modal.form.key) out = `total${modal.form.key}`
  else if (tpl.kind === 'revenue') out = 'revenue'
  if (out && (!modal.form.output || modal.form.output === autoFill.output)) {
    modal.form.output = out; autoFill.output = out
  }
  let asset = ''
  if (tpl.kind === 'agg' && modal.form.key) asset = `RT_TOTAL_${modal.form.key.toUpperCase()}`
  else if (tpl.kind === 'revenue') asset = 'RT_REVENUE'
  if (asset && (!modal.form.asset || modal.form.asset === autoFill.asset)) {
    modal.form.asset = asset; autoFill.asset = asset
  }
}
watch(() => [modal.form.key, modal.form.op, modal.form.window], () => {
  if (!modal.open) return
  suggestAlarm()
  suggestOutput()
})
watch(() => modal.open, (open) => {
  if (open) autoFill = { alarmName: '', message: '', output: '', asset: '' }
})

// 模板模式下可选的测点:匹配设备已认领测点的并集,标注覆盖率
const tplKeyOptions = computed(() => {
  if (modal.target === null) return []
  const t = deviceTemplates.value[modal.target]
  if (!t) return []
  const matched = tplMatched(t)
  const cover = new Map()
  for (const d of matched)
    for (const k of d.keys.filter((k) => k.claimed))
      cover.set(k.key, (cover.get(k.key) || 0) + 1)
  return [...cover.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([key, n]) => {
      const cn = keyDict.value[key]?.name
      return { key, label: `${key}${cn ? ' · ' + cn : ''} (${n}/${matched.length} 台)` }
    })
})

function tplItemDesc(item) {
  if (item.template === 'alarm.threshold') {
    const ops = { gt: '>', lt: '<', gte: '≥', lte: '≤', eq: '=', ne: '≠' }
    return `「${item.name}」${kd(item.key)} ${ops[item.condition.op]} ${item.condition.value} → ${item.severity}${item.trigger === 'edge' ? ' · 变化才报' : ''}`
  }
  if (item.template === 'window.aggregate') return `${item.keys.map(kd).join('/')} · ${item.aggs.join('/')} @ ${item.window}`
  if (item.template === 'window.cascade') return `${item.keys.map(kd).join('/')} · ${item.aggs.join('/')} · 三级归档(5m/1h/1d)`
  if (item.template === 'expr.add' || item.template === 'expr.subtract')
    return `${kd(item.inputs.a.key)} ${item.template === 'expr.add' ? '+' : '−'} ${kd(item.inputs.b.key)} → ${item.output}${item.outputMode === 'attr' ? '(存属性)' : ''}`
  return `${kd(item.key)} @ ${item.window} → ${item.output}`
}

function blankForm() {
  return { device: claimedDevices.value[0]?.name || '', output: '', window: '5m', aggs: ['avg'], keys: [],
           op: 'gt', value: '', severity: 'WARNING', message: '', alarmName: '', trigger: 'level', outputMode: 'ts',
           terms: [{ src: '', constVal: '', abs: false }, { src: '', constVal: '', abs: false }], termOps: ['+'],
           selProfiles: [], selPrefixes: '', agg: 'sum', asset: '', aggName: '',
           chargeRef: '', dischargeRef: '', priceAsset: 'JIZHAN_EELECTRICITY_PRICE_CONFIG' }
}

/* ── 跨设备汇聚(agg)表单支撑 ── */
function formSelector() {
  return { profiles: [...(modal.form.selProfiles || [])],
           prefixes: (modal.form.selPrefixes || '').split(/[,,\s]+/).map((s) => s.trim()).filter(Boolean) }
}
const aggMatched = computed(() => {
  if (modalTpl.value?.kind !== 'agg') return []
  return tplMatched({ selector: formSelector() })
})
const aggKeyOptions = computed(() => {
  const matched = aggMatched.value
  const cover = new Map()
  for (const d of matched)
    for (const k of d.keys.filter((k) => k.claimed))
      cover.set(k.key, (cover.get(k.key) || 0) + 1)
  return [...cover.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([key, n]) => {
      const cn = keyDict.value[key]?.name
      return { key, label: `${key}${cn ? ' · ' + cn : ''} (${n}/${matched.length} 台)` }
    })
})

/* ── 自定义四则运算 ── */
const EXPR_OPS = ['+', '-', '*', '/']
const OP_SHOW = { '+': '+', '-': '−', '*': '×', '/': '÷' }

function addTerm() {
  modal.form.terms.push({ src: '', constVal: '', abs: false })
  modal.form.termOps.push('+')
}
function removeTerm(i) {
  if (modal.form.terms.length <= 2) return
  modal.form.terms.splice(i, 1)
  modal.form.termOps.splice(Math.max(0, i - 1), 1)
}
function termLabel(t) {
  if (t.src === '__const__') return t.constVal === '' ? '?' : t.constVal
  if (!t.src) return '?'
  const k = t.src.split('||')[1]
  return t.abs ? `|${k}|` : k
}
// 从左到右依次计算的表达式预览(带括号,消除歧义)
const exprPreview = computed(() => {
  const f = modal.form
  if (!f.terms) return ''
  let s = termLabel(f.terms[0])
  for (let i = 1; i < f.terms.length; i++) {
    s = `(${s}) ${OP_SHOW[f.termOps[i - 1]]} ${termLabel(f.terms[i])}`
  }
  return s
})
const customValid = computed(() => {
  const f = modal.form
  if (!f.terms || f.terms.length < 2) return false
  let hasKey = false
  for (const t of f.terms) {
    if (t.src === '__const__') {
      if (t.constVal === '' || isNaN(Number(t.constVal))) return false
    } else if (!t.src) return false
    else hasKey = true
  }
  return hasKey && !!f.output.trim()
})

function openTpl(id, target = null) {
  const tpl = TEMPLATES[id]
  modal.tplId = id
  modal.editIndex = null
  modal.target = target
  modal.form = blankForm()
  for (const p of tpl.params) if (p.type === 'key') modal.form[p.id] = ''
  modal.open = true
}

// 编辑设备模板内的运算项
function openTplItemEdit(target, idx) {
  const item = deviceTemplates.value[target].items[idx]
  const tpl = TEMPLATES[item.template]
  modal.tplId = item.template
  modal.editIndex = idx
  modal.target = target
  const f = blankForm()
  if (tpl.kind === 'alarm') {
    f.alarmName = item.name || ''
    f.key = item.key
    f.op = item.condition.op
    f.value = String(item.condition.value)
    f.severity = item.severity
    f.trigger = item.trigger || 'level'
    f.message = item.message
  } else if (tpl.kind === 'cf') {
    for (const p of tpl.params) f[p.id] = item.inputs[p.id].key
    f.output = item.output || ''
    f.outputMode = item.outputMode || 'ts'
  } else if (item.template === 'window.cascade') {
    f.keys = [...item.keys]
    f.aggs = [...item.aggs]
  } else {
    f.window = item.window
    if (item.template === 'window.aggregate') { f.keys = [...item.keys]; f.aggs = [...item.aggs] }
    else { f.key = item.key; f.output = item.output || '' }
  }
  modal.form = f
  modal.open = true
}

function openEdit(i) {
  const c = computations.value[i]
  const tpl = TEMPLATES[c.template]
  modal.tplId = c.template
  modal.editIndex = i
  modal.target = null
  const f = blankForm()
  if (tpl.kind === 'revenue') {
    f.aggName = c.name || ''
    f.chargeRef = `${c.charge.device}||${c.charge.key}`
    f.dischargeRef = `${c.discharge.device}||${c.discharge.key}`
    f.priceAsset = c.priceAsset
    f.window = c.window || '1h'
    f.asset = c.asset
    f.output = c.output
  } else if (tpl.kind === 'agg') {
    f.aggName = c.name || ''
    f.selProfiles = [...(c.selector?.profiles || [])]
    f.selPrefixes = (c.selector?.prefixes || []).join(', ')
    f.key = c.key
    f.agg = c.agg
    f.asset = c.asset
    f.output = c.output
  } else if (tpl.kind === 'alarm') {
    f.alarmName = c.name || ''
    f.key = `${c.device}||${c.key}`
    f.op = c.condition.op
    f.value = String(c.condition.value)
    f.severity = c.severity
    f.trigger = c.trigger || 'level'
    f.message = c.message
  } else if (tpl.custom) {
    f.terms = c.terms.map((t) =>
      t.kind === 'const' ? { src: '__const__', constVal: String(t.value), abs: false }
        : { src: `${t.device}||${t.key}`, constVal: '', abs: !!t.abs })
    f.termOps = [...c.ops]
    f.output = c.output || ''
    f.outputMode = c.outputMode || 'ts'
  } else if (tpl.kind === 'cf') {
    for (const p of tpl.params) f[p.id] = `${c.inputs[p.id].device}||${c.inputs[p.id].key}`
    f.output = c.output || ''
    f.outputMode = c.outputMode || 'ts'
  } else if (c.template === 'window.cascade') {
    f.device = c.device
    f.keys = [...c.keys]
    f.aggs = [...c.aggs]
  } else {
    f.device = c.device
    f.window = c.window
    if (c.template === 'window.aggregate') {
      f.keys = [...c.keys]
      f.aggs = [...c.aggs]
    } else {
      f.key = `${c.device}||${c.key}`
      f.output = c.output || ''
    }
  }
  modal.form = f
  modal.open = true
}

const modalTpl = computed(() => (modal.tplId ? TEMPLATES[modal.tplId] : null))
const modalDeviceKeys = computed(() => {
  const d = claimedDevices.value.find((x) => x.name === modal.form.device)
  return d ? d.keys.filter((k) => k.claimed) : []
})

function keyRef(encoded) {
  const [device, key] = encoded.split('||')
  return { device, key }
}

/* ── 统计测点多选(周期统计/多级归档):过滤 + 限高滚动列表 ──
   旧的 checkbox 流式布局在 250+ 测点的设备上会把弹窗撑出视口且无法滚动 */
const kmFilter = ref('')
const kmLabel = (k) => (modal.target !== null ? k.label : `${k.key}${k.cn ? ' · ' + k.cn : ''}`)
const kmAll = computed(() => (modal.target !== null ? tplKeyOptions.value : modalDeviceKeys.value))
const kmOptions = computed(() => {
  const f = kmFilter.value.trim().toLowerCase()
  if (!f) return kmAll.value
  return kmAll.value.filter((k) => kmLabel(k).toLowerCase().includes(f))
})
function kmSelectAll() {
  const s = new Set(modal.form.keys)
  for (const k of kmOptions.value) s.add(k.key)
  modal.form.keys = [...s]
}
watch(() => modal.open, (v) => { if (v) kmFilter.value = '' })

const modalValid = computed(() => {
  const tpl = modalTpl.value
  if (!tpl) return false
  if (tpl.custom) return customValid.value
  if (tpl.kind === 'revenue') {
    const f = modal.form
    return !!f.chargeRef && !!f.dischargeRef && !!f.priceAsset.trim() &&
      !!f.asset.trim() && !!f.output.trim()
  }
  if (tpl.kind === 'agg') {
    const f = modal.form
    const sel = formSelector()
    return (sel.profiles.length || sel.prefixes.length) && !!f.key &&
      !!f.asset.trim() && !!f.output.trim() && aggMatched.value.length > 0 && aggMatched.value.length <= 40
  }
  if (tpl.kind === 'rollup' && modal.target === null && !modal.form.device) return false
  if (tpl.cascade) return modal.form.keys.length > 0 && modal.form.aggs.length > 0
  for (const p of tpl.params) {
    if (p.type === 'key' && !modal.form[p.id]) return false
    if (p.type === 'keys' && modal.form.keys.length === 0) return false
    if (p.type === 'aggs' && modal.form.aggs.length === 0) return false
    if (p.type === 'number' && (modal.form.value === '' || isNaN(Number(modal.form.value)))) return false
    if (p.type === 'text' && !modal.form.message.trim()) return false
    if (p.type === 'alarmName' && !modal.form.alarmName.trim()) return false
  }
  if ((tpl.needsOutput && !modal.form.output.trim())) return false
  return true
})

function addComputation() {
  const tpl = modalTpl.value
  // 模板模式:构造不绑定设备的运算项,存入设备模板
  if (modal.target !== null) {
    const item = { template: modal.tplId }
    if (tpl.kind === 'alarm') {
      item.name = modal.form.alarmName.trim()
      item.key = modal.form.key
      item.condition = { op: modal.form.op, value: Number(modal.form.value) }
      item.severity = modal.form.severity
      item.trigger = modal.form.trigger
      item.message = modal.form.message.trim()
    } else if (tpl.kind === 'cf') {
      item.inputs = {}
      for (const p of tpl.params) item.inputs[p.id] = { key: modal.form[p.id] }
      item.output = modal.form.output.trim()
      item.outputMode = modal.form.outputMode
    } else if (modal.tplId === 'window.cascade') {
      item.keys = [...modal.form.keys]
      item.aggs = [...modal.form.aggs]
    } else {
      item.window = modal.form.window
      if (modal.tplId === 'window.aggregate') { item.keys = [...modal.form.keys]; item.aggs = [...modal.form.aggs] }
      else { item.key = modal.form.key; item.output = modal.form.output.trim() }
    }
    const items = deviceTemplates.value[modal.target].items
    if (modal.editIndex !== null) items.splice(modal.editIndex, 1, item)
    else items.push(item)
    modal.open = false
    return
  }
  const c = { template: modal.tplId }
  if (tpl.kind === 'revenue') {
    c.name = modal.form.aggName.trim() || modal.form.output.trim()
    c.charge = keyRef(modal.form.chargeRef)
    c.discharge = keyRef(modal.form.dischargeRef)
    c.priceAsset = modal.form.priceAsset.trim()
    c.window = modal.form.window
    c.asset = modal.form.asset.trim()
    c.output = modal.form.output.trim()
    if (modal.editIndex !== null) computations.value.splice(modal.editIndex, 1, c)
    else computations.value.push(c)
    modal.open = false
    return
  }
  if (tpl.kind === 'agg') {
    c.name = modal.form.aggName.trim() || modal.form.output.trim()
    c.selector = formSelector()
    c.key = modal.form.key
    c.agg = modal.form.agg
    c.asset = modal.form.asset.trim()
    c.output = modal.form.output.trim()
    if (modal.editIndex !== null) computations.value.splice(modal.editIndex, 1, c)
    else computations.value.push(c)
    modal.open = false
    return
  }
  if (tpl.kind === 'alarm') {
    const ref = keyRef(modal.form.key)
    c.name = modal.form.alarmName.trim()
    c.device = ref.device
    c.key = ref.key
    c.condition = { op: modal.form.op, value: Number(modal.form.value) }
    c.severity = modal.form.severity
    c.trigger = modal.form.trigger
    c.message = modal.form.message.trim()
  } else if (tpl.custom) {
    c.terms = modal.form.terms.map((t) =>
      t.src === '__const__' ? { kind: 'const', value: Number(t.constVal) }
        : { kind: 'key', abs: !!t.abs, ...keyRef(t.src) })
    c.ops = [...modal.form.termOps]
    c.device = c.terms.find((t) => t.kind === 'key').device // 宿主 = 第一个测点所在设备
    c.output = modal.form.output.trim()
    c.outputMode = modal.form.outputMode
  } else if (tpl.kind === 'cf') {
    c.inputs = {}
    for (const p of tpl.params) c.inputs[p.id] = keyRef(modal.form[p.id])
    c.device = c.inputs[tpl.params[0].id].device // 宿主 = 第一个输入所在设备
    c.output = tpl.fixedOutput || modal.form.output.trim()
    c.outputMode = modal.form.outputMode
  } else if (modal.tplId === 'window.cascade') {
    c.device = modal.form.device
    c.keys = [...modal.form.keys]
    c.aggs = [...modal.form.aggs]
  } else {
    c.device = modal.form.device
    c.window = modal.form.window
    if (modal.tplId === 'window.aggregate') {
      c.keys = [...modal.form.keys]
      c.aggs = [...modal.form.aggs]
    } else {
      c.key = keyRef(modal.form.key).key
      c.output = modal.form.output.trim()
    }
  }
  if (modal.editIndex !== null) computations.value.splice(modal.editIndex, 1, c)
  else computations.value.push(c)
  modal.open = false
}

function compDesc(c) {
  const tpl = TEMPLATES[c.template]
  if (c.template === 'aggregate.crossEntity') {
    const sel = [...(c.selector?.profiles || []), ...(c.selector?.prefixes || [])].join('/')
    const n = tplMatched({ selector: c.selector || {} }).length
    return `「${c.name}」${sel} × ${kd(c.key)} ${c.agg === 'avg' ? '平均' : '求和'}(${n} 台)→ 资产 ${c.asset}.${c.output}`
  }
  if (c.template === 'revenue.periodic') {
    return `「${c.name}」放电 ${c.discharge.device}.${kd(c.discharge.key)} − 充电 ${c.charge.device}.${kd(c.charge.key)} × 分时电价 @ ${c.window || '1h'} → 资产 ${c.asset}.${c.output}(含当日累计)`
  }
  if (c.template === 'alarm.threshold') {
    const ops = { gt: '>', lt: '<', gte: '≥', lte: '≤', eq: '=', ne: '≠' }
    return `「${c.name}」${c.device}.${kd(c.key)} ${ops[c.condition.op]} ${c.condition.value} → ${c.severity}${c.trigger === 'edge' ? ' · 变化才报' : ''} · ${c.message}`
  }
  if (c.template === 'window.cascade') {
    return `${c.device} · ${c.keys.map(kd).join('/')} · ${c.aggs.join('/')} · 5分钟→1小时→1天 三级归档`
  }
  if (c.template === 'expr.custom') {
    let s = c.terms[0].kind === 'const' ? c.terms[0].value
      : (c.terms[0].abs ? `|${kd(c.terms[0].key)}|` : kd(c.terms[0].key))
    for (let i = 1; i < c.terms.length; i++) {
      const t = c.terms[i]
      const tk = t.kind === 'const' ? t.value : (t.abs ? `|${kd(t.key)}|` : kd(t.key))
      s = `(${s}) ${OP_SHOW[c.ops[i - 1]]} ${tk}`
    }
    return `${s} → ${c.output}${c.outputMode === 'attr' ? '(存属性)' : ''}`
  }
  if (c.template.startsWith('expr.')) {
    const op = c.template === 'expr.add' ? '+' : '−'
    return `${c.inputs.a.device}.${kd(c.inputs.a.key)} ${op} ${c.inputs.b.device}.${kd(c.inputs.b.key)} → ${c.output}${c.outputMode === 'attr' ? '(存属性)' : ''}`
  }
  if (tpl.kind === 'cf') {
    return `${c.device} → ${c.output}`
  }
  if (c.template === 'window.aggregate') {
    return `${c.device} · ${c.keys.join(', ')} · ${c.aggs.join('/')} @ ${c.window}`
  }
  if (c.template === 'window.integrate') {
    return `${c.device}.${c.key} 积分电量 @ ${c.window} → ${c.output} (kWh)`
  }
  return `${c.device}.${c.key} 差值 @ ${c.window} → ${c.output}`
}

/* ── display ────────────────────────────────────────────── */
const AGG_SUFFIX = { avg: 'Avg', min: 'Min', max: 'Max', sum: 'Sum' }
const metricList = computed(() => {
  const out = []
  for (const k of claimedKeys.value) out.push({ device: k.device, key: k.key, from: '原始', kind: 'metric' })
  for (const c of computations.value) {
    const tpl = TEMPLATES[c.template]
    if (tpl.kind === 'alarm') {
      out.push({ device: c.device, key: c.name, from: '阈值告警', kind: 'alarm' })
    } else if (tpl.kind === 'cf' || c.template === 'window.delta' || c.template === 'window.integrate') {
      if (c.outputMode !== 'attr')
        out.push({ device: c.device, key: c.output, from: tpl.name, kind: 'metric' })
    } else if (c.template === 'window.aggregate') {
      for (const k of c.keys)
        for (const a of c.aggs)
          out.push({ device: c.device, key: `${k}${AGG_SUFFIX[a]}${c.window}`, from: tpl.name, kind: 'metric' })
    } else if (c.template === 'window.cascade') {
      for (const k of c.keys)
        for (const a of c.aggs)
          for (const lv of ['5m', '1h', '1d'])
            out.push({ device: c.device, key: `${k}${AGG_SUFFIX[a]}${lv}`, from: '多级归档', kind: 'metric' })
    } else if (c.template === 'aggregate.crossEntity') {
      out.push({ device: c.asset, key: c.output, from: '全站汇聚', kind: 'agg' })
    } else if (c.template === 'revenue.periodic') {
      for (const suffix of ['', 'Income', 'Cost', 'Daily', 'IncomeDaily', 'CostDaily'])
        out.push({ device: c.asset, key: c.output + suffix, from: '电价收益', kind: 'agg' })
    }
  }
  // 设备模板展开出的输出(逐台)与告警
  for (const t of deviceTemplates.value) {
    const matched = tplMatched(t)
    for (const item of t.items) {
      if (item.template === 'alarm.threshold') {
        out.push({ device: matched[0]?.name || '', key: item.name, from: `模板·${t.name}`, kind: 'alarm' })
      } else if (item.template === 'window.aggregate') {
        for (const d of matched)
          for (const k of item.keys)
            for (const a of item.aggs)
              out.push({ device: d.name, key: `${k}${AGG_SUFFIX[a]}${item.window}`, from: `模板·${t.name}`, kind: 'metric' })
      } else if (item.output && item.outputMode !== 'attr') {
        for (const d of matched)
          out.push({ device: d.name, key: item.output, from: `模板·${t.name}`, kind: 'metric' })
      }
    }
  }
  // 自然日报表(kzserver 归档,只在生产镜像出现)
  for (const st of reportStations.value)
    out.push({ device: st.id, key: 'kzRevDay', kind: 'report', station: st.labelName || st.entityName,
               from: '自然日报表', title: `${st.labelName || st.entityName} · 逐日收益` })
  return out
})

/* ── 组态:多页面(菜单栏)+ 布局模板与槽位 ── */
const pages = ref([{ id: 'p1', title: '总览', template: 'console', slots: {} }])
const activePage = ref(0)
const curPage = computed(() => pages.value[activePage.value])
const slots = computed(() => curPage.value.slots) // 当前页槽位

let pageSeq = 1
function addPage() {
  pageSeq += 1
  pages.value.push({ id: `p${Date.now()}`, title: `页面 ${pages.value.length + 1}`, template: 'console', slots: {} })
  activePage.value = pages.value.length - 1
}
async function removePageAt(i) {
  if (pages.value.length <= 1) return
  const p = pages.value[i]
  const slotCount = Object.keys(p.slots || {}).length
  if (!(await askConfirm({
    title: '删除页面',
    text: slotCount > 0
      ? `删除页面「${p.title}」?其中已配置的 ${slotCount} 个槽位将一并移除。`
      : `删除页面「${p.title}」?`,
    okLabel: '删除',
    danger: true,
  }))) return
  pages.value.splice(i, 1)
  if (activePage.value >= pages.value.length) activePage.value = pages.value.length - 1
}
const removePage = () => removePageAt(activePage.value)
const header = reactive({ title: '', subtitle: '', showClock: true, showDate: false })

const previewClock = ref('')
const previewDate = ref('')
setInterval(() => {
  const now = new Date()
  previewClock.value = now.toLocaleTimeString('zh-CN', { hour12: false })
  previewDate.value = now.toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short' })
}, 1000)
const curTpl = computed(() => LAYOUT_TEMPLATES[curPage.value.template])
const CARD_CN = { stat: '数字', alarm: '告警状态', gauge: '仪表盘', line: '折线', bar: '柱状',
                  map: '地图', multi: '多序列', combo: '双轴', overview: '概览卡', alarmlist: '告警列表' }
const mockCardCn = (s) => CARD_CN[s.card] || s.card

function switchTemplate(id) {
  curPage.value.template = id
  // 换模板时保留能对上的槽位,清掉多余的
  const valid = new Set([...LAYOUT_TEMPLATES[id].stats, ...LAYOUT_TEMPLATES[id].grid.map((g) => g.id)])
  for (const k of Object.keys(slots.value)) if (!valid.has(k)) delete slots.value[k]
}

const slotModal = reactive({ open: false, slotId: null, zone: 'stat',
                             form: { source: '', card: 'stat', title: '', extra: [], max: 100 } })

function slotZone(slotId) {
  return curTpl.value.stats.includes(slotId) ? 'stat' : 'grid'
}

function openSlot(slotId) {
  slotModal.slotId = slotId
  slotModal.zone = slotZone(slotId)
  const cur = slots.value[slotId]
  slotModal.form = cur
    ? { source: cur.card === 'alarmlist' ? '' : `${cur.kind}||${cur.device}||${cur.key}`,
        card: cur.card, title: cur.title,
        extra: (cur.extra || []).map((x) => `${x.kind || 'metric'}||${x.device}||${x.key}`),
        max: cur.max || 100 }
    : { source: '', card: slotModal.zone === 'stat' ? 'stat' : 'line', title: '', extra: [], max: 100 }
  slotModal.open = true
  loadSrcPreview()
}

/* 多序列/双轴/概览卡的附加测点 */
const cardNeedsExtra = computed(() => ['multi', 'combo', 'overview'].includes(slotModal.form.card))
// 附加测点只能选遥测类源(排除告警/报表分组)
const keyExtraGroups = computed(() =>
  slotPickerGroups.value.filter((g) => !g.label.startsWith('⚠') && !g.label.startsWith('📊')))
const extraLimit = computed(() => (slotModal.form.card === 'combo' ? 1 : 4))
function addExtra() { if (slotModal.form.extra.length < extraLimit.value) slotModal.form.extra.push('') }
function delExtra(i) { slotModal.form.extra.splice(i, 1) }

/* ── 数据源实时预览:选中即拉取该测点最新值,无数据/非遥测源给出标识 ── */
const srcPreview = reactive({ state: 'idle', value: null, ts: null, unit: '', note: '' })
const previewAssetIds = {} // 资产名 → id(汇聚/收益输出挂在资产上;查过一次就缓存)
let previewSeq = 0 // 快速连续切换数据源时,只认最后一次请求的结果
async function loadSrcPreview() {
  const seq = ++previewSeq
  const src = sourceOptions.value.find((o) => o.value === slotModal.form.source)
  if (!src) { srcPreview.state = 'idle'; return }
  if (src.kind === 'alarm') {
    srcPreview.state = 'info'
    srcPreview.note = '告警源:触发时显示在大屏告警区,无实时数值可预览'
    return
  }
  if (src.kind === 'report') {
    srcPreview.state = 'info'
    srcPreview.note = '报表源:数据来自 kzserver 按日归档,非实时遥测'
    return
  }
  srcPreview.state = 'loading'
  try {
    let entityType = 'DEVICE'
    let id = devices.value.find((d) => d.name === src.device)?.tbId
    if (!id) {
      entityType = 'ASSET'
      if (!(src.device in previewAssetIds)) {
        const page = await api(`/api/tenant/assets?pageSize=100&page=0&textSearch=${encodeURIComponent(src.device)}`)
        previewAssetIds[src.device] = page.data.find((a) => a.name === src.device)?.id.id || null
      }
      id = previewAssetIds[src.device]
    }
    if (seq !== previewSeq) return
    if (!id) {
      srcPreview.state = 'empty'
      srcPreview.note = '目标资产尚未创建——首次发布后才会生成数据'
      return
    }
    const r = await api(`/api/plugins/telemetry/${entityType}/${id}/values/timeseries?keys=${encodeURIComponent(src.key)}`)
    if (seq !== previewSeq) return
    // 注意:TB 对不存在的 key 也会返回 [{ts: now, value: null}],必须按无数据处理
    const arr = r?.[src.key]
    if (arr?.length && arr[0].value !== null && arr[0].value !== '') {
      srcPreview.state = 'ok'
      srcPreview.value = arr[0].value
      srcPreview.ts = arr[0].ts
      const dk = devices.value.find((d) => d.name === src.device)?.keys.find((k) => k.key === src.key)
      srcPreview.unit = dk?.unit || keyDict.value[src.key]?.unit || ''
    } else {
      // 还没发布的即时派生运算:用当前实时输入现算预估值
      const comp = findExprComp(src.device, src.key)
      if (comp) {
        const est = await estimateExpr(comp)
        if (seq !== previewSeq) return
        if (est !== null) {
          srcPreview.state = 'est'
          srcPreview.value = Math.round(est * 10000) / 10000
          srcPreview.note = '预估值:按当前实时输入即时计算,发布后由平台正式生成'
          return
        }
      }
      srcPreview.state = 'empty'
      srcPreview.note = '该测点暂无数据——声明的运算输出要发布后才开始生成;设备原始测点则说明设备未上报'
    }
  } catch (e) {
    if (seq !== previewSeq) return
    srcPreview.state = 'empty'
    srcPreview.note = `实时值读取失败:${e.message}`
  }
}
// 未发布的即时派生运算(expr.*):按当前实时输入现算一个预估值,让第 4 步立刻能看到数
function findExprComp(device, key) {
  const direct = computations.value.find((c) => c.device === device && c.output === key && c.template?.startsWith('expr.'))
  if (direct) return direct
  for (const t of deviceTemplates.value)
    for (const item of t.items || [])
      if (item.output === key && item.template?.startsWith('expr.')) {
        if (item.template === 'expr.custom')
          return { ...item, device, terms: (item.terms || []).map((x) => (x.kind === 'key' ? { ...x, device } : x)) }
        return { template: item.template, device, output: key,
          inputs: Object.fromEntries(Object.entries(item.inputs || {}).map(([p, r]) => [p, { device, key: r.key }])) }
      }
  return null
}
async function fetchLatestNum(devName, key) {
  const id = devices.value.find((d) => d.name === devName)?.tbId
  if (!id) return null
  const r = await api(`/api/plugins/telemetry/DEVICE/${id}/values/timeseries?keys=${encodeURIComponent(key)}`).catch(() => null)
  const v = parseFloat(r?.[key]?.[0]?.value)
  return Number.isNaN(v) ? null : v
}
async function estimateExpr(c) {
  if (c.template === 'expr.add' || c.template === 'expr.subtract') {
    const a = await fetchLatestNum(c.inputs.a.device, c.inputs.a.key)
    const b = await fetchLatestNum(c.inputs.b.device, c.inputs.b.key)
    if (a === null || b === null) return null
    return c.template === 'expr.add' ? a + b : a - b
  }
  if (c.template === 'expr.custom') {
    let acc = null
    for (let i = 0; i < (c.terms || []).length; i++) {
      const t = c.terms[i]
      let v = t.kind === 'const' ? parseFloat(t.value) : await fetchLatestNum(t.device, t.key)
      if (v === null || Number.isNaN(v)) return null
      if (t.abs) v = Math.abs(v)
      if (i === 0) acc = v
      else {
        const op = c.ops[i - 1]
        acc = op === '+' ? acc + v : op === '-' ? acc - v : op === '*' ? acc * v : acc / v
      }
    }
    return acc
  }
  return null
}

function previewAge() {
  if (!srcPreview.ts) return ''
  const s = Math.max(0, (Date.now() - srcPreview.ts) / 1000)
  if (s < 60) return `${Math.round(s)} 秒前`
  if (s < 3600) return `${Math.round(s / 60)} 分钟前`
  if (s < 86400) return `${Math.round(s / 3600)} 小时前`
  return new Date(srcPreview.ts).toLocaleString('zh-CN')
}
const previewStale = computed(() => // 超过 10 分钟没新数据就提示可能离线
  srcPreview.state === 'ok' && srcPreview.ts && Date.now() - srcPreview.ts > 10 * 60 * 1000)

const sourceOptions = computed(() =>
  metricList.value.map((m) => {
    if (m.kind === 'report')
      return { value: `${m.kind}||${m.device}||${m.key}`, label: `📊 ${m.title}(${m.from})`,
               kind: m.kind, device: m.device, key: m.key, title: m.title, station: m.station }
    const cn = m.kind === 'alarm' ? '' : smartCn(m.key)
    return {
      value: `${m.kind}||${m.device}||${m.key}`,
      label: `${m.kind === 'alarm' ? '⚠ ' : ''}${m.device} / ${m.key}${cn ? ' · ' + cn : ''}(${m.from})`,
      kind: m.kind, device: m.device, key: m.key, from: m.from,
    }
  }))
// 指标位(数字卡)不提供报表源——报表是曲线形态
const zoneSourceOptions = computed(() =>
  slotModal.zone === 'stat' ? sourceOptions.value.filter((o) => o.kind !== 'report') : sourceOptions.value)

// 数据源选择器分组:第 3 步声明的运算置顶(⭐ 默认展开),其余按 设备/资产/告警/报表 分组默认折叠
const slotPickerGroups = computed(() => {
  const strip = (o) => o.label.replace(`${o.device} / `, '')
  const pinned = { label: '⭐ 本站声明的运算(第 3 步配置)', items: [], pinned: true }
  const rest = []
  const by = new Map()
  const grp = (label) => {
    if (!by.has(label)) { const g = { label, items: [] }; by.set(label, g); rest.push(g) }
    return by.get(label)
  }
  for (const o of zoneSourceOptions.value) {
    if (o.kind === 'report') grp('📊 自然日报表(kzserver)').items.push({ value: o.value, label: o.label })
    else if (o.kind === 'alarm') grp('⚠ 告警').items.push({ value: o.value, label: o.label })
    else if (o.kind === 'agg') pinned.items.push({ value: o.value, label: `${o.device} / ${strip(o)}` })
    else if (o.from !== '原始') pinned.items.push({ value: o.value, label: `${o.device} / ${strip(o)}` })
    else grp(`📟 ${o.device}`).items.push({ value: o.value, label: strip(o) })
  }
  return pinned.items.length ? [pinned, ...rest] : rest
})

// 第 3 步各测点下拉:按设备分组
const claimedKeyGroups = computed(() => {
  const by = new Map()
  for (const k of claimedKeys.value) {
    if (!by.has(k.device)) by.set(k.device, [])
    by.get(k.device).push(k)
  }
  return [...by.entries()].map(([device, items]) => ({ device, items }))
})

const slotCardOptions = computed(() => {
  const src = sourceOptions.value.find((o) => o.value === slotModal.form.source)
  if (slotModal.zone === 'stat') {
    return src?.kind === 'alarm' ? STAT_SLOT_CARDS.filter((c) => c.id === 'alarm')
                                  : STAT_SLOT_CARDS.filter((c) => c.id !== 'alarm')
  }
  return GRID_SLOT_CARDS
})

function bizLabel(device, key) {
  const dev = devices.value.find((d) => d.name === device)
  const k = dev?.keys.find((x) => x.key === key)
  return k?.label || key
}

function onSourceChange() {
  loadSrcPreview()
  const src = sourceOptions.value.find((o) => o.value === slotModal.form.source)
  if (!src) return
  if (src.kind === 'report') { slotModal.form.card = 'bar'; slotModal.form.title = src.title; return }
  if (slotModal.zone === 'stat') slotModal.form.card = src.kind === 'alarm' ? 'alarm' : 'stat'
  else if (/latitude|longitude/.test(src.key)) slotModal.form.card = 'map'
  else if (/Avg|Min|Max|Used|Energy5m/.test(src.key)) slotModal.form.card = 'bar'
  else slotModal.form.card = 'line'
  slotModal.form.title = src.kind === 'alarm' ? src.key
    : (bizLabel(src.device, src.key) !== src.key ? bizLabel(src.device, src.key)
       : (smartCn(src.key) || src.key))
}

function saveSlot() {
  if (slotModal.form.card === 'alarmlist') {
    slots.value[slotModal.slotId] = { kind: 'alarmlist', device: '', key: '', card: 'alarmlist',
                                      title: slotModal.form.title.trim() || '实时告警' }
    slotModal.open = false
    return
  }
  const [kind, device, key] = slotModal.form.source.split('||')
  const slot = { kind, device, key, card: slotModal.form.card,
                 title: slotModal.form.title.trim() || key }
  if (cardNeedsExtra.value) {
    slot.extra = slotModal.form.extra
      .filter(Boolean)
      .slice(0, extraLimit.value)
      .map((v) => { const [k2, d2, y2] = v.split('||'); return { kind: k2, device: d2, key: y2 } })
      .filter((x) => x.device && x.key)
  }
  if (slotModal.form.card === 'gauge') slot.max = Number(slotModal.form.max) || 100
  // 报表槽位记下站点中文名——大屏卡片副标题显示它而不是原始 UUID
  const src = sourceOptions.value.find((o) => o.value === slotModal.form.source)
  if (src?.station) slot.deviceLabel = src.station
  slots.value[slotModal.slotId] = slot
  slotModal.open = false
}

async function clearSlot() {
  if (!(await askConfirm({
    title: '清空槽位',
    text: '清空该指标位的配置?',
    okLabel: '清空',
    danger: true,
  }))) return
  delete slots.value[slotModal.slotId]
  slotModal.open = false
}

/* ── export ─────────────────────────────────────────────── */
const rollupChainName = ref('Periodic Rollups')
const siteJson = computed(() => ({
  schema: 'tbsite/v2',
  site: { name: site.name, label: site.label },
  devices: claimedDevices.value.map((d) => ({
    name: d.name,
    type: d.profile || 'simulator',
    profile: d.profile || 'default',
    keys: d.keys.filter((k) => k.claimed).map((k) => ({ key: k.key, label: k.label || k.key, unit: k.unit })),
  })),
  deviceTemplates: JSON.parse(JSON.stringify(deviceTemplates.value)),
  computations: computations.value,
  rollup: { chainName: rollupChainName.value },
  layout: {
    pages: JSON.parse(JSON.stringify(pages.value)),
    header: {
      title: header.title.trim(),
      subtitle: header.subtitle.trim(),
      showClock: header.showClock,
      showDate: header.showDate,
    },
  },
  // 兼容旧站点视图的扁平清单(汇总所有页面的槽位;未放入任何页面的告警默认走横幅)
  display: (() => {
    const allSlots = pages.value.flatMap((p) => Object.values(p.slots))
    return [
      ...allSlots.filter((s) => s.card !== 'alarmlist').map((s) => ({
        device: s.device, key: s.key,
        kind: s.kind === 'alarm' ? 'alarm' : s.kind === 'report' ? 'report' : 'metric',
        card: s.kind === 'alarm' ? 'badge' : s.card,
      })),
      // 多序列/双轴/概览卡的附加测点也进清单(大屏据此铺历史)
      ...allSlots.flatMap((s) => (s.extra || []).map((x) => ({
        device: x.device, key: x.key, kind: 'metric', card: 'line',
      }))),
      ...computations.value
        .filter((c) => c.template === 'alarm.threshold')
        .filter((c) => !allSlots.some((s) => s.kind === 'alarm' && s.key === c.name))
        .map((c) => ({ device: c.device, key: c.name, kind: 'alarm', card: 'banner' })),
    ]
  })(),
}))
const jsonText = computed(() => JSON.stringify(siteJson.value, null, 2))
const copied = ref(false)

function download() {
  const blob = new Blob([jsonText.value], { type: 'application/json' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = `${site.name}.tbsite.json`
  a.click()
  URL.revokeObjectURL(a.href)
}
async function copyJson() {
  await navigator.clipboard.writeText(jsonText.value)
  copied.value = true
  setTimeout(() => (copied.value = false), 1500)
}

/* ── publish pipeline ── */
const PUB_STEPS = [
  { id: 'validate', label: '配置校验' },
  { id: 'devices', label: '设备核对' },
  { id: 'cf', label: '即时派生(计算字段)' },
  { id: 'agg', label: '全站汇聚(虚拟资产)' },
  { id: 'revenue', label: '分时电价收益' },
  { id: 'rollup', label: '定时聚合链' },
  { id: 'alarm', label: '告警链 + Root 接线' },
  { id: 'asset', label: '站点配置写入 TB' },
]
const pub = reactive({ running: false, done: false, steps: {}, failures: [] })
const STEP_CN = Object.fromEntries(PUB_STEPS.map((s) => [s.id, s.label]))
function resetPub() {
  pub.done = false
  pub.failures = []
  for (const s of PUB_STEPS) pub.steps[s.id] = { status: 'idle', detail: '' }
}
resetPub()

function report(id, status, detail = '') {
  pub.steps[id] = { status, detail }
}

async function doPublish(openAfter) {
  if (pub.running) return
  if (!canPublishSite.value) {
    alert(`当前账号(现场)只能发布以下站点:${perm.sites.join('、') || '(未授权任何站点)'}`)
    return
  }
  if (!(await askConfirm({
    title: '确认发布',
    text: conn.env === 'mirror'
      ? `即将向【生产镜像】写入站点「${site.name}」的配置(计算字段/规则链/站点资产)。\n所有写入均为幂等、且不改动存量规则链。确认发布?`
      : conn.env === 'demo'
        ? `发布站点「${site.name}」的配置到演示环境?`
        : `即将向项目【${curEnv.value.label}】写入站点「${site.name}」的配置(计算字段/规则链/站点资产)。\n所有写入均为幂等、且不改动存量规则链。确认发布?`,
    okLabel: '发布',
  }))) return
  resetPub()
  pub.running = true
  // 弹窗拦截规避:必须在用户点击的同步调用栈里先开好窗口,发布完成后再导航过去
  // (发布是长异步流程,结束后再 window.open 会被浏览器当作非用户触发而静默拦截)
  let pendingWin = null
  if (openAfter) {
    pendingWin = window.open('', '_blank')
    if (pendingWin) pendingWin.document.write('<title>GRID·OPS</title><body style="background:#0b0e14;color:#8b93a7;font:14px sans-serif;display:flex;align-items:center;justify-content:center;height:100vh">发布中,完成后自动打开站点大屏…</body>')
  }
  const devIds = Object.fromEntries(claimedDevices.value.map((d) => [d.name, d.tbId]))
  try {
    pub.failures = await publish(siteJson.value, devIds, (url, data, method) => api(url, data, method), report, conn.username) || []
    pub.done = pub.failures.length === 0
    if (pub.done && pendingWin) pendingWin.location = frontendUrl()
    else if (pub.done && openAfter) openFrontend()
    else if (pendingWin) pendingWin.close() // 有失败项:不跳大屏,留在向导处理失败清单
  } catch {
    if (pendingWin) pendingWin.close()
    /* 校验/设备核对失败——细节已写入对应步骤的 error */
  } finally {
    pub.running = false
  }
}

// 只重发失败项:成功步骤跳过,cf/agg 精确到失败条目(全部写入幂等,重跑安全)
async function retryFailed() {
  if (pub.running || !pub.failures.length) return
  if (!(await askConfirm({
    title: '重试失败项',
    text: `只重新发布 ${pub.failures.length} 个失败项,已成功的步骤跳过(写入幂等,重跑安全)。继续?`,
    okLabel: '重试',
  }))) return
  const scope = {
    steps: [...new Set(pub.failures.map((f) => f.step))],
    cf: pub.failures.filter((f) => f.step === 'cf').map((f) => ({ device: f.device, output: f.output })),
    agg: pub.failures.filter((f) => f.step === 'agg' && f.output).map((f) => f.output),
  }
  pub.running = true
  const devIds = Object.fromEntries(claimedDevices.value.map((d) => [d.name, d.tbId]))
  try {
    pub.failures = await publish(siteJson.value, devIds, (url, data, method) => api(url, data, method), report, conn.username, scope) || []
    pub.done = pub.failures.length === 0
  } catch { /* 校验失败——细节在步骤行 */ } finally {
    pub.running = false
  }
}
function failureLabel(f) {
  if (f.step === 'cf') return `${f.device} → ${f.output}`
  if (f.step === 'agg') return f.output || '汇聚'
  return STEP_CN[f.step] || f.step
}

/* ── 发布历史与回滚 ── */
const pubHistory = reactive({ open: false, list: [], msg: '' })
async function loadPubHistory() {
  pubHistory.open = !pubHistory.open
  if (!pubHistory.open) return
  pubHistory.msg = '读取中…'
  pubHistory.list = []
  try {
    const page = await api(`/api/tenant/assets?pageSize=100&page=0&textSearch=${encodeURIComponent(site.name)}`)
    const asset = page.data.find((a) => a.name === site.name && a.type === 'tbsite')
    if (!asset) { pubHistory.msg = '该站点还没有发布记录'; return }
    const attrs = await api(`/api/plugins/telemetry/ASSET/${asset.id.id}/values/attributes/SERVER_SCOPE?keys=siteConfigHistory`)
    const raw = attrs.find((a) => a.key === 'siteConfigHistory')?.value
    pubHistory.list = (typeof raw === 'string' ? JSON.parse(raw) : raw) || []
    pubHistory.msg = pubHistory.list.length ? '' : '还没有历史版本(首次发布后,再次发布才会产生历史)'
  } catch (e) { pubHistory.msg = `读取失败:${e.message}` }
}
function histSummary(h) {
  const c = h.cfg || {}
  const tpl = (c.deviceTemplates || []).reduce((n, t) => n + (t.items?.length || 0), 0)
  return `${(c.devices || []).length} 设备 · ${(c.computations || []).length + tpl} 项运算 · ${(c.layout?.pages || []).length} 页面`
}
async function restoreVersion(i) {
  const h = pubHistory.list[i]
  if (!(await askConfirm({
    title: '载入历史版本',
    text: `把 ${new Date(h.ts).toLocaleString('zh-CN')} 的配置载入向导?\n只是载入,不会立即生效——检查无误后点「发布」才会回滚线上配置。`,
    okLabel: '载入',
  }))) return
  hydrate(JSON.parse(JSON.stringify(h.cfg)))
  pubHistory.msg = '已载入该版本到向导——请检查各步配置,确认后点「发布」完成回滚'
}

/* ── 站点清理(删除本站点生成的一切,不碰存量)────────── */
const cleanupMsg = ref('')
async function doCleanup() {
  if (pub.running) return
  if (perm.role === 'field') { cleanupMsg.value = '现场账号无清理权限,请联系管理员'; return }
  if (!(await askConfirm({
    title: '清理站点生成物',
    text: `将删除站点「${site.name}」发布过的全部生成物:\n· 声明的计算字段\n· Site Alarms / Site Rollups 规则链\n· Root 链上的本站点转发节点\n· 站点配置资产\n\n不会碰任何非本站点的存量对象。确认清理?`,
    okLabel: '清理',
    danger: true,
  }))) return
  cleanupMsg.value = '清理中…'
  const devIds = Object.fromEntries(claimedDevices.value.map((d) => [d.name, d.tbId]))
  try {
    cleanupMsg.value = '已清理:' + await cleanup(siteJson.value, devIds, (url, data, method) => api(url, data, method), report)
  } catch (e) {
    cleanupMsg.value = `清理失败:${e.message}`
  }
}

function frontendUrl() {
  if (curEnv.value.custom) {
    const pub = pubCustomerId.value ? `&pub=${pubCustomerId.value}` : ''
    return `/site.html?site=${encodeURIComponent(site.name)}&base=${encodeURIComponent(curEnv.value.base)}${pub}`
  }
  const env = conn.env === 'mirror' ? '&env=mirror' : ''
  return `/site.html?site=${encodeURIComponent(site.name)}${env}`
}
function openFrontend() {
  window.open(frontendUrl(), '_blank')
}
</script>

<template>
  <div class="prov-shell">
    <div class="fx-aurora"></div>
    <div class="fx-stars"></div>
    <div class="fx-grid"></div>
    <div class="fx-sweep"></div>

    <transition name="boot-fade" :duration="500">
      <div v-if="booting" class="boot-splash">
        <div class="boot-mark">
          <span class="boot-ring"></span>
          <span class="boot-ring r2"></span>
          <img class="boot-logo" src="../assets/img/company-logo.png" alt="国网电瑞" />
        </div>
        <div class="boot-title">国网电瑞</div>
        <div class="boot-sub">GWDR POWER TECHNOLOGY · 站点声明工具</div>
        <div class="boot-bar"><i></i></div>
      </div>
    </transition>
    <header class="topbar">
      <div class="brand">
        <img class="brand-logo" src="../assets/img/company-logo.png" alt="国网电瑞" />
        <span class="brand-mark">国网电瑞</span>
        <span class="brand-sub">GWDR Power Technology · 站点声明工具</span>
      </div>
      <div class="topbar-right">
        <span class="live-pill" :class="conn.status === 'ok' ? 'live' : 'offline'">
          <span class="live-dot"></span>{{ conn.status === 'ok' ? 'TB 已连接' : '未连接' }}
        </span>
      </div>
    </header>

    <nav class="steps">
      <button v-for="(s, i) in STEPS" :key="i" class="step-btn" :class="{ on: step === i, done: step > i }" @click="step = i">
        <span class="n">{{ i + 1 }}</span>{{ s }}
      </button>
    </nav>

    <!-- 1 连接与站点 -->
    <div v-show="step === 0" class="panel connect-hero">
      <h2>连接 ThingsBoard 并命名站点</h2>
      <p class="hint">连接后工具会自动发现平台上的设备与其正在上报的测点——你不需要手工输入任何键名。</p>
      <div class="frow">
        <div class="field"><label>目标环境 / 项目</label>
          <div class="env-row">
            <select v-model="conn.env" @change="switchEnv">
              <option v-for="(e, id) in allEnvs" :key="id" :value="id">{{ e.label }}</option>
            </select>
            <button class="btn ghost sm" title="录入新项目的 TB 地址" @click="openEnvModal()">＋ 新项目</button>
            <template v-if="curEnv.custom">
              <button class="btn ghost sm" @click="openEnvModal(conn.env)">编辑</button>
              <button class="btn ghost sm" @click="removeCustomEnv">删除</button>
            </template>
          </div>
        </div>
        <div class="field"><label>账号</label><input type="text" v-model="conn.username" /></div>
        <div class="field"><label>密码</label><input type="password" v-model="conn.password" /></div>
        <button class="btn" :disabled="conn.status === 'busy'" @click="connect">
          {{ conn.status === 'busy' ? (conn.progress || '发现中…') : '连接并发现设备' }}
        </button>
      </div>
      <label class="remember-check">
        <input type="checkbox" v-model="rememberLogin" />记住登录(30 天,保存在本机浏览器,勿在公用电脑勾选)
      </label>
      <p v-if="conn.status === 'ok'" class="ok-msg">
        已发现 {{ devices.length }} 台设备({{ dataDeviceCount }} 台有数据
        <template v-if="gatewayCount"> · {{ gatewayCount }} 个网关</template>),请进入「设备与测点」认领。
      </p>
      <p v-if="conn.status === 'err'" class="err-msg">连接失败:{{ conn.error }}</p>
      <div v-if="sites.length" class="frow" style="margin-top: 16px">
        <div class="field"><label>载入已发布站点</label>
          <select v-model="selectedSite" @change="loadSite(selectedSite, true)">
            <option v-for="s in sites" :key="s.name" :value="s.name">{{ s.name }}</option>
          </select>
        </div>
      </div>
      <p v-if="restoreMsg" class="ok-msg" style="margin-top: 6px">{{ restoreMsg }}</p>
      <div v-if="draftList.length" class="draft-banner draft-list">
        <div class="draft-head">💾 本机草稿({{ draftList.length }} 份)——当前载入的是「线上已发布」版本,草稿可能更新</div>
        <div v-for="(d, i) in draftList" :key="d.id" class="draft-row">
          <span class="draft-name">{{ d.name }}</span>
          <span class="draft-meta">{{ new Date(d.ts).toLocaleString('zh-CN') }} ·
            {{ d.cfg.devices?.length || 0 }} 设备 · {{ d.cfg.computations?.length || 0 }} 运算</span>
          <button class="btn sm" @click="loadDraftAt(i)">载入</button>
          <button class="btn ghost sm" @click="dropDraftAt(i)">删除</button>
        </div>
      </div>
      <div class="frow" style="margin-top: 20px">
        <div class="field"><label>站点标识 (英文)</label>
          <select v-if="perm.role === 'field'" v-model="site.name">
            <option v-for="s in perm.sites" :key="s" :value="s">{{ s }}</option>
          </select>
          <input v-else type="text" v-model="site.name" />
        </div>
        <div class="field"><label>站点名称</label><input type="text" v-model="site.label" /></div>
      </div>
      <p v-if="perm.role === 'field'" class="perm-badge">
        👷 现场账号({{ perm.email }})— 仅可发布授权站点:{{ perm.sites.join('、') || '(未授权)' }};无清理权限
      </p>

      <details v-if="perm.role === 'admin' && conn.status === 'ok'" class="perm-panel">
        <summary>权限管理(现场账号授权)</summary>
        <p class="perm-hint">
          给现场部署人员的 TB 账号设置「现场」角色:只能发布指定站点、不能清理生成物。
          未登记的账号默认为管理员(全功能)。配置保存在 gridops-config 资产上,对所有打开本工具的人生效。
        </p>
        <div v-for="(r, i) in permEdit" :key="i" class="perm-row">
          <input type="text" v-model="r.email" placeholder="TB 账号邮箱" class="perm-email" />
          <select v-model="r.role" class="perm-role">
            <option value="field">现场(受限)</option>
            <option value="admin">管理员</option>
          </select>
          <input type="text" v-model="r.sites" placeholder="允许的站点标识,逗号分隔(现场角色用)" class="perm-sites" :disabled="r.role !== 'field'" />
          <button class="btn ghost sm" @click="permDelRow(i)">删除</button>
        </div>
        <div class="frow" style="margin-top: 8px">
          <button class="btn ghost sm" @click="permAddRow">+ 添加账号</button>
          <button class="btn sm" @click="savePerms">保存权限配置</button>
        </div>
        <p v-if="permMsg" class="ok-msg" style="margin-top: 6px">{{ permMsg }}</p>
      </details>
    </div>

    <!-- 2 设备与测点 -->
    <div v-show="step === 1" class="panel">
      <h2>认领设备与测点</h2>
      <div class="wf-guide">
        <span class="wf-step"><b>1</b> 用搜索/类型筛出本站点的设备</span>
        <span class="wf-arrow">→</span>
        <span class="wf-step"><b>2</b> 勾选设备(整机)或展开只挑部分测点</span>
        <span class="wf-arrow">→</span>
        <span class="wf-step"><b>3</b> 核对中文名称与单位(平台字典已自动填好,可改)</span>
      </div>
      <p v-if="!devices.length" class="err-msg">尚未发现设备——请先在第 1 步连接 ThingsBoard。</p>
      <div v-if="devices.length" class="disc-toolbar">
        <input type="text" v-model="devFilter.q" class="disc-search"
               placeholder="搜索:设备名 / 中文描述 / 测点键名…" />
        <select v-model="devFilter.profile" title="按设备类型筛选">
          <option value="">全部类型</option>
          <option v-for="p in profileList" :key="p" :value="p">{{ p }}{{ profileCn(p) ? ' · ' + profileCn(p) : '' }}</option>
        </select>
        <button class="btn ghost sm" title="把当前筛选出的设备连同全部测点一次认领" @click="claimFiltered(true)">✓ 认领筛选结果</button>
        <button class="btn ghost sm" title="取消当前筛选结果的认领" @click="claimFiltered(false)">✕ 取消认领</button>
        <span class="disc-cnt">已认领 <b>{{ claimedDevices.length }}</b> 台 · <b>{{ claimedKeyCount }}</b> 个测点</span>
      </div>
      <div v-for="g in deviceGroups" :key="g.name" class="gw-group">
        <div class="gw-head clickable" @click="toggleGw(g)" title="点击折叠/展开该网关下的设备">
          <span class="gw-fold">{{ isGwOpen(g) ? '▼' : '▶' }}</span>
          <span class="gw-name">{{ g.name }}</span>
          <span class="gw-cnt">{{ g.withData.length }} 台有数据<template v-if="g.empty.length"> · {{ g.empty.length }} 台暂无数据</template></span>
          <span v-if="groupClaimed(g)" class="gw-claimed">已认领 {{ groupClaimed(g) }} 台</span>
        </div>
        <template v-if="isGwOpen(g)">
        <div v-for="d in g.withData" :key="d.tbId" class="dev-block">
          <div class="dev-head" @click="d.open = !d.open">
            <input type="checkbox" :checked="d.keys.every((k) => k.claimed)" @click.stop
                   title="勾选 = 认领这台设备的全部测点"
                   @change="claimDevice(d, $event.target.checked)" />
            <span class="name">{{ d.name }}</span>
            <span class="profile-chip" :title="profileCn(d.profile)">{{ d.profile }}<template v-if="profileCn(d.profile)"> · {{ profileCn(d.profile) }}</template></span>
            <span v-if="d.desc" class="dev-desc">{{ d.desc }}</span>
            <span class="cnt" :class="{ some: d.keys.some((k) => k.claimed) }">
              {{ d.keys.filter((k) => k.claimed).length }}/{{ d.keys.length }} 测点 · {{ d.open ? '收起 ▲' : '展开 ▼' }}</span>
          </div>
          <div v-show="d.open" class="kg-wrap">
            <div class="kg-actions">
              <button class="btn ghost sm" @click="claimDevice(d, true)">全选测点</button>
              <button class="btn ghost sm" @click="claimDevice(d, false)">清空</button>
              <span class="kg-tip">「中文名称」将显示在大屏上;平台字典已自动填入,可按现场习惯修改</span>
            </div>
            <div class="key-grid">
            <span class="hd">勾选</span><span class="hd">测点(实时值)</span><span class="hd">中文名称(大屏显示)</span><span class="hd">单位</span>
            <template v-for="k in d.keys" :key="k.key">
              <input type="checkbox" v-model="k.claimed" />
              <span class="kname">{{ k.key }}<span v-if="k.cn" class="kcn">{{ k.cn }}</span> <span style="opacity:.55">= {{ k.latest }}</span></span>
              <input type="text" v-model="k.label" :placeholder="k.cn || k.key" />
              <input type="text" v-model="k.unit" placeholder="如 kW / V / ℃" />
            </template>
            </div>
          </div>
        </div>
        <div v-if="g.empty.length" class="empty-devs">
          <div class="empty-head" @click="emptyOpen[g.name] = !emptyOpen[g.name]">
            暂无数据设备 ({{ g.empty.length }}) · {{ emptyOpen[g.name] ? '收起' : '展开' }}
          </div>
          <div v-show="emptyOpen[g.name]" class="empty-list">
            <div v-for="d in g.empty" :key="d.tbId" class="empty-row">
              <span class="name">{{ d.name }}</span>
              <span class="profile-chip">{{ d.profile }}</span>
              <span v-if="d.desc" class="dev-desc">{{ d.desc }}</span>
            </div>
          </div>
        </div>
        </template>
      </div>
      <div class="step-foot">
        <span v-if="draftMsg" class="draft-msg">{{ draftMsg }}</span>
        <button class="btn ghost sm" @click="saveDraft(false)">保存草稿</button>
        <button class="btn" @click="saveDraft(true)">保存并进入运算配置 →</button>
      </div>
    </div>

    <!-- 3 运算配置 -->
    <div v-show="step === 2" class="panel">
      <h2>运算配置</h2>
      <div class="sum-bar">
        <span class="sum-chip cf">即时计算 {{ compSummary.cf }}</span>
        <span class="sum-chip rollup">定时统计 {{ compSummary.rollup }}</span>
        <span class="sum-chip alarm">告警规则 {{ compSummary.alarm }}</span>
        <span class="sum-chip site">全站级 {{ compSummary.site }}</span>
        <span class="sum-tip" v-if="!compSummary.cf && !compSummary.rollup && !compSummary.alarm && !compSummary.site">
          还没有任何配置——从下面两种方式任选其一开始</span>
      </div>

      <div class="way-head clickable" @click="wayOpen.w1 = !wayOpen.w1" title="点击折叠/展开">
        <span class="gw-fold">{{ wayOpen.w1 ? '▼' : '▶' }}</span>
        <span class="way-badge">方式一 · 推荐</span>
        <h3 class="way-title">设备模板:一类设备,一次配置</h3>
        <span v-if="!wayOpen.w1" class="way-fold-sum">{{ deviceTemplates.length }} 个模板</span>
      </div>
      <template v-if="wayOpen.w1">
      <p class="hint">先按「设备类型 / 名称前缀」圈出一批同类设备(如全部保护测控装置),再给它们统一加运算和告警;发布时自动套用到每台匹配设备,缺少所需测点的设备会自动跳过。设备多时用这种方式最省事。</p>
      <div class="preset-row">
        <span class="preset-label">常用方案(点一下即建好,再微调阈值即可):</span>
        <button v-for="p in PRESETS" :key="p.id" class="preset-btn" :title="p.desc" @click="applyPreset(p)">
          <span class="preset-icon">{{ p.icon }}</span>{{ p.name }}
        </button>
        <button class="btn ghost sm" @click="openTplMgr(null)">+ 自建空白模板</button>
      </div>
      <p v-if="presetMsg" class="ok-msg" style="margin: 0 0 10px">{{ presetMsg }}</p>
      <div v-for="(t, ti) in deviceTemplates" :key="ti" class="dt-card">
        <div class="dt-head">
          <span class="dt-name">{{ t.name }}</span>
          <span class="dt-sel">
            <template v-if="t.selector.profiles.length">类型: {{ t.selector.profiles.join('/') }}</template>
            <template v-if="t.selector.prefixes.length"> 前缀: {{ t.selector.prefixes.join('/') }}</template>
          </span>
          <span class="dt-match" title="按选择器在已认领设备中匹配到的数量">匹配 {{ tplMatched(t).length }} 台已认领设备</span>
          <button class="btn ghost sm" @click="openTplMgr(ti)">编辑选择器</button>
          <button class="btn ghost sm" @click="removeTpl(ti)">删除</button>
        </div>
        <div class="dt-items">
          <p v-if="!t.items.length" class="dt-empty">这批设备还没有运算——点下方按钮添加,配置会自动套用到全部 {{ tplMatched(t).length }} 台</p>
          <div v-for="(item, ii) in t.items" :key="ii" class="comp-row">
            <span class="tag">{{ TEMPLATES[item.template].name }}</span>
            <span class="desc">{{ tplItemDesc(item) }}</span>
            <button class="btn ghost sm x" @click="openTplItemEdit(ti, ii)">编辑</button>
            <button class="btn ghost sm" @click="removeTplItem(t, ii)">删除</button>
          </div>
          <div class="dt-add">
            <span class="dt-add-label">为这批设备添加:</span>
            <template v-for="(cat, cid) in CATEGORIES" :key="cid">
              <span class="dt-add-cat">{{ cat.name }}</span>
              <button v-for="id in TPL_ALLOWED.filter((x) => TEMPLATES[x].category === cid)" :key="id"
                      class="btn ghost sm" @click="openTpl(id, ti)">
                {{ TEMPLATES[id].name }}
              </button>
            </template>
          </div>
        </div>
      </div>

      </template>

      <div class="way-head clickable" style="margin-top: 26px" @click="wayOpen.w2 = !wayOpen.w2" title="点击折叠/展开">
        <span class="gw-fold">{{ wayOpen.w2 ? '▼' : '▶' }}</span>
        <span class="way-badge alt">方式二</span>
        <h3 class="way-title">单设备运算:逐台精细配置</h3>
        <span v-if="!wayOpen.w2" class="way-fold-sum">{{ computations.length }} 项运算</span>
      </div>
      <template v-if="wayOpen.w2">
      <p class="hint">针对某一台设备(或全站级指标)单独配置。点击卡片、填参数即可,不需要写任何表达式;所有测点都是下拉选择并带中文说明。</p>
      <div class="tpl-list">
        <template v-for="(cat, cid) in CATEGORIES" :key="cid">
          <div class="tpl-list-cat">{{ cat.name }}</div>
          <div v-for="(t, id) in TEMPLATES" :key="id" v-show="t.category === cid"
               class="tpl-row" @click="openTpl(id)" :title="t.desc">
            <span class="tpl-row-name">{{ t.name }}</span>
            <span class="tpl-row-desc">{{ t.desc }}</span>
            <span class="tpl-row-go">添加 →</span>
          </div>
        </template>
      </div>
      </template>

      <!-- 已配置的运算清单:独立于方式二,永不折叠 -->
      <h3 v-if="computations.length" style="font-family: var(--font-display); font-size: 13px; margin: 22px 0 10px">
        已配置的单设备/全站级运算({{ computations.length }} 项)
      </h3>
      <div v-for="(c, i) in computations" :key="i" class="comp-row">
        <span class="tag">{{ TEMPLATES[c.template].name }}</span>
        <span class="desc">{{ compDesc(c) }}</span>
        <button class="btn ghost sm x" @click="openEdit(i)">编辑</button>
        <button class="btn ghost sm" @click="removeComp(i)">删除</button>
      </div>
      <div class="step-foot">
        <span v-if="draftMsg" class="draft-msg">{{ draftMsg }}</span>
        <button class="btn ghost sm" @click="saveDraft(false)">保存草稿</button>
        <button class="btn" @click="saveDraft(true)">保存并进入展示配置 →</button>
      </div>
    </div>

    <!-- 4 组态编辑 -->
    <div v-show="step === 3" class="panel">
      <h2>组态编辑 — 把数据放进页面模板</h2>
      <p class="hint">先选一个页面模板,再点击模板上的空位,为它指定数据源、展示形式和标题。这里只是示意成品结构,不拉实时数据;告警横幅区是模板自带的,触发时自动出现。</p>

      <!-- 菜单栏(页面)管理 -->
      <div class="page-mgr">
        <div class="page-tabs">
          <button v-for="(p, i) in pages" :key="p.id" class="page-tab" :class="{ on: activePage === i }"
                  @click="activePage = i">{{ p.title }}
            <span v-if="pages.length > 1" class="tab-x" title="删除此页面"
                  @click.stop="removePageAt(i)">×</span>
          </button>
          <button class="page-tab add" @click="addPage">＋ 添加页面</button>
        </div>
        <div class="frow" style="margin: 10px 0 0">
          <div class="field"><label>当前页面(菜单)标题</label>
            <input type="text" v-model="curPage.title" style="min-width: 220px" /></div>
          <button class="btn ghost sm" :disabled="pages.length <= 1" @click="removePage"
                  style="align-self: flex-end">删除此页面</button>
        </div>
      </div>

      <div class="tpl-grid" style="grid-template-columns: repeat(2, 1fr)">
        <template v-for="(t, id) in LAYOUT_TEMPLATES" :key="id">
          <div v-if="!t.legacy || curPage.template === id" class="tpl-card"
               :class="{ sel: curPage.template === id }" @click="switchTemplate(id)">
            <div class="t">{{ t.name }}</div>
            <span class="k">{{ t.stats.length ? `${t.stats.length} 指标位 · ` : '' }}{{ t.grid.length }} 图表位{{ t.triple ? ' · 中央主视区预留' : '' }}</span>
            <div class="d">{{ t.desc }}</div>
          </div>
        </template>
      </div>

      <!-- 页面标头 -->
      <div class="frow" style="margin-bottom: 14px">
        <div class="field"><label>大屏标题</label>
          <input type="text" v-model="header.title" :placeholder="site.label || 'GRID·OPS'" style="min-width: 240px" /></div>
        <div class="field"><label>小标题</label>
          <input type="text" v-model="header.subtitle" placeholder="如 一号厂区 · 能源监控" style="min-width: 260px" /></div>
        <div class="field"><label>标头右侧</label>
          <div class="checks" style="padding: 8px 0">
            <label><input type="checkbox" v-model="header.showClock" />显示时间</label>
            <label><input type="checkbox" v-model="header.showDate" />显示日期</label>
          </div>
        </div>
      </div>

      <!-- 模板示意画布 -->
      <div class="mock">
        <div class="mock-head">
          <div style="display: flex; align-items: center; gap: 10px">
            <img src="../assets/img/company-logo.png" alt="" style="height: 26px" />
            <div style="border-left: 1px solid var(--line-1); padding-left: 10px">
              <div class="mh-title">{{ header.title || site.label || '国网电瑞' }}</div>
              <div class="mh-sub">国网电瑞 GWDR · {{ header.subtitle || '微电网监控平台' }}</div>
            </div>
          </div>
          <div class="mh-right">
            <span class="mh-pill">● LIVE</span>
            <span v-if="header.showDate">{{ previewDate }}</span>
            <span v-if="header.showClock">{{ previewClock }}</span>
          </div>
        </div>
        <div v-if="pages.length > 1" class="mock-nav">
          <span v-for="(p, i) in pages" :key="p.id" class="mn-item" :class="{ on: activePage === i }"
                @click="activePage = i">{{ p.title }}</span>
        </div>
        <div class="mock-banner">⚠ 告警横幅区(自动 — 有告警触发时出现在这里)</div>

        <!-- 三栏监控屏示意 -->
        <div v-if="curTpl.triple" class="mock-triple">
          <div class="mt-col">
            <div v-for="sid in curTpl.triple.left" :key="sid" class="mslot" :class="{ filled: slots[sid] }" @click="openSlot(sid)">
              <template v-if="slots[sid]">
                <div class="ms-title">{{ slots[sid].title }}</div>
                <div class="ms-src">{{ slots[sid].card === 'alarmlist' ? '全站告警' : slots[sid].device }} · {{ mockCardCn(slots[sid]) }}</div>
              </template>
              <template v-else><span class="ms-empty">+ 面板</span></template>
            </div>
          </div>
          <div class="mt-col mt-center">
            <div class="mslot mt-reserve">
              <span class="ms-empty">🗺 {{ curTpl.triple.reservedLabel }}</span>
            </div>
            <div v-for="sid in curTpl.triple.center" :key="sid" class="mslot" :class="{ filled: slots[sid] }" @click="openSlot(sid)">
              <template v-if="slots[sid]">
                <div class="ms-title">{{ slots[sid].title }}</div>
                <div class="ms-src">{{ slots[sid].card === 'alarmlist' ? '全站告警' : slots[sid].device }} · {{ mockCardCn(slots[sid]) }}</div>
              </template>
              <template v-else><span class="ms-empty">+ 图表位</span></template>
            </div>
          </div>
          <div class="mt-col">
            <div v-for="sid in curTpl.triple.right" :key="sid" class="mslot" :class="{ filled: slots[sid] }" @click="openSlot(sid)">
              <template v-if="slots[sid]">
                <div class="ms-title">{{ slots[sid].title }}</div>
                <div class="ms-src">{{ slots[sid].card === 'alarmlist' ? '全站告警' : slots[sid].device }} · {{ mockCardCn(slots[sid]) }}</div>
              </template>
              <template v-else><span class="ms-empty">+ 面板</span></template>
            </div>
          </div>
        </div>

        <div v-if="!curTpl.triple" class="mock-stats" :style="{ gridTemplateColumns: `repeat(${curTpl.stats.length}, 1fr)` }">
          <div v-for="sid in curTpl.stats" :key="sid" class="mslot" :class="{ filled: slots[sid] }" @click="openSlot(sid)">
            <template v-if="slots[sid]">
              <div class="ms-title">{{ slots[sid].title }}</div>
              <div class="ms-big" :class="{ al: slots[sid].card === 'alarm' }">
                {{ slots[sid].card === 'alarm' ? '正常' : '88.8' }}
              </div>
              <div class="ms-src">{{ slots[sid].device }} · {{ slots[sid].key }}</div>
            </template>
            <template v-else><span class="ms-empty">+ 指标位</span></template>
          </div>
        </div>
        <div v-if="!curTpl.triple" class="mock-grid">
          <div v-for="g in curTpl.grid" :key="g.id" class="mslot tall"
               :class="{ filled: slots[g.id] }" :style="{ gridColumn: `span ${g.span}` }" @click="openSlot(g.id)">
            <template v-if="slots[g.id]">
              <div class="ms-title">{{ slots[g.id].title }}</div>
              <svg v-if="slots[g.id].card === 'line'" class="ms-art" viewBox="0 0 120 36" preserveAspectRatio="none">
                <polyline points="0,28 15,22 30,26 45,12 60,18 75,8 90,14 105,6 120,10"
                          fill="none" stroke="currentColor" stroke-width="2"/>
              </svg>
              <svg v-else-if="slots[g.id].card === 'bar'" class="ms-art" viewBox="0 0 120 36" preserveAspectRatio="none">
                <rect x="6" y="18" width="10" height="18" fill="currentColor"/>
                <rect x="24" y="10" width="10" height="26" fill="currentColor"/>
                <rect x="42" y="22" width="10" height="14" fill="currentColor"/>
                <rect x="60" y="6" width="10" height="30" fill="currentColor"/>
                <rect x="78" y="14" width="10" height="22" fill="currentColor"/>
                <rect x="96" y="20" width="10" height="16" fill="currentColor"/>
              </svg>
              <svg v-else class="ms-art" viewBox="0 0 120 36">
                <path d="M0 12 H120 M0 24 H120 M30 0 V36 M60 0 V36 M90 0 V36" stroke="currentColor" stroke-width="0.6" opacity="0.4"/>
                <circle cx="60" cy="18" r="5" fill="currentColor"/>
                <circle cx="60" cy="18" r="10" fill="none" stroke="currentColor" opacity="0.5"/>
              </svg>
              <div class="ms-src">{{ slots[g.id].card === 'alarmlist' ? '全站告警' : slots[g.id].device + ' · ' + slots[g.id].key }} · {{ mockCardCn(slots[g.id]) }}</div>
            </template>
            <template v-else><span class="ms-empty">+ 图表位</span></template>
          </div>
        </div>
      </div>
      <p class="hint" style="margin-top: 10px">
        已配置 {{ Object.keys(slots).length }} / {{ curTpl.stats.length + curTpl.grid.length }} 个槽位——留空的槽位发布后不显示。
      </p>
      <div class="step-foot">
        <span v-if="draftMsg" class="draft-msg">{{ draftMsg }}</span>
        <button class="btn ghost sm" @click="saveDraft(false)">保存草稿</button>
        <button class="btn" @click="saveDraft(true)">保存并进入发布 →</button>
      </div>
    </div>

    <!-- 5 发布上线 -->
    <div v-show="step === 4" class="panel">
      <h2>发布上线</h2>
      <p class="hint">一键把配置写入 ThingsBoard(设备核对 → 计算字段 → 聚合链 → 告警链 → 站点配置),完成后自动打开前端站点视图。出错的步骤会标红并显示原因,修正后重新发布即可(所有写入都是幂等的)。</p>

      <div class="frow">
        <div class="field"><label>聚合规则链名称</label><input type="text" v-model="rollupChainName" /></div>
        <button class="btn" :disabled="pub.running" @click="doPublish(true)">
          {{ pub.running ? '发布中…' : '一键发布并打开前端' }}
        </button>
        <button class="btn ghost" :disabled="pub.running" @click="doPublish(false)">仅发布</button>
        <button class="btn ghost" @click="openFrontend">打开前端</button>
        <button v-if="perm.role !== 'field'" class="btn ghost danger" :disabled="pub.running" @click="doCleanup">清理本站点生成物</button>
      </div>
      <p v-if="cleanupMsg" class="ok-msg" style="margin-top: 6px">{{ cleanupMsg }}</p>

      <div class="hist-box">
        <button class="btn ghost sm" @click="loadPubHistory">
          {{ pubHistory.open ? '收起发布历史 ▲' : '发布历史 / 回滚 ▼' }}</button>
        <template v-if="pubHistory.open">
          <p v-if="pubHistory.msg" class="ok-msg" style="margin: 8px 0 0">{{ pubHistory.msg }}</p>
          <div v-for="(h, i) in pubHistory.list" :key="h.ts" class="hist-row">
            <span class="hist-ts">{{ new Date(h.ts).toLocaleString('zh-CN', { hour12: false }) }}</span>
            <span class="hist-by">{{ h.by || '—' }}</span>
            <span class="hist-sum">{{ histSummary(h) }}</span>
            <button class="btn ghost sm" @click="restoreVersion(i)">载入此版本</button>
          </div>
        </template>
      </div>

      <div class="pub-steps">
        <div v-for="s in PUB_STEPS" :key="s.id" class="pub-row" :class="pub.steps[s.id].status">
          <span class="pi">{{ { idle: '·', run: '…', ok: '✓', err: '✗' }[pub.steps[s.id].status] }}</span>
          <span class="pl">{{ s.label }}</span>
          <span class="pd">{{ pub.steps[s.id].detail }}</span>
        </div>
      </div>
      <p v-if="pub.done" class="ok-msg" style="margin-top: 10px">发布完成 — 前端刷新即可看到最新配置。</p>

      <div v-if="pub.failures.length && !pub.running" class="fail-panel">
        <div class="fail-head">
          <span class="fail-title">⚠ {{ pub.failures.length }} 项发布失败</span>
          <span class="fail-hint">其余项已成功;点「重试失败项」只补发失败的部分(所有写入幂等,重试安全)</span>
          <button class="btn sm" @click="retryFailed">重试失败项</button>
        </div>
        <div class="fail-list">
          <div v-for="(f, i) in pub.failures" :key="i" class="fail-row">
            <span class="fail-step">{{ STEP_CN[f.step] || f.step }}</span>
            <span class="fail-what">{{ failureLabel(f) }}</span>
            <span class="fail-err">{{ f.error }}</span>
          </div>
        </div>
      </div>

      <details style="margin-top: 22px">
        <summary style="font-family: var(--font-mono); font-size: 12px; color: var(--ink-2); cursor: pointer">
          高级:导出配置 JSON(交给命令行编译器或存档)
        </summary>
        <div class="frow" style="margin-top: 12px">
          <button class="btn ghost sm" @click="download">下载 {{ site.name }}.tbsite.json</button>
          <button class="btn ghost sm" @click="copyJson">{{ copied ? '已复制 ✓' : '复制到剪贴板' }}</button>
        </div>
        <div class="json-box" style="max-height: 260px">{{ jsonText }}</div>
      </details>
    </div>

    <!-- slot editor modal -->
    <div v-if="slotModal.open" class="modal-mask" @click.self="slotModal.open = false">
      <div class="modal">
        <h3>配置{{ slotModal.zone === 'stat' ? '指标位' : '图表位' }}</h3>
        <p class="d">选择数据源后,展示形式与标题会自动预填,可再调整。</p>
        <div v-if="slotModal.form.card !== 'alarmlist'" class="frow">
          <div class="field" style="flex: 1; min-width: 0"><label>数据源{{ cardNeedsExtra ? '(主测点)' : '' }}</label>
            <KeyPicker v-model="slotModal.form.source" :groups="slotPickerGroups"
                       placeholder="选择要展示的测点…" @change="onSourceChange" />
          </div>
        </div>
        <p v-else class="hint" style="margin-bottom: 10px">告警滚动列表展示全站活动告警,无需选择数据源。</p>
        <template v-if="cardNeedsExtra">
          <div v-for="(e, i) in slotModal.form.extra" :key="i" class="frow" style="margin-bottom: 8px">
            <div class="field" style="flex: 1; min-width: 0">
              <label>{{ slotModal.form.card === 'combo' ? '副轴测点' : `附加测点 ${i + 1}` }}</label>
              <KeyPicker v-model="slotModal.form.extra[i]" :groups="keyExtraGroups" placeholder="选择测点…" />
            </div>
            <button class="btn ghost sm" style="align-self: flex-end" @click="delExtra(i)">移除</button>
          </div>
          <div class="frow" style="margin-bottom: 10px">
            <button class="btn ghost sm" :disabled="slotModal.form.extra.length >= extraLimit" @click="addExtra">
              ＋ {{ slotModal.form.card === 'combo' ? '设置副轴测点' : '添加测点' }}({{ slotModal.form.extra.length }}/{{ extraLimit }})
            </button>
          </div>
        </template>
        <div v-if="slotModal.form.card === 'gauge'" class="frow" style="margin-bottom: 8px">
          <div class="field"><label>量程上限(仪表盘满刻度)</label>
            <input type="text" v-model="slotModal.form.max" placeholder="100" style="min-width: 140px" />
          </div>
        </div>
        <div v-if="srcPreview.state !== 'idle'" class="src-preview" :class="srcPreview.state">
          <template v-if="srcPreview.state === 'loading'">⏳ 读取实时值…</template>
          <template v-else-if="srcPreview.state === 'ok'">
            <span class="spv-label">实时值</span>
            <span class="spv">{{ srcPreview.value }}</span>
            <span class="spu">{{ srcPreview.unit }}</span>
            <span class="spt">{{ previewAge() }}</span>
            <span v-if="previewStale" class="sps">⚠ 数据较旧,设备可能已停止上报</span>
          </template>
          <template v-else-if="srcPreview.state === 'est'">
            <span class="spv-label">预估值</span>
            <span class="spv">{{ srcPreview.value }}</span>
            <span class="sps" style="color: var(--accent)">{{ srcPreview.note }}</span>
          </template>
          <template v-else-if="srcPreview.state === 'empty'">⚠ {{ srcPreview.note }}</template>
          <template v-else-if="srcPreview.state === 'info'">ℹ {{ srcPreview.note }}</template>
        </div>
        <div class="frow">
          <div class="field"><label>展示形式</label>
            <select v-model="slotModal.form.card">
              <option v-for="c in slotCardOptions" :key="c.id" :value="c.id">{{ c.label }}</option>
            </select>
          </div>
          <div class="field"><label>标题</label>
            <input type="text" v-model="slotModal.form.title" placeholder="卡片标题" />
          </div>
        </div>
        <div class="modal-foot">
          <button v-if="slots[slotModal.slotId]" class="btn ghost" @click="clearSlot">清空槽位</button>
          <button class="btn ghost" @click="slotModal.open = false">取消</button>
          <button class="btn" :disabled="!slotModal.form.source && slotModal.form.card !== 'alarmlist'" @click="saveSlot">保存</button>
        </div>
      </div>
    </div>

    <!-- template modal -->
    <div v-if="modal.open" class="modal-mask" @click.self="modal.open = false">
      <div class="modal">
        <h3>{{ modalTpl.name }}</h3>
        <p class="d">{{ modalTpl.desc }}</p>

        <template v-if="modalTpl.kind === 'rollup'">
          <div class="frow">
            <div v-if="modal.target === null" class="field"><label>设备</label>
              <select v-model="modal.form.device">
                <option v-for="d in claimedDevices" :key="d.name" :value="d.name">{{ d.name }}{{ d.desc ? ' · ' + d.desc : '' }}</option>
              </select>
            </div>
            <div v-else class="field"><label>适用范围</label>
              <span class="tpl-scope">{{ deviceTemplates[modal.target].name }} · {{ tplMatched(deviceTemplates[modal.target]).length }} 台匹配设备</span>
            </div>
            <div class="field" v-if="!modalTpl.cascade"><label>周期</label>
              <select v-model="modal.form.window">
                <option v-for="w in WINDOWS" :key="w.id" :value="w.id">{{ w.label }}</option>
              </select>
            </div>
            <div class="field" v-else><label>级联周期</label>
              <span class="tpl-scope">5 分钟 → 1 小时 → 1 天(保留期 7天 / 90天 / 永久)</span>
            </div>
          </div>
          <div v-if="modal.tplId === 'window.aggregate' || modal.tplId === 'window.cascade'" class="frow">
            <div class="field" style="flex: 1; min-width: 0"><label>统计测点(已选 {{ modal.form.keys.length }} / {{ kmAll.length }})</label>
              <div class="key-multi">
                <div class="km-bar">
                  <input type="text" v-model="kmFilter" class="km-q" placeholder="🔍 过滤:测点名 / 中文名…" />
                  <button class="btn ghost sm" @click="kmSelectAll">全选筛选结果</button>
                  <button class="btn ghost sm" @click="modal.form.keys = []">清空</button>
                </div>
                <div class="km-list">
                  <label v-for="k in kmOptions" :key="k.key" class="km-row" :title="kmLabel(k)">
                    <input type="checkbox" :value="k.key" v-model="modal.form.keys" />
                    <span class="km-name">{{ kmLabel(k) }}</span>
                  </label>
                  <div v-if="!kmOptions.length" class="km-empty">无匹配测点</div>
                </div>
              </div>
            </div>
          </div>
          <div v-if="modal.tplId === 'window.aggregate' || modal.tplId === 'window.cascade'" class="frow">
            <div class="field"><label>统计量</label>
              <div class="checks">
                <label v-for="a in AGG_OPTIONS" :key="a.id">
                  <input type="checkbox" :value="a.id" v-model="modal.form.aggs" />{{ a.label }}
                </label>
              </div>
            </div>
          </div>
          <div v-if="modal.tplId === 'window.delta' || modal.tplId === 'window.integrate'" class="frow">
            <div class="field"><label>{{ modal.tplId === 'window.delta' ? '累计测点' : '功率测点' }}</label>
              <select v-if="modal.target === null" v-model="modal.form.key">
                <option v-for="k in modalDeviceKeys" :key="k.key" :value="modal.form.device + '||' + k.key">{{ k.key }}{{ k.cn ? ' · ' + k.cn : '' }}</option>
              </select>
              <select v-else v-model="modal.form.key">
                <option v-for="k in tplKeyOptions" :key="k.key" :value="k.key">{{ k.label }}</option>
              </select>
            </div>
          </div>
        </template>

        <template v-else-if="modalTpl.kind === 'revenue'">
          <div class="frow">
            <div class="field"><label>统计名称</label>
              <input type="text" v-model="modal.form.aggName" placeholder="如 基站1储能收益" style="min-width: 260px" />
            </div>
            <div class="field"><label>统计周期(正式建议 1 小时)</label>
              <select v-model="modal.form.window">
                <option v-for="w in WINDOWS" :key="w.id" :value="w.id">{{ w.label }}</option>
              </select>
            </div>
          </div>
          <div class="frow">
            <div class="field"><label>累计充电量测点 (kWh)</label>
              <KeyPicker v-model="modal.form.chargeRef" :groups="keyPickerGroups" placeholder="选择测点…" />
            </div>
            <div class="field"><label>累计放电量测点 (kWh)</label>
              <KeyPicker v-model="modal.form.dischargeRef" :groups="keyPickerGroups" placeholder="选择测点…" />
            </div>
          </div>
          <div class="frow">
            <div class="field"><label>电价配置资产(24 小时 electricityPrice)</label>
              <div style="display: flex; gap: 8px; align-items: center">
                <input type="text" v-model="modal.form.priceAsset" style="min-width: 250px" />
                <button class="btn ghost sm" @click="openPriceEditor(modal.form.priceAsset)">查看 / 编辑电价</button>
              </div>
              <div class="fhint">全站共用一份分时电价;点右侧按钮可直接查看和修改 24 个时段的电价(元/kWh)</div>
            </div>
            <div class="field"><label>目标资产名 (英文)</label>
              <input type="text" v-model="modal.form.asset" placeholder="如 RT_REVENUE_BS1" style="min-width: 220px" />
            </div>
          </div>
          <p class="hint" style="margin: 4px 0 0">输出三个测点:净收益(输出名)、收入(输出名Income)、成本(输出名Cost),单位随电价(元)。</p>
        </template>

        <template v-else-if="modalTpl.kind === 'agg'">
          <div class="frow">
            <div class="field"><label>汇聚名称</label>
              <input type="text" v-model="modal.form.aggName" placeholder="如 全站总有功功率" style="min-width: 260px" />
            </div>
          </div>
          <div class="frow">
            <div class="field"><label>成员设备类型(可多选)</label>
              <div class="checks">
                <label v-for="p in claimedProfiles" :key="p">
                  <input type="checkbox" :value="p" v-model="modal.form.selProfiles" />{{ p }}
                </label>
              </div>
            </div>
          </div>
          <div class="frow">
            <div class="field"><label>名称前缀(可多个,逗号分隔,可留空)</label>
              <input type="text" v-model="modal.form.selPrefixes" placeholder="如 PDR1_, SSP2_" style="min-width: 260px" />
            </div>
            <span class="dt-match" style="align-self: center">匹配 {{ aggMatched.length }} 台</span>
          </div>
          <div class="frow">
            <div class="field"><label>源测点(各成员的同名测点)</label>
              <select v-model="modal.form.key">
                <option v-for="k in aggKeyOptions" :key="k.key" :value="k.key">{{ k.label }}</option>
              </select>
            </div>
            <div class="field"><label>聚合方式</label>
              <select v-model="modal.form.agg">
                <option value="sum">求和 Σ</option>
                <option value="avg">平均</option>
              </select>
            </div>
          </div>
          <div class="frow">
            <div class="field"><label>目标资产名 (英文)</label>
              <input type="text" v-model="modal.form.asset" placeholder="如 RT_TOTAL_LOAD_POWER" style="min-width: 260px" />
            </div>
          </div>
          <p class="hint" style="margin: 4px 0 0">结果实时计算并存为该资产的遥测测点;超过 10 台成员时自动分组分层求和(上限 40 台)。</p>
        </template>

        <template v-else-if="modalTpl.custom">
          <div v-for="(t, i) in modal.form.terms" :key="i" class="frow" style="align-items: center">
            <select v-if="i > 0" v-model="modal.form.termOps[i - 1]" style="min-width: 64px">
              <option v-for="o in EXPR_OPS" :key="o" :value="o">{{ OP_SHOW[o] }}</option>
            </select>
            <span v-else style="width: 64px"></span>
            <KeyPicker v-model="t.src" :groups="keyPickerGroups" style="min-width: 300px"
                       :topItems="[{ value: '__const__', label: '【常数】' }]" placeholder="选择测点…" />
            <input v-if="t.src === '__const__'" type="text" v-model="t.constVal"
                   placeholder="如 3 或 0.001" style="min-width: 110px" />
            <label v-if="t.src && t.src !== '__const__'" class="abs-check">
              <input type="checkbox" v-model="t.abs" />|绝对值|
            </label>
            <button class="btn ghost sm" :disabled="modal.form.terms.length <= 2" @click="removeTerm(i)">−</button>
          </div>
          <div class="frow">
            <button class="btn ghost sm" @click="addTerm">+ 添加一项</button>
          </div>
          <div class="frow">
            <div class="field" style="min-width: 100%">
              <label>表达式预览(从左到右依次计算)</label>
              <div class="expr-preview">{{ exprPreview }}</div>
            </div>
          </div>
        </template>

        <template v-else>
          <div v-for="p in modalTpl.params" :key="p.id" class="frow">
            <div class="field"><label>{{ p.label }}</label>
              <KeyPicker v-if="p.type === 'key' && modal.target === null" v-model="modal.form[p.id]"
                         :groups="keyPickerGroups" placeholder="选择测点…" />
              <select v-else-if="p.type === 'key'" v-model="modal.form[p.id]">
                <option v-for="k in tplKeyOptions" :key="k.key" :value="k.key">{{ k.label }}</option>
              </select>
              <select v-else-if="p.type === 'alarmOp'" v-model="modal.form.op">
                <option v-for="o in ALARM_OPS" :key="o.id" :value="o.id">{{ o.label }}</option>
              </select>
              <select v-else-if="p.type === 'severity'" v-model="modal.form.severity">
                <option v-for="s in ALARM_SEVERITIES" :key="s.id" :value="s.id">{{ s.label }}</option>
              </select>
              <template v-else-if="p.type === 'trigger'">
                <select v-model="modal.form.trigger" style="min-width: 300px">
                  <option v-for="t in ALARM_TRIGGERS" :key="t.id" :value="t.id">{{ t.label }}</option>
                </select>
                <div class="fhint">「持续」适合越限监视;「变化才报」适合开关/状态量,只在翻转瞬间动作,不会刷屏</div>
              </template>
              <template v-else-if="p.type === 'alarmName'">
                <input type="text" v-model="modal.form.alarmName"
                       placeholder="如 电压越限告警" style="min-width: 260px" />
                <div class="fhint">告警的名字,会显示在大屏横幅和告警列表里</div>
              </template>
              <template v-else-if="p.type === 'number'">
                <input type="text" v-model="modal.form.value" placeholder="如 250" />
                <div class="fhint">数字阈值;开关量(等于/不等于)一般填 1 或 0</div>
              </template>
              <template v-else-if="p.type === 'text'">
                <input type="text" v-model="modal.form.message"
                       placeholder="如 A相电压越限:{value} V,请检查" style="min-width: 320px" />
                <div class="fhint">触发时显示的提示文字,写 {value} 会自动替换成实际数值</div>
              </template>
            </div>
          </div>
        </template>

        <div v-if="modalTpl.needsOutput" class="frow">
          <div class="field"><label>输出测点名 (英文)</label>
            <input type="text" v-model="modal.form.output" placeholder="如 netPower" />
            <div class="fhint">计算结果保存成的新测点名,用英文字母/数字,如 netPower(净功率)</div>
          </div>
          <div v-if="modalTpl.kind === 'cf'" class="field"><label>输出存为</label>
            <select v-model="modal.form.outputMode">
              <option value="ts">遥测(可画曲线,默认)</option>
              <option value="attr">服务端属性(状态/参数值)</option>
            </select>
          </div>
        </div>
        <div v-if="modalTpl.fixedOutput" class="frow">
          <div class="field"><label>输出测点名</label><input type="text" :value="modalTpl.fixedOutput" disabled /></div>
        </div>

        <div class="modal-foot">
          <button class="btn ghost" @click="modal.open = false">取消</button>
          <button class="btn" :disabled="!modalValid" @click="addComputation">
            {{ modal.editIndex !== null ? '保存修改' : '添加' }}
          </button>
        </div>
      </div>
    </div>

    <!-- 电价配置编辑 -->
    <div v-if="priceModal.open" class="modal-mask" @click.self="priceModal.open = false">
      <div class="modal" style="width: min(640px, 94vw)">
        <h3>分时电价配置 — {{ priceModal.asset }}</h3>
        <p class="d">24 个时段的电价(元/kWh),0 时段 = 0:00–1:00,以此类推。收益统计按东八区时段取价。</p>
        <div class="price-fill">
          <span>批量填充:</span>
          <select v-model.number="priceModal.fillFrom">
            <option v-for="h in 24" :key="'f' + h" :value="h - 1">{{ h - 1 }} 时</option>
          </select>
          <span>至</span>
          <select v-model.number="priceModal.fillTo">
            <option v-for="h in 24" :key="'t' + h" :value="h - 1">{{ h - 1 }} 时</option>
          </select>
          <input type="text" v-model="priceModal.fillVal" placeholder="如 0.6526" style="width: 100px" />
          <button class="btn ghost sm" @click="fillPriceRange">应用</button>
          <span class="fhint" style="margin: 0">先填谷段,再覆盖峰/平段,几下就填完</span>
        </div>
        <div class="price-grid">
          <div v-for="(p, h) in priceModal.prices" :key="h" class="price-cell">
            <label>{{ h }} 时</label>
            <input type="text" v-model="priceModal.prices[h]"
                   :class="{ bad: p !== '' && isNaN(Number(p)) }" placeholder="—" />
          </div>
        </div>
        <p v-if="priceModal.msg" class="ok-msg" style="margin-top: 8px">{{ priceModal.msg }}</p>
        <div class="modal-foot">
          <button class="btn ghost" @click="priceModal.open = false">关闭</button>
          <button class="btn" :disabled="!pricesValid" @click="savePrices">保存电价</button>
        </div>
      </div>
    </div>

    <!-- 设备模板选择器编辑 -->
    <div v-if="tplMgr.open" class="modal-mask" @click.self="tplMgr.open = false">
      <div class="modal">
        <h3>{{ tplMgr.editIndex !== null ? '编辑设备模板' : '新建设备模板' }}</h3>
        <p class="d">用设备类型和/或名称前缀圈定一批同类设备。两者都填时须同时满足。</p>
        <div class="frow">
          <div class="field"><label>模板名称</label>
            <input type="text" v-model="tplMgr.name" placeholder="如 IED 三相电压监控" style="min-width: 280px" />
          </div>
        </div>
        <div class="frow">
          <div class="field"><label>设备类型(可多选)</label>
            <div class="checks">
              <label v-for="p in claimedProfiles" :key="p">
                <input type="checkbox" :value="p" v-model="tplMgr.profiles" />{{ p }}
              </label>
              <span v-if="!claimedProfiles.length" class="dt-sel">请先在第 2 步认领设备</span>
            </div>
          </div>
        </div>
        <div class="frow">
          <div class="field"><label>名称前缀(可多个,逗号分隔)</label>
            <input type="text" v-model="tplMgr.prefixes" placeholder="如 PDR1_, SSP2_" style="min-width: 280px" />
          </div>
        </div>
        <div class="frow">
          <span class="dt-match">
            当前匹配:{{ tplMatched({ selector: { profiles: tplMgr.profiles,
              prefixes: tplMgr.prefixes.split(/[,,\s]+/).filter(Boolean) } }).length }} 台已认领设备
          </span>
        </div>
        <div class="modal-foot">
          <button class="btn ghost" @click="tplMgr.open = false">取消</button>
          <button class="btn" :disabled="!tplMgr.name.trim() || (!tplMgr.profiles.length && !tplMgr.prefixes.trim())"
                  @click="saveTplMgr">{{ tplMgr.editIndex !== null ? '保存' : '创建' }}</button>
        </div>
      </div>
    </div>

    <!-- 通用确认弹窗(可带输入框) -->
    <div v-if="confirmBox.open" class="modal-mask confirm-mask" @click.self="confirmAnswer(false)">
      <div class="modal confirm-modal">
        <h3>{{ confirmBox.danger ? '⚠ ' : '' }}{{ confirmBox.title }}</h3>
        <p class="confirm-text">{{ confirmBox.text }}</p>
        <input v-if="confirmBox.input" v-model="confirmBox.value" type="text" class="confirm-input"
               :placeholder="confirmBox.placeholder" @keyup.enter="confirmAnswer(true)" />
        <div class="modal-foot">
          <button class="btn ghost" @click="confirmAnswer(false)">取消</button>
          <button class="btn" :class="{ danger: confirmBox.danger }" @click="confirmAnswer(true)">{{ confirmBox.okLabel }}</button>
        </div>
      </div>
    </div>

    <!-- 新项目(自定义 TB 环境)弹窗 -->
    <div v-if="envModal.open" class="modal-mask confirm-mask" @click.self="envModal.open = false">
      <div class="modal confirm-modal">
        <h3>{{ envModal.editId ? '编辑项目' : '新项目' }}</h3>
        <p class="confirm-text">录入项目名称与 ThingsBoard 地址,保存后在环境下拉中随时可选(保存在本机浏览器)。</p>
        <div class="field" style="margin-bottom: 10px"><label>项目名称</label>
          <input type="text" v-model="envModal.name" placeholder="如:仙人山二期" /></div>
        <div class="field"><label>TB 地址</label>
          <input type="text" v-model="envModal.addr" placeholder="http://192.168.1.100:8080" @keyup.enter="saveEnvModal" /></div>
        <p v-if="envModal.msg" class="err-msg" style="margin-top: 8px">{{ envModal.msg }}</p>
        <div class="modal-foot">
          <button class="btn ghost" @click="envModal.open = false">取消</button>
          <button class="btn" @click="saveEnvModal">保存</button>
        </div>
      </div>
    </div>
  </div>
</template>
