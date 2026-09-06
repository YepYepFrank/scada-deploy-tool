<script setup lang="ts">
/**
 * /dev 展示页:左侧注册表(组件 + 模板),右侧按所选模板渲染一份覆盖全部内置组件的配置。
 * design 模式用 sampleData;「随机数据」用内置 MockDataSource(2 秒一推,含历史 / 属性 / 告警 / ext);不依赖 TB。
 * 「镜像真数据」用 LegacyDataSource(T1.1 预案)连镜像 TB:登录 → 选设备 → 把演示配置里的实体 / key 换成该设备实际有的。
 */
import { computed, ref } from 'vue'
import { LegacyDataSource } from '@grid/tb-client'
import type { DataSource, TsUpdate, ConnectionStatus, AlarmInfo, TsPoint } from '@grid/tb-client'
import { ScadaPage, listWidgets, listTemplates } from '../src/index'
import { SAMPLE_SVG } from '../src/widgets/image'
import type { PageConfig, WidgetConfig } from '../src/schema/page-config'

const widgets = listWidgets()
const templates = listTemplates()
const template = ref('overview-a')
const design = ref(true)
const live = ref(false)
const offline = ref(false)
const showStatus = ref(true)

const DEV = { type: 'DEVICE', id: 'dev-0001', name: 'SSP1_GP1_IED1' } as const
const AST = { type: 'ASSET', id: 'asset-0001', name: '仙人山服务区' } as const

// 各模板的演示配置:覆盖 7 种内置组件
const W = {
  p: (id: string, slot: string): WidgetConfig => ({
    id,
    slot,
    type: 'number-card',
    props: { title: '进线有功', subtitle: 'ACTIVE POWER', unit: 'kW', decimals: 1, sub: 'SSP1_GP1_IED1 · P' },
    bindings: { value: { mode: 'ts', entity: DEV, key: 'P' } },
  }),
  soc: (id: string, slot: string): WidgetConfig => ({
    id,
    slot,
    type: 'gauge',
    props: { title: '频率', unit: 'Hz', min: 49, max: 51, decimals: 2, color: '#199e70' },
    bindings: { value: { mode: 'ts', entity: DEV, key: 'F' } },
  }),
  ov: (id: string, slot: string): WidgetConfig => ({
    id,
    slot,
    type: 'overview-card',
    props: {
      title: '三相电流',
      items: [
        { label: 'Ia', unit: 'A' },
        { label: 'Ib', unit: 'A' },
        { label: 'Ic', unit: 'A' },
      ],
    },
    bindings: {
      items: [
        { mode: 'ts', entity: DEV, key: 'Ia' },
        { mode: 'ts', entity: DEV, key: 'Ib' },
        { mode: 'ts', entity: DEV, key: 'Ic' },
      ],
    },
  }),
  cb: (id: string, slot: string): WidgetConfig => ({
    id,
    slot,
    type: 'text',
    props: { content: '断路器:{{value}}', size: 22, align: 'center' },
    bindings: { value: { mode: 'attr', entity: DEV, scope: 'SERVER_SCOPE', key: 'CB' } },
  }),
  line: (id: string, slot: string): WidgetConfig => ({
    id,
    slot,
    type: 'line',
    props: { title: '全站功率', subtitle: '24H', unit: 'kW', chartStyle: 'area' },
    bindings: {
      series: [
        { mode: 'ts-history', entity: AST, keys: ['calc_total_p'], window: '24h', agg: 'AVG' },
        { mode: 'ts-history', entity: AST, keys: ['calc_total_load'], window: '24h' },
      ],
    },
  }),
  dual: (id: string, slot: string): WidgetConfig => ({
    id,
    slot,
    type: 'dual-axis',
    props: { title: '有功 / 无功', unitL: 'kW', unitR: 'kvar' },
    bindings: {
      primary: { mode: 'ts-history', entity: DEV, keys: ['P'], window: '2h' },
      secondary: { mode: 'ts-history', entity: DEV, keys: ['Q'], window: '2h' },
    },
  }),
  alarms: (id: string, slot: string): WidgetConfig => ({
    id,
    slot,
    type: 'alarm-list',
    props: { title: '实时告警', maxRows: 10 },
    bindings: { alarms: { mode: 'alarm', entity: AST } },
  }),
  cbLight: (id: string, slot: string): WidgetConfig => ({
    id,
    slot,
    type: 'status-light',
    props: {
      title: '断路器',
      subtitle: 'CB',
      onValue: '1',
      onLabel: '合闸',
      offLabel: '分闸',
      sub: 'SSP1_GP1_IED1 · CB',
    },
    bindings: { state: { mode: 'ts', entity: DEV, key: 'CB' } },
  }),
  tbl: (id: string, slot: string): WidgetConfig => ({
    id,
    slot,
    type: 'table',
    props: {
      title: '三相电流',
      mode: 'latest',
      columns: [
        { label: 'Ia', unit: 'A' },
        { label: 'Ib', unit: 'A' },
        { label: 'Ic', unit: 'A' },
      ],
    },
    bindings: {
      rows: [
        { mode: 'ts', entity: DEV, key: 'Ia' },
        { mode: 'ts', entity: DEV, key: 'Ib' },
        { mode: 'ts', entity: DEV, key: 'Ic' },
      ],
    },
  }),
  tblDaily: (id: string, slot: string): WidgetConfig => ({
    id,
    slot,
    type: 'table',
    props: {
      title: '逐日收益明细',
      mode: 'timeline',
      timeFormat: 'date',
      columns: [{ label: '净收益', unit: '元', decimals: 0 }],
    },
    bindings: {
      rows: [
        { mode: 'ext', source: 'kz', window: '30d', interval: '1d', params: { stationId: 'x', metric: 'revenue' } },
      ],
    },
  }),
  img: (id: string, slot: string): WidgetConfig => ({
    id,
    slot,
    type: 'image',
    props: { title: '一次接线图(占位)', fit: 'contain', src: SAMPLE_SVG },
    bindings: {},
  }),
  ext: (id: string, slot: string): WidgetConfig => ({
    id,
    slot,
    type: 'line',
    props: { title: '逐日收益', subtitle: 'kz 归档 · 30D', unit: '元', chartStyle: 'bar' },
    bindings: {
      series: [
        { mode: 'ext', source: 'kz', window: '30d', interval: '1d', params: { stationId: 'x', metric: 'revenue' } },
      ],
    },
  }),
}
const configs: Record<string, WidgetConfig[]> = {
  'overview-a': [
    W.p('w-s1', 's1'),
    W.soc('w-s2', 's2'),
    W.ov('w-s3', 's3'),
    W.cbLight('w-s4', 's4'),
    W.line('w-g1', 'g1'),
    W.dual('w-g2', 'g2'),
    W.cb('w-g3', 'g3'),
    W.tblDaily('w-g4', 'g4'),
  ],
  'monitor-3col': [
    W.p('w-l1', 'l1'),
    W.soc('w-l2', 'l2'),
    W.ov('w-l3', 'l3'),
    W.img('w-main', 'main'),
    W.line('w-c1', 'c1'),
    W.dual('w-c2', 'c2'),
    W.alarms('w-r1', 'r1'),
    W.tbl('w-r2', 'r2'),
    W.cbLight('w-r3', 'r3'),
  ],
  'grid-3x3': [
    W.p('w-r1c1', 'r1c1'),
    W.soc('w-r1c2', 'r1c2'),
    W.ov('w-r1c3', 'r1c3'),
    W.line('w-r2c1', 'r2c1'),
    W.dual('w-r2c2', 'r2c2'),
    W.alarms('w-r2c3', 'r2c3'),
    W.ext('w-r3c1', 'r3c1'),
    W.cbLight('w-r3c2', 'r3c2'),
    W.img('w-r3c3', 'r3c3'),
  ],
}
const config = computed<PageConfig>(() => ({
  schemaVersion: 1,
  template: template.value,
  title: '/dev 展示页',
  widgets: configs[template.value] ?? [],
}))
/** 覆盖统计(T2.4 完成标准:10 组件 × 3 模板):当前模板用到的组件类型(含模板 fixed 槽位)与三模板合计 */
const typesOf = (id: string) =>
  new Set([
    ...(configs[id] ?? []).map(w => w.type),
    ...(templates.find(t => t.id === id)?.slots.flatMap(s => (s.fixed ? [s.fixed.type] : [])) ?? []),
  ])
const usedTypes = computed(() => typesOf(template.value))
const coveredAll = new Set(templates.flatMap(t => [...typesOf(t.id)]))

// ---------- MockDataSource ----------
const statusCbs = new Set<(s: ConnectionStatus) => void>()
const rnd = (k: string) =>
  k === 'CB'
    ? Math.random() > 0.3
      ? 1
      : 0
    : k === 'F'
      ? 49.9 + Math.random() * 0.2
      : k.startsWith('I')
        ? 80 + Math.random() * 40
        : k === 'Q'
          ? 20 + Math.random() * 10
          : 100 + Math.random() * 60
const hist = (k: string, n: number, stepMs: number): TsPoint[] =>
  Array.from({ length: n }, (_, i) => ({
    ts: Date.now() - (n - i) * stepMs,
    value: Math.round((rnd(k) + Math.sin(i / 5) * 30) * 10) / 10,
  }))
const alarmsNow = (): AlarmInfo[] =>
  offline.value
    ? []
    : [
        {
          id: 'a1',
          type: '电压越限',
          severity: 'MAJOR',
          status: 'ACTIVE_UNACK',
          startTs: Date.now() - 320_000,
          originator: DEV,
          originatorName: DEV.name,
        },
        {
          id: 'a2',
          type: '通讯中断',
          severity: 'CRITICAL',
          status: 'ACTIVE_ACK',
          startTs: Date.now() - 5_400_000,
          originator: DEV,
          originatorName: 'PDR4_LP1_ATS1',
        },
      ]
const mock: DataSource = {
  get status() {
    return offline.value ? 'offline' : 'live'
  },
  onStatus(cb) {
    statusCbs.add(cb)
    return () => statusCbs.delete(cb)
  },
  subscribeTs(_e, keys, cb) {
    const push = () =>
      cb(keys.map<TsUpdate>(k => ({ key: k, points: [{ ts: Date.now(), value: Math.round(rnd(k) * 100) / 100 }] })))
    push()
    const t = setInterval(() => !offline.value && push(), 2000)
    return () => clearInterval(t)
  },
  subscribeAttr(_e, scope, keys, cb) {
    const push = () =>
      cb(keys.map(k => ({ scope, key: k, ts: Date.now(), value: Math.random() > 0.5 ? '合闸' : '分闸' })))
    push()
    const t = setInterval(() => !offline.value && push(), 3000)
    return () => clearInterval(t)
  },
  subscribeAlarms(_e, _t, cb) {
    cb(alarmsNow())
    const t = setInterval(() => cb(alarmsNow()), 4000)
    return () => clearInterval(t)
  },
  async getHistory(_e, keys, window) {
    const n = window === '24h' ? 288 : 60
    return Object.fromEntries(keys.map(k => [k, hist(k, n, window === '24h' ? 300_000 : 120_000)]))
  },
  async getLatest(_e, keys) {
    return Object.fromEntries(keys.map(k => [k, { ts: Date.now(), value: rnd(k) }]))
  },
  async ext(q) {
    const days = 30
    return {
      series: {
        [String(q.params.metric)]: Array.from({ length: days }, (_, i) => ({
          ts: Date.now() - (days - i) * 86_400_000,
          value: Math.round(200 + Math.random() * 300),
        })),
      },
    }
  },
}
function toggleOffline() {
  offline.value = !offline.value
  statusCbs.forEach(cb => cb(mock.status))
}
// ---------- 镜像真数据(T1.1 预案 LegacyDataSource)----------
// 凭据从表单输入;可在 dev/.env.local 加 VITE_TB_USER / VITE_TB_PASSWORD 预填(仅 dev server 读取,不入库不打包)
const mirror = ref(false)
const mBase = ref('/tbm') // vite.dev.config 代理到镜像(含 WS)
const mUser = ref((import.meta.env.VITE_TB_USER as string | undefined) ?? '')
const mPass = ref((import.meta.env.VITE_TB_PASSWORD as string | undefined) ?? '')
// 身份预填:客户视角(VITE_TB_USER)/ 租户视角(VITE_TB_TENANT_USER);T3.6「Customer 视角预览」就是看这两者的差
const IDENTITIES = [
  { id: 'customer', label: '客户视角', user: import.meta.env.VITE_TB_USER, pass: import.meta.env.VITE_TB_PASSWORD },
  {
    id: 'tenant',
    label: '租户视角',
    user: import.meta.env.VITE_TB_TENANT_USER,
    pass: import.meta.env.VITE_TB_TENANT_PASSWORD,
  },
].filter(i => i.user && i.pass)
const mIdentity = ref(IDENTITIES[0]?.id ?? '')
function pickIdentity() {
  const i = IDENTITIES.find(x => x.id === mIdentity.value)
  if (i) {
    mUser.value = i.user as string
    mPass.value = i.pass as string
  }
}
const mMsg = ref('')
const mDevices = ref<{ id: string; name: string; type: string }[]>([])
const mDeviceId = ref('')
const mKeys = ref<string[]>([])
const mStatus = ref<ConnectionStatus>('connecting')
// 镜像上的 ScadaPage 资产(契约 §5):选中后原样渲染其 pageConfig,不做实体 / key 重映射
const mPages = ref<{ id: string; name: string; version?: number }[]>([])
const mPageId = ref('')
const mPage = ref<PageConfig | null>(null)
const mPageMsg = ref('')
let mToken = ''
let mDs: LegacyDataSource | null = null
const mDsRef = ref<DataSource | null>(null)

async function mFetch(path: string, body?: unknown) {
  const r = await fetch(mBase.value + path, {
    method: body ? 'POST' : 'GET',
    headers: { 'Content-Type': 'application/json', ...(mToken ? { 'X-Authorization': `Bearer ${mToken}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  })
  if (!r.ok) throw new Error(`${path.split('?')[0]} → HTTP ${r.status}`)
  return r.json()
}
async function mirrorLogin() {
  mMsg.value = '登录中…'
  try {
    mToken = (await mFetch('/api/auth/login', { username: mUser.value, password: mPass.value })).token
    const me = await mFetch('/api/auth/user')
    const page =
      me.authority === 'CUSTOMER_USER'
        ? await mFetch(`/api/customer/${me.customerId.id}/devices?pageSize=500&page=0`)
        : await mFetch('/api/tenant/devices?pageSize=500&page=0')
    const pages =
      me.authority === 'CUSTOMER_USER'
        ? await mFetch(`/api/customer/${me.customerId.id}/assets?pageSize=50&page=0&type=ScadaPage`)
        : await mFetch('/api/tenant/assets?pageSize=50&page=0&type=ScadaPage')
    mPages.value = (pages.data as { id: { id: string }; name: string; additionalInfo?: { version?: number } }[]).map(
      a => ({
        id: a.id.id,
        name: a.name,
        version: a.additionalInfo?.version,
      })
    )
    mDevices.value = (page.data as { id: { id: string }; name: string; type: string }[])
      .map(d => ({ id: d.id.id, name: d.name, type: d.type }))
      .sort((a, b) => a.name.localeCompare(b.name))
    mDs?.dispose()
    mDs = new LegacyDataSource({ baseUrl: mBase.value, getToken: () => mToken })
    mStatus.value = mDs.status
    mDs.onStatus(s => (mStatus.value = s))
    mDsRef.value = mDs
    mMsg.value = `${me.authority} · ${mDevices.value.length} 台设备`
    if (!mDevices.value.some(d => d.id === mDeviceId.value)) mDeviceId.value = mDevices.value[0]?.id ?? ''
    await pickDevice()
    mirror.value = true
    design.value = false
    live.value = false
  } catch (e) {
    mMsg.value = '失败:' + (e instanceof Error ? e.message : String(e))
  }
}
async function pickPage() {
  mPage.value = null
  mPageMsg.value = ''
  if (!mPageId.value) return
  try {
    const attrs = (await mFetch(
      `/api/plugins/telemetry/ASSET/${mPageId.value}/values/attributes/SERVER_SCOPE?keys=pageConfig`
    )) as {
      key: string
      value: unknown
    }[]
    const raw = attrs.find(a => a.key === 'pageConfig')?.value
    if (!raw) throw new Error('资产上没有 pageConfig 属性')
    mPage.value = (typeof raw === 'string' ? JSON.parse(raw) : raw) as PageConfig
    mPageMsg.value = `${mPage.value.template} · ${mPage.value.widgets.length} 个组件`
  } catch (e) {
    mPageMsg.value = '读取失败:' + (e instanceof Error ? e.message : String(e))
  }
}
async function pickDevice() {
  mKeys.value = mDeviceId.value ? await mFetch(`/api/plugins/telemetry/DEVICE/${mDeviceId.value}/keys/timeseries`) : []
}
// 演示配置里的 key → 该设备实际有的 key(按偏好表,找不到就轮着用现有 key)
const PREF: Record<string, string[]> = {
  P: ['P', 'p', 'ACTIVE_P', 'Pa', 'AC_P'],
  Q: ['Q', 'Qa', 'DC_I', 'I'],
  SOC: ['SOC', 'soc', 'DC_V', 'U'],
  F: ['F', 'Hz', 'FREQ', 'Ua'],
  Ia: ['Ia', 'IA', 'I_A'],
  Ib: ['Ib', 'IB', 'I_B'],
  Ic: ['Ic', 'IC', 'I_C'],
  CB: ['CB', 'SW', 'COM', 'SYS_NORMAL', 'RUN'],
  calc_total_p: ['P', 'p', 'ACTIVE_P'],
  calc_total_load: ['DC_V', 'U', 'Q', 'Ua'],
}
const keyMap = computed(() => {
  const avail = mKeys.value
  const out: Record<string, string> = {}
  Object.entries(PREF).forEach(([k, prefs], i) => {
    out[k] = prefs.find(x => avail.includes(x)) ?? avail[i % Math.max(avail.length, 1)] ?? k
  })
  return out
})
const mirrorConfig = computed<PageConfig>(() => {
  const dev = mDevices.value.find(d => d.id === mDeviceId.value)
  if (!dev) return config.value
  const ent = { type: 'DEVICE', id: dev.id, name: dev.name }
  const km = keyMap.value
  const walk = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(walk)
    if (v && typeof v === 'object') {
      const o = v as Record<string, unknown>
      if ((o.type === 'DEVICE' || o.type === 'ASSET') && typeof o.id === 'string' && Object.keys(o).length <= 3)
        return ent
      const r: Record<string, unknown> = {}
      for (const [k, x] of Object.entries(o)) {
        if (k === 'key' && typeof x === 'string') r[k] = km[x] ?? x
        else if (k === 'keys' && Array.isArray(x)) r[k] = x.map(y => km[String(y)] ?? y)
        else if (k === 'sub' && typeof x === 'string') r[k] = dev.name
        else r[k] = walk(x)
      }
      return r
    }
    return v
  }
  return { ...config.value, title: `镜像 · ${dev.name}`, widgets: walk(config.value.widgets) as WidgetConfig[] }
})
const pageConfig = computed(() => (mirror.value ? (mPage.value ?? mirrorConfig.value) : config.value))
const dsForPage = computed(() => (mirror.value ? (mDsRef.value ?? undefined) : live.value ? mock : undefined))
const issues = ref<{ path: string; message: string }[]>([])
</script>

<template>
  <div class="dev">
    <aside class="dev-side">
      <h1>@grid/scada-renderer <small>/dev</small></h1>
      <section>
        <h2>模板</h2>
        <label v-for="t in templates" :key="t.id"
          ><input v-model="template" type="radio" :value="t.id" /> {{ t.name }} <code>{{ t.id }}</code> · {{ t.kind }} ·
          {{ t.slots.length }} 槽位</label
        >
      </section>
      <section>
        <h2>
          组件({{ widgets.length }})
          <small class="dim">本模板 {{ usedTypes.size }} · 三模板合计 {{ coveredAll.size }}/{{ widgets.length }}</small>
        </h2>
        <ul class="dev-widgets">
          <li v-for="w in widgets" :key="w.type" :class="{ used: usedTypes.has(w.type) }" :data-type="w.type">
            <code>{{ w.type }}</code> {{ w.name }}
            <span class="dim"
              >· {{ w.bindingSlots.map(s => s.name + ':' + s.valueType + (s.multiple ? '[]' : '')).join(', ') }}</span
            >
          </li>
        </ul>
      </section>
      <section>
        <h2>模式</h2>
        <label
          ><input v-model="design" type="checkbox" @change="live = !design ? live : false" />
          design(sampleData,不订阅)</label
        >
        <label><input v-model="live" type="checkbox" :disabled="design" /> 随机数据(MockDataSource,2 秒一推)</label>
        <label><input v-model="showStatus" type="checkbox" /> 显示连接状态徽标</label>
        <button :disabled="!live" @click="toggleOffline">{{ offline ? '恢复连接' : '模拟断线' }}</button>
      </section>
      <section class="mirror">
        <h2>镜像真数据(LegacyDataSource · T1.1 预案)</h2>
        <label>地址 <input v-model="mBase" placeholder="/tbm(代理)或 http://host:8080" /></label>
        <label v-if="IDENTITIES.length > 1"
          >身份预填
          <select v-model="mIdentity" @change="pickIdentity">
            <option v-for="i in IDENTITIES" :key="i.id" :value="i.id">{{ i.label }} · {{ i.user }}</option>
          </select></label
        >
        <label>账号 <input v-model="mUser" autocomplete="username" /></label>
        <label>密码 <input v-model="mPass" type="password" autocomplete="current-password" /></label>
        <button @click="mirrorLogin">登录并连接</button>
        <span class="dim">{{ mMsg }}</span>
        <template v-if="mDevices.length">
          <label
            >设备
            <select v-model="mDeviceId" @change="pickDevice">
              <option v-for="d in mDevices" :key="d.id" :value="d.id">{{ d.name }} · {{ d.type }}</option>
            </select></label
          >
          <label
            >页面(ScadaPage 资产)
            <select v-model="mPageId" @change="pickPage">
              <option value="">(演示配置 · 按上面设备重映射)</option>
              <option v-for="p in mPages" :key="p.id" :value="p.id">
                {{ p.name }}{{ p.version ? ` · v${p.version}` : '' }}
              </option>
            </select></label
          >
          <div v-if="mPageMsg" class="dim">{{ mPageMsg }}</div>
          <label
            ><input v-model="mirror" type="checkbox" :disabled="!mDsRef" @change="mirror && (design = live = false)" />
            用镜像数据渲染</label
          >
          <div class="dim">
            连接:<code>{{ mStatus }}</code> · 测点 {{ mKeys.length }} 个 · 映射:{{
              Object.entries(keyMap)
                .map(([k, v]) => `${k}→${v}`)
                .join(' ')
            }}
          </div>
        </template>
      </section>
      <section v-if="issues.length">
        <h2>校验问题</h2>
        <ul>
          <li v-for="i in issues" :key="i.path">
            <code>{{ i.path }}</code> {{ i.message }}
          </li>
        </ul>
      </section>
    </aside>
    <main class="dev-main">
      <ScadaPage
        :config="pageConfig"
        :data-source="dsForPage"
        :design="design"
        :show-status="showStatus"
        @invalid="issues = $event"
      />
    </main>
  </div>
</template>

<style>
.dev {
  display: grid;
  grid-template-columns: 320px 1fr;
  height: 100vh;
}
.dev-side {
  padding: 16px;
  border-right: 1px solid rgba(83, 196, 255, 0.2);
  overflow: auto;
  font-size: 13px;
}
.dev-side h1 {
  font-size: 16px;
  margin: 0 0 12px;
}
.dev-side h1 small {
  opacity: 0.6;
  font-weight: 400;
}
.dev-side h2 {
  font-size: 12px;
  letter-spacing: 0.1em;
  opacity: 0.7;
  margin: 16px 0 6px;
}
.dev-side label {
  display: block;
  margin: 4px 0;
}
.dev-side code {
  color: #19b7ff;
}
.dev-widgets li.used::before {
  content: '✓ ';
  color: #6fe3a0;
}
.dev-widgets li:not(.used) {
  opacity: 0.55;
}
.dev-side .dim {
  opacity: 0.55;
}
.dev-side ul {
  padding-left: 16px;
  margin: 0;
}
.dev-side button {
  margin-top: 8px;
}
.dev-side .mirror input,
.dev-side .mirror select {
  width: 100%;
  box-sizing: border-box;
  margin-top: 2px;
  background: #0b1a33;
  color: inherit;
  border: 1px solid rgba(83, 196, 255, 0.3);
  padding: 3px 6px;
}
.dev-main {
  padding: 16px;
  overflow: auto;
  background: radial-gradient(circle at top left, rgba(39, 110, 214, 0.28), transparent 32%), #020817;
}
</style>
