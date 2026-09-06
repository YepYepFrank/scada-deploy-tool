<script setup lang="ts">
/**
 * 独立大屏薄壳(T3.8,架构 §4):
 *   登录页(TB 地址 + 账号,token 只存 sessionStorage)→ 页面列表(当前身份看得到的 ScadaPage 资产)
 *   → 标头 / 时钟 / 菜单 + <ScadaPage>(LegacyDataSource,同事的 TbClient 就绪后换实现)。
 * 没有任何内置凭据、没有 Public 匿名登录、没有三级取数:看得到什么完全由登录身份在 TB 里的分配决定。
 * URL:?base=<TB 地址>(缺省同源 /api,单文件部署时必填)&site=<站点名,只列它下面的页面>&page=<资产 id,直接打开>&kz=<kz 地址>
 */
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import { registerBuiltins, ScadaPage, validatePageConfig, type PageConfig } from '@grid/scada-renderer'
import { LegacyDataSource } from '@grid/tb-client'
import { resolveApiBase, resolveKzBase } from '../api/tb.js'

registerBuiltins()

const QS = new URLSearchParams(location.search)
const SESSION_KEY = 'gridops_standalone_session'
const SCADA_PAGE_TYPE = 'ScadaPage'

interface Session {
  base: string
  token: string
  user: string
  authority: string
  customerId: string | null
}
interface PageItem {
  id: string
  name: string
  label: string
  version: number | null
  site: string | null
}

// ---------- 会话 ----------
const stage = ref<'login' | 'list' | 'view'>('login')
const session = ref<Session | null>(null)
const form = ref({
  base: resolveApiBase(QS),
  user: import.meta.env.DEV ? (import.meta.env.VITE_TB_USER as string) || '' : '',
  pass: import.meta.env.DEV ? (import.meta.env.VITE_TB_PASSWORD as string) || '' : '',
})
const loginMsg = ref('')
const busy = ref(false)

const api = async (url: string, data?: unknown) => {
  const s = session.value
  const r = await fetch((s?.base ?? form.value.base) + url, {
    method: data ? 'POST' : 'GET',
    headers: { 'Content-Type': 'application/json', ...(s?.token ? { 'X-Authorization': `Bearer ${s.token}` } : {}) },
    body: data ? JSON.stringify(data) : undefined,
  })
  if (r.status === 401 && s) {
    logout('登录已过期,请重新登录')
    throw new Error('HTTP 401')
  }
  if (!r.ok) throw new Error(`${url.split('?')[0]} → HTTP ${r.status}`)
  const t = await r.text()
  return t ? JSON.parse(t) : null
}

function saveSession(s: Session | null) {
  session.value = s
  try {
    if (s) sessionStorage.setItem(SESSION_KEY, JSON.stringify(s))
    else sessionStorage.removeItem(SESSION_KEY)
  } catch {
    /* 存储不可用时只在内存 */
  }
}
async function login() {
  busy.value = true
  loginMsg.value = '登录中…'
  try {
    const base = form.value.base.replace(/\/+$/, '')
    const r = await fetch(`${base}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: form.value.user, password: form.value.pass }),
    })
    if (!r.ok) throw new Error(r.status === 401 ? '账号或密码不对' : `HTTP ${r.status}`)
    const token = ((await r.json()) as { token: string }).token
    const me = (await (
      await fetch(`${base}/api/auth/user`, { headers: { 'X-Authorization': `Bearer ${token}` } })
    ).json()) as { authority: string; customerId?: { id: string } }
    saveSession({
      base,
      token,
      user: form.value.user,
      authority: me.authority,
      customerId: me.customerId?.id && !/^13814000/.test(me.customerId.id) ? me.customerId.id : null,
    })
    form.value.pass = ''
    loginMsg.value = ''
    await loadPages()
  } catch (e) {
    loginMsg.value = e instanceof Error ? e.message : String(e)
  } finally {
    busy.value = false
  }
}
function logout(msg = '') {
  disposeSource()
  saveSession(null)
  pages.value = []
  current.value = null
  stage.value = 'login'
  loginMsg.value = msg
}

// ---------- 页面列表 ----------
const pages = ref<PageItem[]>([])
const listMsg = ref('')
const siteFilter = QS.get('site')
async function loadPages() {
  const s = session.value!
  listMsg.value = '读取页面…'
  try {
    const base =
      s.authority === 'CUSTOMER_USER' && s.customerId ? `/api/customer/${s.customerId}/assets` : '/api/tenant/assets'
    const out: PageItem[] = []
    for (let p = 0, hasNext = true; hasNext && p < 20; p++) {
      const page = (await api(`${base}?pageSize=100&page=${p}&type=${SCADA_PAGE_TYPE}`)) as {
        data: { id: { id: string }; name: string; label?: string; additionalInfo?: { version?: number } }[]
        hasNext: boolean
      }
      for (const a of page.data)
        out.push({
          id: a.id.id,
          name: a.name,
          label: a.label || a.name,
          version: a.additionalInfo?.version ?? null,
          site: a.name.includes('-') ? a.name.slice(0, a.name.indexOf('-')) : null,
        })
      hasNext = page.hasNext
    }
    pages.value = (siteFilter ? await onlySite(out, siteFilter, base) : out).sort((a, b) =>
      a.name.localeCompare(b.name, 'zh-Hans-CN')
    )
    listMsg.value = pages.value.length
      ? ''
      : '当前账号看不到任何页面:请让管理员把 ScadaPage 资产分配给你所属的 Customer'
    const want = QS.get('page')
    const hit = want ? pages.value.find(x => x.id === want || x.name === want) : null
    if (hit) await open(hit)
    else if (pages.value.length === 1) await open(pages.value[0]!)
    else stage.value = 'list'
  } catch (e) {
    listMsg.value = '读取失败:' + (e instanceof Error ? e.message : String(e))
    stage.value = 'list'
  }
}

/**
 * ?site=:只列该站点资产 Contains 的页面(与发布器写的关系一致)。当前身份看不到站点资产或读不到关系时,
 * 退回按名字前缀匹配(发布器缺省命名 `<站点>-<标题>`)。
 */
async function onlySite(all: PageItem[], siteName: string, assetsBase: string): Promise<PageItem[]> {
  try {
    let site: { id: { id: string } } | undefined
    for (let p = 0, hasNext = true; hasNext && p < 20 && !site; p++) {
      const page = (await api(`${assetsBase}?pageSize=100&page=${p}&textSearch=${encodeURIComponent(siteName)}`)) as {
        data: { id: { id: string }; name: string }[]
        hasNext: boolean
      }
      site = page.data.find(a => a.name === siteName)
      hasNext = page.hasNext
    }
    if (site) {
      const rels = (await api(`/api/relations?fromId=${site.id.id}&fromType=ASSET&relationType=Contains`)) as {
        to: { entityType: string; id: string }
      }[]
      const ids = new Set(rels.filter(r => r.to?.entityType === 'ASSET').map(r => r.to.id))
      if (ids.size) return all.filter(x => ids.has(x.id))
    }
  } catch {
    /* 退回前缀匹配 */
  }
  return all.filter(x => x.site === siteName || x.name.startsWith(siteName))
}

// ---------- 页面 ----------
const current = ref<PageItem | null>(null)
const config = shallowRef<PageConfig | null>(null)
const pageErr = ref('')
const source = shallowRef<LegacyDataSource | null>(null)
const status = ref<'connecting' | 'live' | 'offline'>('connecting')
const denied = ref<Record<string, string>>({})
function disposeSource() {
  source.value?.dispose()
  source.value = null
}
async function open(p: PageItem) {
  current.value = p
  config.value = null
  pageErr.value = ''
  denied.value = {}
  stage.value = 'view'
  try {
    const attrs = (await api(
      `/api/plugins/telemetry/ASSET/${p.id}/values/attributes/SERVER_SCOPE?keys=pageConfig`
    )) as { key: string; value: unknown }[]
    const raw = attrs.find(a => a.key === 'pageConfig')?.value
    if (raw === undefined) throw new Error('资产上没有 pageConfig,请先在部署工具里发布')
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw
    const sv = validatePageConfig(parsed)
    if (!sv.ok) throw new Error('页面配置不符合契约:' + sv.issues.map(i => `${i.path} ${i.message}`).join('; '))
    if (!source.value) {
      const s = session.value!
      source.value = new LegacyDataSource({
        baseUrl: s.base,
        getToken: () => s.token,
        kzBaseUrl: resolveKzBase(QS, s.base),
      })
    }
    config.value = sv.value
  } catch (e) {
    pageErr.value = e instanceof Error ? e.message : String(e)
  }
}
const onBindError = (wid: string, slot: string, msg: string) =>
  (denied.value = { ...denied.value, [`${wid}/${slot}`]: msg })
const deniedCount = computed(() => Object.values(denied.value).filter(m => /拒绝|403|Failed to fetch/i.test(m)).length)

// ---------- 标头 / 时钟 ----------
const clock = ref('')
const dateStr = ref('')
let timer: ReturnType<typeof setInterval> | null = null
function tick() {
  const n = new Date()
  clock.value = n.toLocaleTimeString('zh-CN', { hour12: false })
  dateStr.value = n.toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short' })
}
tick()
timer = setInterval(tick, 1000)
onBeforeUnmount(() => {
  if (timer) clearInterval(timer)
  disposeSource()
})
const title = computed(() => config.value?.title || current.value?.label || 'GRID·OPS')
watch(title, t => (document.title = `${t} · 站点大屏`), { immediate: true })

// ---------- 启动:恢复会话 ----------
onMounted(async () => {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY)
    if (!raw) return
    const s = JSON.parse(raw) as Session
    const r = await fetch(`${s.base}/api/auth/user`, { headers: { 'X-Authorization': `Bearer ${s.token}` } })
    if (!r.ok) throw new Error('expired')
    session.value = s
    await loadPages()
  } catch {
    saveSession(null)
  }
})
</script>

<template>
  <div class="sa">
    <!-- 登录 -->
    <div v-if="stage === 'login'" class="sa-login">
      <form class="sa-card" @submit.prevent="login">
        <div class="sa-brand">GRID·OPS <small>站点大屏</small></div>
        <label>ThingsBoard 地址 <input v-model="form.base" placeholder="留空 = 同源 /api;或 http://host:8080" /></label>
        <label>账号 <input v-model="form.user" autocomplete="username" required data-role="user" /></label>
        <label
          >密码 <input v-model="form.pass" type="password" autocomplete="current-password" required data-role="pass"
        /></label>
        <button type="submit" :disabled="busy" data-role="login">{{ busy ? '登录中…' : '登录' }}</button>
        <div class="sa-msg" data-role="login-msg">{{ loginMsg }}</div>
        <div class="sa-dim">凭据只用于向 TB 换取本次会话的 token(存于 sessionStorage,关标签即失效),不落盘。</div>
      </form>
    </div>

    <!-- 列表 -->
    <div v-else-if="stage === 'list'" class="sa-list">
      <header class="sa-bar">
        <span class="sa-brand">GRID·OPS <small>站点大屏</small></span>
        <span class="sa-dim">{{ session?.user }} · {{ session?.authority }}</span>
        <span class="sa-clock">{{ dateStr }} {{ clock }}</span>
        <button type="button" class="sa-mini" @click="logout()">退出</button>
      </header>
      <main>
        <h2>页面</h2>
        <p v-if="listMsg" class="sa-msg">{{ listMsg }}</p>
        <div class="sa-pages">
          <button v-for="p in pages" :key="p.id" type="button" class="sa-page" :data-page="p.name" @click="open(p)">
            <b>{{ p.label }}</b>
            <span class="sa-dim"
              >{{ p.name }}<template v-if="p.version !== null"> · v{{ p.version }}</template></span
            >
          </button>
        </div>
      </main>
    </div>

    <!-- 页面 -->
    <div v-else class="sa-view">
      <header class="sa-bar">
        <span class="sa-brand">{{ title }}</span>
        <nav v-if="pages.length > 1" class="sa-menu">
          <button
            v-for="p in pages"
            :key="p.id"
            type="button"
            :class="{ on: p.id === current?.id }"
            :data-page="p.name"
            @click="open(p)"
          >
            {{ p.label }}
          </button>
        </nav>
        <span class="sa-status" :data-status="status">{{
          status === 'live' ? '● 实时' : status === 'offline' ? '○ 离线 · 重连中' : '… 连接中'
        }}</span>
        <span v-if="deniedCount" class="sa-denied" data-role="denied">{{ deniedCount }} 个绑定在当前账号下不可见</span>
        <span class="sa-clock">{{ dateStr }} {{ clock }}</span>
        <button type="button" class="sa-mini" @click="stage = 'list'">页面</button>
        <button type="button" class="sa-mini" @click="logout()">退出</button>
      </header>
      <main class="sa-stage">
        <div v-if="pageErr" class="sa-error" data-role="page-error">{{ pageErr }}</div>
        <ScadaPage
          v-else-if="config && source"
          :key="current?.id"
          :config="config"
          :data-source="source"
          show-status
          @status="status = $event"
          @bind-error="onBindError"
        />
        <div v-else class="sa-dim sa-center">读取页面…</div>
      </main>
    </div>
  </div>
</template>
