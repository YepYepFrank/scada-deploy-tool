<script setup lang="ts">
/**
 * /dev 展示页:左侧注册表(组件 + 模板),右侧用 sampleData(design 模式)或「随机数据」MockDataSource 渲染整页。
 * 与编辑器缩略图共用 design 模式(架构 §0 ⑪);不依赖 TB。
 */
import { computed, ref } from 'vue'
import type { DataSource, TsUpdate, ConnectionStatus } from '@grid/tb-client'
import { ScadaPage, listWidgets, listTemplates } from '../src/index'
import type { PageConfig, WidgetConfig } from '../src/schema/page-config'

const widgets = listWidgets()
const templates = listTemplates()
const template = ref(templates[0]?.id ?? 'overview-a')
const design = ref(true)
const live = ref(false)
const offline = ref(false)
const showStatus = ref(true)

const DEV = { type: 'DEVICE', id: 'dev-0000', name: '演示设备' } as const

const config = computed<PageConfig>(() => ({
  schemaVersion: 1,
  template: template.value,
  title: '/dev 展示页',
  widgets: [
    {
      id: 'w-s1',
      slot: 's1',
      type: 'number-card',
      props: { title: '有功功率', unit: 'kW', decimals: 1 },
      bindings: { value: { mode: 'ts', entity: DEV, key: 'P' } },
    },
    {
      id: 'w-s2',
      slot: 's2',
      type: 'number-card',
      props: { title: 'SOC', unit: '%', decimals: 0 },
      bindings: { value: { mode: 'ts', entity: DEV, key: 'soc' } },
    },
    {
      id: 'w-s3',
      slot: 's3',
      type: 'text',
      props: { content: '断路器:{{value}}', size: 22 },
      bindings: { value: { mode: 'attr', entity: DEV, scope: 'SERVER_SCOPE', key: 'CB' } },
    },
    { id: 'w-s4', slot: 's4', type: 'text', props: { content: '常量文本', size: 18, align: 'center' }, bindings: {} },
    {
      id: 'w-g1',
      slot: 'g1',
      type: 'text',
      props: { content: '(图表组件 T2.1 接入;此处占位)', align: 'center' },
      bindings: {},
    },
  ] satisfies WidgetConfig[] as WidgetConfig[],
}))

// 随机数据 MockDataSource:每 2 秒推一次;「断线」开关切 status
const statusCbs = new Set<(s: ConnectionStatus) => void>()
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
      cb(
        keys.map<TsUpdate>(k => ({
          key: k,
          points: [{ ts: Date.now(), value: k === 'soc' ? 40 + Math.random() * 60 : Math.random() * 500 - 100 }],
        }))
      )
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
    cb([])
    return () => {}
  },
  async getHistory(_e, keys) {
    return Object.fromEntries(
      keys.map(k => [
        k,
        Array.from({ length: 60 }, (_, i) => ({
          ts: Date.now() - (60 - i) * 60000,
          value: Math.sin(i / 6) * 50 + 100,
        })),
      ])
    )
  },
  async getLatest(_e, keys) {
    return Object.fromEntries(keys.map(k => [k, { ts: Date.now(), value: Math.random() * 100 }]))
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
              >· {{ w.category }} · 槽位 {{ w.bindingSlots.map(s => s.name + ':' + s.valueType).join(', ') }}</span
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
