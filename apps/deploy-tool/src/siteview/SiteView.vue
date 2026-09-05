<script setup>
// 配置驱动的站点视图:读取编译器发布到 TB 的 siteConfig 资产属性,按 display 清单动态渲染。
import { computed, onMounted, onUnmounted, provide, reactive, ref } from 'vue'
import {
  login,
  getDevices,
  getHistory,
  getToken,
  API_BASE,
  PUBLIC_ID,
  kzRevenueTrend,
  reportAuth,
  getCustomerDevices,
} from '../api/tb'
import { store, seedHistory, connect } from '../composables/useTelemetry'
import StatTile from '../components/StatTile.vue'
import LineChart from '../components/LineChart.vue'
import VehicleMap from '../components/VehicleMap.vue'
import GaugeArc from '../components/GaugeArc.vue'
import SlotCard from '../components/SlotCard.vue'
import { LAYOUT_TEMPLATES } from '../shared/layoutTemplates.js'
import brandLogo from '../assets/img/company-logo.png'

const PALETTE = ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#9085e9']

const state = ref('boot')
const errMsg = ref('')
const cfg = ref(null)

// 报表数据(kzserver):stationId → {mode:'day'|'month', inc/cost/net: [[ts,v]...], latestNet}
// mode=month 表示本月尚无逐日归档,已降级为本年逐月视图
const reportData = ref({})
async function loadReports() {
  const slots = pagesList.value.flatMap(p => Object.values(p.slots || {})).filter(s => s.kind === 'report')
  for (const sid of [...new Set(slots.map(s => s.device))]) {
    try {
      const { mode, rows } = await kzRevenueTrend(sid)
      const ts = d => new Date(d + 'T00:00:00+08:00').getTime()
      reportData.value[sid] = {
        mode,
        inc: rows.map(r => [ts(r.statDate), r.dischargeIncome]),
        cost: rows.map(r => [ts(r.statDate), r.chargeCost]),
        net: rows.map(r => [ts(r.statDate), r.netProfit]),
        latestNet: rows.length ? rows[rows.length - 1].netProfit : null,
      }
    } catch (e) {
      console.warn('报表加载失败', sid, e)
    }
  }
}

const d = name => store.byName[name] || { latest: {}, series: {} }
const latest = (name, key) => d(name).latest[key]
const series = (name, key) => d(name).series[key] || []

function meta(device, key) {
  const dev = (cfg.value?.devices || []).find(x => x.name === device)
  const k = dev?.keys?.find(x => x.key === key)
  return { label: k?.label && k.label !== key ? k.label : key, unit: k?.unit || '' }
}

const items = computed(() => (cfg.value?.display || []).filter(i => i.card !== 'none' && i.kind !== 'alarm'))

/* ── 页面标头(组态配置) ── */
const hdr = computed(() => cfg.value?.layout?.header || {})
const pageTitle = computed(() => hdr.value.title || cfg.value?.site?.label || 'GRID·OPS')
const showClock = computed(() => hdr.value.showClock !== false)
const clock = ref('')
const dateStr = ref('')
let clockTimer = null
function tickClock() {
  const now = new Date()
  clock.value = now.toLocaleTimeString('zh-CN', { hour12: false })
  dateStr.value = now.toLocaleDateString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
  })
}
tickClock()
clockTimer = setInterval(tickClock, 1000)
onUnmounted(() => clearInterval(clockTimer))

/* ── 组态布局(layout 存在时优先;支持多页面菜单栏) ── */
const pagesList = computed(() => {
  const L = cfg.value?.layout
  if (L?.pages?.length) return L.pages.filter(p => LAYOUT_TEMPLATES[p.template])
  if (L?.template && LAYOUT_TEMPLATES[L.template])
    return [{ id: 'p1', title: '总览', template: L.template, slots: L.slots || {} }]
  return []
})
const curPageIdx = ref(0)
const layoutT = computed(() => LAYOUT_TEMPLATES[pagesList.value[curPageIdx.value]?.template] || null)
const layoutSlots = computed(() => pagesList.value[curPageIdx.value]?.slots || {})
const hasLayout = computed(() => !!layoutT.value && Object.keys(layoutSlots.value).length > 0)
const layoutStats = computed(() => (layoutT.value?.stats || []).map(id => layoutSlots.value[id]).filter(Boolean))
const layoutGrid = computed(() =>
  (layoutT.value?.grid || []).map(g => ({ ...g, slot: layoutSlots.value[g.id] })).filter(x => x.slot)
)
const alarmEntryByName = name => activeAlarms.value.find(x => x.name === name) || null
const statItems = computed(() => items.value.filter(i => i.card === 'stat' || i.card === 'badge'))
const chartItems = computed(() => items.value.filter(i => i.card === 'line' || i.card === 'bar'))
const mapDevices = computed(() => [...new Set(items.value.filter(i => i.card === 'map').map(i => i.device))])

const colorOf = i => PALETTE[i % PALETTE.length]

/* ── alarms ── */
const alarmDecls = computed(() =>
  (cfg.value?.computations || [])
    .filter(c => c.template === 'alarm.threshold')
    .map(c => ({ ...c, name: c.name || `${c.key} 阈值告警` }))
)
// 每条告警的呈现方式来自展示配置(banner / badge / none),默认横幅
const alarmCardOf = name => {
  const item = (cfg.value?.display || []).find(i => i.kind === 'alarm' && i.key === name)
  return item ? item.card : 'banner'
}
const activeAlarms = ref([])
const devIdByName = {}
const devTokByName = {} // 设备名 → 取数 token(null=Public;报表账号设备需带其 token)
let alarmTimer = null

async function pollAlarms() {
  const devNames = [...new Set(alarmDecls.value.map(a => a.device))]
  const byType = Object.fromEntries(alarmDecls.value.map(a => [a.name, a]))
  const out = []
  for (const name of devNames) {
    const id = devIdByName[name]
    if (!id) continue
    try {
      const page = await api(`/api/alarm/DEVICE/${id}?pageSize=20&page=0&searchStatus=ACTIVE`, devTokByName[name])
      for (const al of page.data) {
        const decl = byType[al.type]
        if (!decl) continue // 只展示本站点声明的告警,忽略平台上其他链的存量告警
        out.push({
          name: al.type,
          device: name,
          key: al.details?.key || decl?.key || '',
          severity: al.severity,
          message: al.details?.message || al.type,
          value: al.details?.value,
          since: al.startTs,
        })
      }
    } catch {
      /* 单设备查询失败不影响整体 */
    }
  }
  activeAlarms.value = out
}

const bannerAlarms = computed(() => activeAlarms.value.filter(a => alarmCardOf(a.name) === 'banner'))
const alarmBadges = computed(() =>
  alarmDecls.value
    .filter(a => alarmCardOf(a.name) === 'badge')
    .map(a => {
      const entry = activeAlarms.value.find(x => x.name === a.name)
      return { ...a, activeEntry: entry || null }
    })
)
const alarmedKeys = computed(
  () => new Set(activeAlarms.value.filter(a => alarmCardOf(a.name) !== 'none').map(a => `${a.device}||${a.key}`))
)
const isAlarming = (device, key) => alarmedKeys.value.has(`${device}||${key}`)
const sinceText = ts => {
  const m = Math.max(0, Math.round((Date.now() - ts) / 60000))
  return m < 1 ? '刚刚' : m < 60 ? `${m} 分钟前` : `${Math.floor(m / 60)} 小时前`
}
onUnmounted(() => clearInterval(alarmTimer))

async function api(url, tok = null) {
  const r = await fetch(API_BASE + url, { headers: { 'X-Authorization': `Bearer ${tok || getToken()}` } })
  if (!r.ok) throw new Error(`${url} → HTTP ${r.status}`)
  return r.json()
}

/* ── 历史窗口按测点周期自适应:5/15分钟级取 1 天,小时级取 7 天,
   天级/日累计取 90 天;普通实时测点维持 折线 15 分钟 / 柱状 3 小时 ── */
const historyMinutes = (key, card) => {
  if (/Daily$/.test(key) || /1d$/.test(key)) return 90 * 1440
  if (/1h$/.test(key)) return 7 * 1440
  if (/(5m|15m)$/.test(key)) return 1440
  return card === 'bar' ? 180 : 15
}

/* 给一批实体铺历史 + 开 WS + 注册告警取数映射(tok=null 走 Public) */
async function addEntities(ents, tok) {
  if (!ents.length) return
  await Promise.all(
    ents.map(async ent => {
      const items = chartItems.value.filter(i => i.device === ent.name)
      const byWin = {}
      for (const i of items) (byWin[historyMinutes(i.key, i.card)] ||= []).push(i.key)
      for (const [mins, keys] of Object.entries(byWin))
        seedHistory(ent.name, await getHistory(ent.id.id, [...new Set(keys)], Number(mins), ent.entityType, ent.tok))
    })
  )
  connect(ents, tok)
  ents.forEach(e => {
    if (e.entityType === 'DEVICE') {
      devIdByName[e.name] = e.id.id
      devTokByName[e.name] = e.tok
    }
  })
}

/* ── 前端鉴权兜底:配置里的设备既不属于 Public 也不在报表账号名下时
   (如未划客户的租户设备),提示登录——用登录 token 补齐取数。
   第 4 步预览用租户 token 所以总能看到;大屏匿名身份看不到即属此类。 ── */
const authNeed = ref([]) // 仍缺数据来源的设备名
const dataGaps = ref([]) // 实体已解析但迟迟无任何数据的槽位 [{device,key}]
const viewTok = ref(null) // 鉴权登录后的 token(null=未登录)
const authPanel = reactive({ open: false, user: '', pass: '', remember: true, busy: false, msg: '' })

/* 就绪后延时扫描:任何展示槽位既无最新值也无历史序列 → 记为数据缺口。
   未登录时提示登录(可能是权限);已登录仍缺 → 多半是设备未上报。 */
function allDisplaySlots() {
  const out = []
  for (const p of pagesList.value)
    for (const s of Object.values(p.slots || {}))
      if (s.kind !== 'report' && s.kind !== 'alarm' && s.card !== 'map' && s.device && s.key)
        out.push({ device: s.device, key: s.key })
  for (const i of items.value) if (i.card !== 'map' && i.kind !== 'report') out.push({ device: i.device, key: i.key })
  return out
}
function scanGaps() {
  const seen = new Set()
  const gaps = []
  for (const s of allDisplaySlots()) {
    const id = `${s.device}||${s.key}`
    if (seen.has(id)) continue
    seen.add(id)
    const v = latest(s.device, s.key)
    if ((v === undefined || v === null || v === '') && !series(s.device, s.key).length) gaps.push(s)
  }
  dataGaps.value = gaps
}
const LS_VIEW = `gridops_view_login_${API_BASE || 'demo'}`
async function viewLogin() {
  if (!authPanel.user.trim() || !authPanel.pass) {
    authPanel.msg = '请输入账号密码'
    return
  }
  authPanel.busy = true
  authPanel.msg = ''
  try {
    const r = await fetch(`${API_BASE}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: authPanel.user.trim(), password: authPanel.pass }),
    })
    if (!r.ok) throw new Error('账号或密码不正确')
    const tok = (await r.json()).token
    const found = []
    // 目标 = 完全解析不到的设备 + 数据缺口槽位所在设备
    const targets = [...new Set([...authNeed.value, ...dataGaps.value.map(s => s.device)])]
    // 租户账号:按设备名精确取
    for (const n of targets) {
      try {
        const d = await api(`/api/tenant/devices?deviceName=${encodeURIComponent(n)}`, tok)
        if (d?.id) found.push({ name: d.name, id: d.id, entityType: 'DEVICE', tok })
      } catch {
        /* 查不到或无权限则走客户回退 */
      }
    }
    // 客户账号回退:列它名下设备匹配
    if (found.length < targets.length) {
      try {
        const u = await api('/api/auth/user', tok)
        if (u.customerId?.id) {
          const extra = await getCustomerDevices(u.customerId.id, tok)
          for (const x of extra)
            if (targets.includes(x.name) && !found.some(f => f.name === x.name))
              found.push({ name: x.name, id: x.id, entityType: 'DEVICE', tok })
        }
      } catch {
        /* 忽略 */
      }
    }
    if (!found.length && authNeed.value.length) {
      authPanel.msg = '该账号也看不到这些设备,请换有权限的账号'
      return
    }
    viewTok.value = tok
    await addEntities(found, tok)
    authNeed.value = authNeed.value.filter(n => !found.some(f => f.name === n))
    try {
      if (authPanel.remember)
        localStorage.setItem(
          LS_VIEW,
          btoa(
            unescape(
              encodeURIComponent(JSON.stringify({ u: authPanel.user.trim(), p: authPanel.pass, ts: Date.now() }))
            )
          )
        )
    } catch {
      /* 存储不可用时静默 */
    }
    authPanel.open = authNeed.value.length > 0
    if (!authPanel.open) authPanel.pass = ''
    setTimeout(scanGaps, 6000) // 登录补数后复查缺口
  } catch (e) {
    authPanel.msg = String(e.message || e)
  } finally {
    authPanel.busy = false
  }
}
/* 静默重放已保存的登录(30 天) */
async function tryAutoViewLogin() {
  try {
    const raw = localStorage.getItem(LS_VIEW)
    if (!raw) return
    const s = JSON.parse(decodeURIComponent(escape(atob(raw))))
    if (Date.now() - s.ts > 30 * 86400000) {
      localStorage.removeItem(LS_VIEW)
      return
    }
    authPanel.user = s.u
    authPanel.pass = s.p
    await viewLogin()
  } catch {
    /* 自动登录失败则显示登录条 */
  }
}

onMounted(async () => {
  try {
    await login()
    // 1. 找到公开的站点资产,读 siteConfig
    const params = new URLSearchParams(location.search)
    const wantName = params.get('site')
    const assets = (await api(`/api/customer/${PUBLIC_ID}/assets?pageSize=50&page=0`)).data
    const asset = assets.find(a => (wantName ? a.name === wantName : a.type === 'tbsite'))
    if (!asset) throw new Error('未找到公开的站点资产(先用编译器发布一次站点)')
    const attrs = await api(
      `/api/plugins/telemetry/ASSET/${asset.id.id}/values/attributes/SERVER_SCOPE?keys=siteConfig`
    )
    const sc = attrs.find(a => a.key === 'siteConfig')
    if (!sc) throw new Error('站点资产上没有 siteConfig 属性')
    cfg.value = sc.value

    // 2. 匹配设备 + 全站汇聚资产,铺历史,开 WS
    // 双身份:Public 客户覆盖工具资产与公开设备;报表账号(客户账号的 CUSTOMER_USER)
    // 覆盖划归真实客户的设备(BS_*/RY_* 等)——TB 里设备只归一个客户,Public 看不见它们
    const all = await getDevices()
    const names = new Set(cfg.value.devices.map(x => x.name))
    const devices = all.filter(x => names.has(x.name))
    const entities = devices.map(x => ({ name: x.name, id: x.id, entityType: 'DEVICE', tok: null }))
    let repTok = null
    try {
      const missing = [...names].filter(n => !entities.some(e => e.name === n))
      if (missing.length) {
        const rep = await reportAuth()
        if (rep) {
          repTok = rep.token
          const extra = await getCustomerDevices(rep.customerId, rep.token)
          for (const x of extra)
            if (names.has(x.name) && !entities.some(e => e.name === x.name))
              entities.push({ name: x.name, id: x.id, entityType: 'DEVICE', tok: repTok })
        }
      }
    } catch (e) {
      console.warn('报表账号设备补充失败', e)
    }
    for (const c of (cfg.value.computations || []).filter(x =>
      ['aggregate.crossEntity', 'revenue.periodic'].includes(x.template)
    )) {
      const a = assets.find(x => x.name === c.asset)
      if (a && !entities.some(e => e.name === c.asset))
        entities.push({ name: c.asset, id: a.id, entityType: 'ASSET', tok: null })
    }
    await addEntities(
      entities.filter(e => !e.tok),
      null
    )
    await addEntities(
      entities.filter(e => e.tok),
      repTok
    )
    // 双身份仍覆盖不到的设备 → 前端鉴权兜底(先静默重放已保存登录,失败再显示登录条)
    authNeed.value = [...names].filter(n => !entities.some(e => e.name === n))
    if (authNeed.value.length) {
      await tryAutoViewLogin()
      if (authNeed.value.length) authPanel.open = true
    }
    if (alarmDecls.value.length) {
      pollAlarms()
      alarmTimer = setInterval(pollAlarms, 10000)
    }
    loadReports()
    setInterval(loadReports, 10 * 60 * 1000)
    state.value = 'ready'
    setTimeout(scanGaps, 8000) // 留出 WS 首批数据时间再扫描数据缺口
  } catch (e) {
    state.value = 'error'
    errMsg.value = String(e.message || e)
  }
})

const fmt = (v, n = 1) => (typeof v === 'number' ? v.toFixed(n) : (v ?? '—'))

/* ── 三栏监控屏(monitor3)分栏槽位 ── */
const tripleCols = computed(() => {
  const t = layoutT.value?.triple
  if (!t) return null
  const pick = ids => ids.map(id => ({ id, slot: layoutSlots.value[id] })).filter(x => x.slot)
  return { left: pick(t.left), center: pick(t.center), right: pick(t.right), reservedLabel: t.reservedLabel }
})

/* SlotCard 上下文注入(取数/元数据都走本视图的函数) */
provide('slotCtx', {
  latest,
  series,
  meta,
  fmt,
  reportData,
  activeAlarms,
  isAlarming,
  palette: PALETTE,
  sinceText,
})
</script>

<template>
  <div class="shell">
    <div class="fx-aurora"></div>
    <div class="fx-sweep"></div>
    <header class="topbar">
      <div class="brand-co">
        <img class="brand-logo" :src="brandLogo" alt="国网电瑞" />
        <div class="brand-co-text">
          <span class="brand-co-name">国网电瑞</span>
          <span class="brand-co-sub">GWDR POWER TECHNOLOGY</span>
        </div>
      </div>
      <span class="brand-divider"></span>
      <div class="brand">
        <span class="brand-mark">{{ pageTitle }}</span>
        <span class="brand-sub">{{
          hdr.subtitle || (cfg?.site?.label !== pageTitle && cfg?.site?.label) || 'Config-Driven'
        }}</span>
      </div>
      <div class="topbar-right">
        <span class="live-pill" :class="store.status"
          ><span class="live-dot"></span>{{ store.status.toUpperCase() }}</span
        >
        <span v-if="hdr.showDate">{{ dateStr }}</span>
        <span v-if="showClock">{{ clock }}</span>
      </div>
    </header>

    <div v-if="state === 'boot'" class="boot">LOADING SITE CONFIG…</div>
    <div v-else-if="state === 'error'" class="boot">
      <span class="err">{{ errMsg }}</span>
    </div>

    <template v-else>
      <!-- 前端鉴权兜底:设备解析不到 或 指标位无数据 时提示登录 -->
      <section v-if="authNeed.length || (dataGaps.length && !viewTok)" class="auth-note">
        <template v-if="!authPanel.open">
          <span class="an-text"
            >🔐
            <template v-if="authNeed.length"
              >{{ authNeed.length }} 台设备需要登录后才能显示数据({{ authNeed.slice(0, 3).join('、')
              }}{{ authNeed.length > 3 ? '…' : '' }})</template
            >
            <template v-else
              >{{ dataGaps.length }} 个指标位暂无数据({{
                dataGaps
                  .slice(0, 3)
                  .map(s => s.device + '·' + s.key)
                  .join('、')
              }}{{ dataGaps.length > 3 ? '…' : '' }})——若属权限受限设备,登录后可显示</template
            >
          </span>
          <button class="an-btn" @click="authPanel.open = true">登录</button>
          <button v-if="!authNeed.length" class="an-btn" @click="scanGaps">重新检测</button>
        </template>
        <template v-else>
          <span class="an-text">🔐 用有权限的 TB 账号登录以补齐数据:</span>
          <input v-model="authPanel.user" class="an-input" type="text" placeholder="账号" />
          <input
            v-model="authPanel.pass"
            class="an-input"
            type="password"
            placeholder="密码"
            @keyup.enter="viewLogin"
          />
          <label class="an-rem"><input type="checkbox" v-model="authPanel.remember" />记住 30 天</label>
          <button class="an-btn" :disabled="authPanel.busy" @click="viewLogin">
            {{ authPanel.busy ? '登录中…' : '登录' }}
          </button>
          <span v-if="authPanel.msg" class="an-err">{{ authPanel.msg }}</span>
        </template>
      </section>
      <!-- 已登录但仍有缺口:与权限无关,多半是设备未上报 -->
      <section v-else-if="dataGaps.length && viewTok" class="auth-note quiet">
        <span class="an-text"
          >ℹ️ 已登录,仍有 {{ dataGaps.length }} 个指标位无数据({{
            dataGaps
              .slice(0, 3)
              .map(s => s.device + '·' + s.key)
              .join('、')
          }}{{ dataGaps.length > 3 ? '…' : '' }})——测点可能未上报或键名有变</span
        >
        <button class="an-btn" @click="scanGaps">重新检测</button>
      </section>

      <section v-if="bannerAlarms.length" class="alarm-banner">
        <div v-for="a in bannerAlarms" :key="a.name" class="alarm-row" :class="a.severity.toLowerCase()">
          <span class="al-dot"></span>
          <span class="al-sev">{{
            { CRITICAL: '严重', WARNING: '警告', MINOR: '提示' }[a.severity] || a.severity
          }}</span>
          <span class="al-msg"
            ><b>{{ a.name }}</b> — {{ a.message }}</span
          >
          <span class="al-meta">{{ a.device }} · {{ a.key }} = {{ fmt(a.value) }} · {{ sinceText(a.since) }}</span>
        </div>
      </section>

      <!-- 页面菜单栏 -->
      <nav v-if="pagesList.length > 1" class="page-nav">
        <button
          v-for="(p, i) in pagesList"
          :key="p.id"
          class="pn-item"
          :class="{ on: curPageIdx === i }"
          @click="curPageIdx = i"
        >
          {{ p.title }}
        </button>
      </nav>

      <!-- 组态布局渲染 -->
      <template v-if="hasLayout">
        <section
          v-if="layoutStats.length"
          class="stat-rail"
          :style="{ gridTemplateColumns: `repeat(${Math.min(layoutStats.length, 6)}, 1fr)` }"
        >
          <template v-for="(s, i) in layoutStats" :key="'ls' + i">
            <div
              v-if="s.card === 'gauge'"
              class="stat stat-gauge"
              :class="{ alarming: isAlarming(s.device, s.key) }"
              :style="{ '--stat-color': colorOf(i), animationDelay: i * 60 + 'ms' }"
            >
              <div class="stat-label">
                <span>{{ s.title }}</span
                ><span>GAUGE</span>
              </div>
              <GaugeArc
                :value="latest(s.device, s.key)"
                :max="s.max || 100"
                :unit="meta(s.device, s.key).unit"
                :color="colorOf(i)"
              />
              <div class="stat-sub">{{ s.device }} · {{ s.key }}</div>
            </div>
            <StatTile
              v-else-if="s.kind !== 'alarm'"
              :class="{ alarming: isAlarming(s.device, s.key) }"
              :label="s.title"
              :en="s.device.replace('Sim ', '')"
              :value="latest(s.device, s.key)"
              :unit="meta(s.device, s.key).unit"
              :color="colorOf(i)"
              :delay="i * 60"
              :sub="`${s.device} · ${s.key}`"
            />
            <div
              v-else
              class="stat"
              :class="{ alarming: !!alarmEntryByName(s.key) }"
              :style="{
                '--stat-color': alarmEntryByName(s.key) ? 'var(--bad)' : 'var(--ok)',
                animationDelay: i * 60 + 'ms',
              }"
            >
              <div class="stat-label">
                <span>{{ s.title }}</span
                ><span>ALARM</span>
              </div>
              <div class="stat-value" :style="{ color: alarmEntryByName(s.key) ? 'var(--bad)' : 'var(--ok)' }">
                {{ alarmEntryByName(s.key) ? '告警中' : '正常' }}
              </div>
              <div class="stat-sub">{{ alarmEntryByName(s.key)?.message || `${s.device} 监控中` }}</div>
            </div>
          </template>
        </section>
        <!-- 三栏监控屏:左右侧栏 + 中间主视区(预留)与双图 -->
        <section v-if="tripleCols" class="triple-grid">
          <div class="tcol">
            <SlotCard
              v-for="(g, i) in tripleCols.left"
              :key="g.id"
              :sl="g.slot"
              compact
              :color="colorOf(i)"
              :style="{ animationDelay: i * 70 + 'ms' }"
            />
          </div>
          <div class="tcol tcol-center">
            <div class="card main-reserve">
              <div class="mr-inner">
                <span class="mr-icon">🗺</span><span>{{ tripleCols.reservedLabel }}</span>
              </div>
            </div>
            <SlotCard
              v-for="(g, i) in tripleCols.center"
              :key="g.id"
              :sl="g.slot"
              :color="colorOf(3 + i)"
              :style="{ animationDelay: (3 + i) * 70 + 'ms' }"
            />
          </div>
          <div class="tcol">
            <SlotCard
              v-for="(g, i) in tripleCols.right"
              :key="g.id"
              :sl="g.slot"
              compact
              :color="colorOf(5 + i)"
              :style="{ animationDelay: (5 + i) * 70 + 'ms' }"
            />
          </div>
        </section>
        <section v-else class="grid">
          <SlotCard
            v-for="(g, i) in layoutGrid"
            :key="g.id"
            :sl="g.slot"
            :color="colorOf(layoutStats.length + i)"
            :style="{ animationDelay: 120 + i * 60 + 'ms', gridColumn: `span ${g.span}` }"
          />
        </section>
      </template>

      <section
        v-if="!hasLayout && (statItems.length || alarmBadges.length)"
        class="stat-rail"
        :style="{ gridTemplateColumns: `repeat(${Math.min(statItems.length + alarmBadges.length, 6)}, 1fr)` }"
      >
        <StatTile
          v-for="(it, i) in statItems"
          :key="it.device + it.key"
          :class="{ alarming: isAlarming(it.device, it.key) }"
          :label="meta(it.device, it.key).label"
          :en="it.device.replace('Sim ', '')"
          :value="latest(it.device, it.key)"
          :unit="meta(it.device, it.key).unit"
          :color="colorOf(i)"
          :delay="i * 60"
          :sub="it.device"
        />
        <div
          v-for="(b, i) in alarmBadges"
          :key="'al' + b.name"
          class="stat"
          :class="{ alarming: !!b.activeEntry }"
          :style="{
            '--stat-color': b.activeEntry ? 'var(--bad)' : 'var(--ok)',
            animationDelay: (statItems.length + i) * 60 + 'ms',
          }"
        >
          <div class="stat-label">
            <span>{{ b.name }}</span
            ><span>ALARM</span>
          </div>
          <div class="stat-value" :style="{ color: b.activeEntry ? 'var(--bad)' : 'var(--ok)' }">
            {{ b.activeEntry ? '告警中' : '正常' }}
          </div>
          <div class="stat-sub">{{ b.activeEntry ? b.activeEntry.message : `${b.device} · ${b.key} 监控中` }}</div>
        </div>
      </section>

      <section v-if="!hasLayout" class="grid">
        <div
          v-for="(it, i) in chartItems"
          :key="it.device + it.key"
          class="card"
          :class="{ alarming: isAlarming(it.device, it.key) }"
          :style="{ animationDelay: 120 + i * 60 + 'ms' }"
        >
          <div class="card-head">
            <span class="card-title"
              >{{ meta(it.device, it.key).label }}<span class="en">{{ it.device }}</span></span
            >
            <div class="card-side">
              <div class="side-kv">
                <div class="k">当前</div>
                <div class="v">{{ fmt(latest(it.device, it.key)) }} {{ meta(it.device, it.key).unit }}</div>
              </div>
            </div>
          </div>
          <div class="card-body">
            <LineChart
              :unit="meta(it.device, it.key).unit"
              :series="[
                {
                  name: meta(it.device, it.key).label,
                  color: colorOf(statItems.length + i),
                  data: series(it.device, it.key),
                  area: it.card === 'line',
                  bar: it.card === 'bar',
                },
              ]"
            />
          </div>
        </div>

        <div v-for="dev in mapDevices" :key="dev" class="card" style="animation-delay: 300ms">
          <div class="card-head">
            <span class="card-title"
              >位置<span class="en">{{ dev }}</span></span
            >
          </div>
          <VehicleMap :lat="latest(dev, 'latitude')" :lng="latest(dev, 'longitude')" />
        </div>
      </section>

      <footer class="site-foot">
        <img class="sf-logo" :src="brandLogo" alt="" />
        <span>国网电瑞 GWDR Power Technology · {{ cfg?.site?.label || cfg?.site?.name || '' }} · 微电网监控平台</span>
      </footer>
    </template>
  </div>
</template>
