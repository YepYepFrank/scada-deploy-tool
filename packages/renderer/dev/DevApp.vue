<script setup lang="ts">
/**
 * /dev 展示页:左侧注册表(组件 + 模板),右侧按所选模板渲染一份覆盖全部内置组件的配置。
 * design 模式用 sampleData;「随机数据」用内置 MockDataSource(2 秒一推,含历史 / 属性 / 告警 / ext);不依赖 TB。
 */
import { computed, ref } from 'vue'
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
    props: { title: '全站功率', subtitle: '24H', unit: 'kW', style: 'area' },
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
    props: { title: '逐日收益', subtitle: 'kz 归档 · 30D', unit: '元', style: 'bar' },
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
    W.alarms('w-g3', 'g3'),
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
const dsForPage = computed(() => (live.value ? mock : undefined))
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
        <h2>组件({{ widgets.length }})</h2>
        <ul>
          <li v-for="w in widgets" :key="w.type">
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
        :config="config"
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
.dev-main {
  padding: 16px;
  overflow: auto;
  background: radial-gradient(circle at top left, rgba(39, 110, 214, 0.28), transparent 32%), #020817;
}
</style>
