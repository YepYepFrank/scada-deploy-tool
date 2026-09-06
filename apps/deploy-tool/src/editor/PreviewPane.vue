<script setup lang="ts">
/**
 * 预览(T3.6):隐藏编辑壳,用真数据渲染当前 JSON。
 * - 租户视角:编辑器已登录的连接(token 复用)
 * - Customer 视角:现场输入 CUSTOMER_USER 账号密码另起一个数据源(只在内存,不落盘),渲染同一份 JSON;
 *   未分配给该 Customer 的实体订阅被 TB 拒绝 → 组件错误态,顶部汇总「N 个绑定在该 Customer 下不可见」
 *   (架构 §10「预览 ≠ 生产视角」)。
 */
import { computed, onBeforeUnmount, reactive, ref, shallowRef, watch } from 'vue'
import { ScadaPage, type PageConfig } from '@grid/scada-renderer'
import { LegacyDataSource, type DataSource } from '@grid/tb-client'

type Source = DataSource & { dispose?(): void }

const props = withDefaults(
  defineProps<{
    config: PageConfig
    /** TB 地址(与编辑器连接一致,如 /tbm) */
    base: string
    tenantToken: string
    tenantUser?: string
    /** Customer 账号预填(dev 用 VITE_TB_USER);密码不预填时由现场输入 */
    customerUser?: string
    customerPass?: string
    /** 测试注入:按 token 造数据源;缺省 LegacyDataSource */
    makeSource?: (base: string, getToken: () => string) => Source
    /** 测试注入:登录请求 */
    fetchImpl?: typeof fetch
  }>(),
  { tenantUser: '', customerUser: '', customerPass: '' }
)
const emit = defineEmits<{ close: [] }>()

const view = ref<'tenant' | 'customer'>('tenant')
const cust = reactive({
  user: props.customerUser,
  pass: props.customerPass,
  token: '',
  authority: '',
  busy: false,
  msg: '',
})

const doFetch = (input: string, init?: RequestInit) => (props.fetchImpl ?? fetch)(input, init)
async function loginCustomer() {
  cust.busy = true
  cust.msg = '登录中…'
  cust.token = ''
  try {
    const r = await doFetch(`${props.base}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: cust.user, password: cust.pass }),
    })
    if (!r.ok) throw new Error(`登录失败 HTTP ${r.status}`)
    const token = ((await r.json()) as { token: string }).token
    const me = await doFetch(`${props.base}/api/auth/user`, { headers: { 'X-Authorization': `Bearer ${token}` } })
    cust.authority = me.ok ? ((await me.json()) as { authority: string }).authority : '?'
    cust.token = token
    cust.msg =
      cust.authority === 'CUSTOMER_USER'
        ? `已登录 · CUSTOMER_USER`
        : `已登录,但该账号是 ${cust.authority},看到的不是 Customer 视角`
  } catch (e) {
    cust.msg = e instanceof Error ? e.message : String(e)
  } finally {
    cust.busy = false
  }
}

// ---------- 错误汇总 ----------
const status = ref<'connecting' | 'live' | 'offline'>('connecting')
const errors = reactive(new Map<string, { widgetId: string; slot: string; message: string }>())
function onBindError(widgetId: string, slot: string, message: string) {
  errors.set(`${widgetId}/${slot}`, { widgetId, slot, message })
}
/** TB 明确拒绝(无权访问实体)的绑定 */
const isDenied = (m: string) => /拒绝|403|Failed to fetch data|permission/i.test(m)
const invisible = computed(() => [...errors.values()].filter(e => isDenied(e.message)))
const failed = computed(() => [...errors.values()].filter(e => !isDenied(e.message)))
const widgetLabel = (id: string) => {
  const w = props.config.widgets.find(x => x.id === id)
  return w ? `${w.type} · ${w.slot}` : id
}
const whose = computed(() => (view.value === 'customer' ? `Customer「${cust.user}」` : `租户「${props.tenantUser}」`))

// ---------- 数据源:视角或 token 变了就整个换掉(ScadaPage 用 key 重建,订阅全部重来) ----------
const make = (base: string, getToken: () => string): Source =>
  props.makeSource ? props.makeSource(base, getToken) : new LegacyDataSource({ baseUrl: base, getToken })
const source = shallowRef<Source | null>(null)
const sourceKey = ref(0)
const activeToken = computed(() => (view.value === 'tenant' ? props.tenantToken : cust.token))
watch(
  activeToken,
  token => {
    source.value?.dispose?.()
    errors.clear()
    status.value = 'connecting'
    source.value = token ? make(props.base, () => token) : null
    sourceKey.value++
  },
  { immediate: true }
)
onBeforeUnmount(() => source.value?.dispose?.())
</script>

<template>
  <div class="pv">
    <div class="pv-bar">
      <button type="button" class="pv-back" @click="emit('close')">← 返回编辑</button>
      <span class="pv-title">预览 · {{ config.title || '(无标题)' }}</span>
      <label class="pv-view"
        ><input v-model="view" type="radio" value="tenant" /> 租户视角 <code>{{ tenantUser }}</code></label
      >
      <label class="pv-view"><input v-model="view" type="radio" value="customer" /> 以 Customer 视角</label>
      <template v-if="view === 'customer'">
        <input v-model="cust.user" class="pv-in" placeholder="CUSTOMER_USER 账号" data-role="cust-user" />
        <input
          v-model="cust.pass"
          class="pv-in"
          type="password"
          placeholder="密码(只在内存)"
          autocomplete="current-password"
          data-role="cust-pass"
          @keydown.enter="loginCustomer"
        />
        <button
          type="button"
          :disabled="cust.busy || !cust.user || !cust.pass"
          data-role="cust-login"
          @click="loginCustomer"
        >
          登录
        </button>
        <span class="pv-dim" data-role="cust-msg">{{ cust.msg }}</span>
      </template>
      <span class="pv-status" :data-status="status">{{
        status === 'live' ? '● 实时' : status === 'offline' ? '○ 离线 · 重连中' : '… 连接中'
      }}</span>
    </div>

    <div v-if="invisible.length || failed.length" class="pv-banner" data-role="banner">
      <b v-if="invisible.length" data-role="invisible-count">{{ invisible.length }} 个绑定在该{{ whose }}下不可见</b>
      <b v-if="failed.length" data-role="failed-count">{{ failed.length }} 个绑定出错</b>
      <ul>
        <li v-for="e in [...invisible, ...failed]" :key="e.widgetId + '/' + e.slot">
          <code>{{ widgetLabel(e.widgetId) }} / {{ e.slot }}</code> {{ e.message }}
        </li>
      </ul>
    </div>

    <div class="pv-stage">
      <ScadaPage
        v-if="source"
        :key="sourceKey"
        :config="config"
        :data-source="source"
        show-status
        @status="status = $event"
        @bind-error="onBindError"
      />
      <div v-else class="pv-empty">
        {{ view === 'customer' ? '先用 CUSTOMER_USER 账号登录,再看这一视角' : '租户连接不可用,请回编辑器重新连接' }}
      </div>
    </div>
  </div>
</template>

<style>
.pv {
  display: flex;
  flex-direction: column;
  height: 100vh;
  background: #061127;
  color: #e6f1ff;
}
.pv-bar {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 12px;
  border-bottom: 1px solid var(--ed-line, rgba(83, 196, 255, 0.2));
  font-size: 13px;
  flex-wrap: wrap;
}
.pv-bar button,
.pv-in {
  background: var(--ed-bg-1, #0b1a33);
  border: 1px solid var(--ed-line, rgba(83, 196, 255, 0.2));
  border-radius: 6px;
  color: inherit;
  font: inherit;
  padding: 4px 10px;
}
.pv-bar button {
  cursor: pointer;
}
.pv-bar button:disabled {
  opacity: 0.45;
  cursor: default;
}
.pv-in {
  width: 190px;
}
.pv-title {
  font-weight: 600;
}
.pv-view {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
.pv-dim {
  opacity: 0.7;
}
.pv-status {
  margin-left: auto;
  font-size: 12px;
}
.pv-status[data-status='live'] {
  color: #6fe3a0;
}
.pv-status[data-status='offline'] {
  color: #ff8a8a;
}
.pv-banner {
  padding: 8px 12px;
  background: rgba(255, 138, 138, 0.12);
  border-bottom: 1px solid rgba(255, 138, 138, 0.35);
  font-size: 13px;
}
.pv-banner b {
  margin-right: 14px;
  color: #ff8a8a;
}
.pv-banner ul {
  margin: 6px 0 0;
  padding-left: 18px;
  opacity: 0.85;
  font-size: 12px;
  max-height: 96px;
  overflow: auto;
}
.pv-stage {
  flex: 1;
  min-height: 0;
  position: relative;
}
.pv-stage > .sr-page {
  height: 100%;
}
.pv-empty {
  display: grid;
  place-items: center;
  height: 100%;
  opacity: 0.7;
}
</style>
