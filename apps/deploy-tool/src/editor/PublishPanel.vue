<script setup lang="ts">
/**
 * 发布面板(T3.7):把当前页面 JSON 发布到 TB 的 ScadaPage 资产(六步、失败逆序回滚),
 * 列出资产上的 pageConfigHistory,任一版可「恢复为当前」(= 再发布一次,旧当前版入历史)。
 */
import { computed, onMounted, ref, watch } from 'vue'
import type { PageConfig } from '@grid/scada-renderer'
import type { TbApi } from '@grid/tbsite-compiler'
import {
  HISTORY_MAX,
  listSitePages,
  pageNameOf,
  publishPage,
  readPageState,
  type HistoryEntry,
  type PageStepReport,
  type PublishPageResult,
  type PublishedRecord,
} from '../publish/publishPage'

const props = defineProps<{
  config: PageConfig
  siteName: string
  user: string
  api: TbApi
  /** 校验 error 数,> 0 不许发布 */
  errorCount: number
  published?: PublishedRecord
  /** 初始页面资产名;缺省 <站点>-<标题> */
  pageName?: string
}>()
const emit = defineEmits<{
  published: [pageName: string, rec: PublishedRecord]
  /** 恢复历史版本后把那版配置装回编辑器 */
  restored: [config: PageConfig]
  close: []
}>()

const STEP_TITLE: Record<string, string> = {
  resolve: '① 按名称解析实体',
  asset: '② 查找 / 创建 ScadaPage 资产',
  history: '③ 历史入栈',
  write: '④ 写 pageConfig / version',
  relation: '⑤ 站点 Contains 关系',
  assign: '⑥ 分配到 Customer',
}

const derived = () => props.pageName || pageNameOf(props.siteName, props.config)
const pageName = ref(derived())
watch(
  () => [props.siteName, props.config.title, props.pageName],
  () => (pageName.value = derived())
)
const busy = ref(false)
const steps = ref<PageStepReport[]>([])
const result = ref<PublishPageResult | null>(null)
const canPublish = computed(() => !busy.value && !!props.siteName && props.errorCount === 0 && !!pageName.value.trim())
const blockReason = computed(() =>
  !props.siteName ? '先在左栏填站点名(站点资产名)' : props.errorCount ? `校验有 ${props.errorCount} 个错误` : ''
)

// ---------- 资产现状 / 历史 ----------
const remote = ref<{ assetId: string; version: number | null } | null>(null)
const history = ref<HistoryEntry[]>([])
const remoteMsg = ref('')
async function loadRemote() {
  remote.value = null
  history.value = []
  remoteMsg.value = '读取中…'
  try {
    const pages = await listSitePages(props.api, props.siteName)
    const p = pages.find(x => x.name === pageName.value)
    if (!p) {
      remoteMsg.value = `TB 上还没有「${pageName.value}」,发布会新建`
      return
    }
    remote.value = { assetId: p.assetId, version: p.version }
    history.value = (await readPageState(props.api, p.assetId)).history
    remoteMsg.value = `TB 上 version ${p.version ?? '-'} · 历史 ${history.value.length}/${HISTORY_MAX} 版`
  } catch (e) {
    remoteMsg.value = '读取失败:' + (e instanceof Error ? e.message : String(e))
  }
}
onMounted(loadRemote)
watch(pageName, loadRemote)

// ---------- 发布 / 恢复 ----------
async function run(config: PageConfig, label: string) {
  busy.value = true
  steps.value = []
  result.value = null
  try {
    const r = await publishPage(config as never, props.api, {
      siteName: props.siteName,
      pageName: pageName.value,
      publishedBy: props.user,
      report: s => steps.value.push(s),
    })
    result.value = r
    if (r.ok) {
      emit('published', r.pageName, { assetId: r.assetId!, version: r.version!, at: Date.now(), by: props.user })
      if (label === 'restore') emit('restored', config)
    }
    await loadRemote()
  } finally {
    busy.value = false
  }
}
const publishNow = () => run(props.config, 'publish')
function restore(h: HistoryEntry) {
  if (
    !confirm(
      `把 version ${h.version}(${new Date(h.ts).toLocaleString()} · ${h.publishedBy})恢复为当前?当前版会进历史。`
    )
  )
    return
  void run(h.config as unknown as PageConfig, 'restore')
}
const fmt = (ts: number) => new Date(ts).toLocaleString()
const mark = (s: PageStepReport['status']) => (s === 'ok' ? '✓' : s === 'err' ? '✗' : s === 'rollback' ? '↩' : '…')
</script>

<template>
  <div class="pp">
    <div class="pp-head">
      <b>发布到 ThingsBoard</b>
      <span class="dim"
        >站点 <code>{{ siteName || '(未填)' }}</code> · 操作者 <code>{{ user }}</code></span
      >
      <button type="button" class="pp-x" @click="emit('close')">×</button>
    </div>
    <label class="pp-field">
      页面资产名
      <input v-model="pageName" data-role="page-name" :disabled="busy" />
    </label>
    <div class="dim" data-role="remote">{{ remoteMsg }}</div>
    <div v-if="published" class="dim" data-role="local">
      项目文件记录:version {{ published.version }} · {{ fmt(published.at) }} · {{ published.by }}
      <b v-if="remote && remote.version !== published.version" class="warn"
        >(与 TB 上的 version {{ remote.version ?? '-' }} 不一致)</b
      >
    </div>
    <div class="pp-actions">
      <button
        type="button"
        class="pp-primary"
        :disabled="!canPublish"
        :title="blockReason"
        data-role="publish"
        @click="publishNow"
      >
        {{ busy ? '发布中…' : remote ? `发布(→ version ${(remote.version ?? 0) + 1})` : '发布(新建)' }}
      </button>
      <span v-if="blockReason" class="warn">{{ blockReason }}</span>
    </div>

    <ol v-if="steps.length" class="pp-steps" data-role="steps">
      <li v-for="(s, i) in steps" :key="i" :class="s.status">
        <span class="pp-mark">{{ mark(s.status) }}</span> {{ STEP_TITLE[s.step] ?? s.step }}
        <span v-if="s.detail" class="dim">— {{ s.detail }}</span>
      </li>
    </ol>
    <div v-if="result" class="pp-result" :class="result.ok ? 'ok' : 'bad'" data-role="result">
      <template v-if="result.ok">
        已发布「{{ result.pageName }}」version {{ result.version }} · 历史 {{ result.historyLength }} 版 · 资产
        <code>{{ result.assetId }}</code
        >(宿主 /scada/{{ result.assetId }})
      </template>
      <template v-else>
        失败于 {{ STEP_TITLE[result.failedStep ?? ''] ?? result.failedStep }}:{{ result.error }}
        <ul v-if="result.unresolved.length">
          <li v-for="u in result.unresolved" :key="u.type + u.name">
            <code>{{ u.type }} {{ u.name }}</code> 出现在 {{ u.at.join(', ') }}
          </li>
        </ul>
        <div v-if="result.rolledBack.length">已回滚:{{ result.rolledBack.join(' → ') }}</div>
      </template>
    </div>

    <h3>
      历史版本 <span class="dim">最近 {{ HISTORY_MAX }} 版,选一版「恢复为当前」</span>
    </h3>
    <table v-if="history.length" class="pp-hist" data-role="history">
      <thead>
        <tr>
          <th>version</th>
          <th>时间</th>
          <th>发布者</th>
          <th>模板 · 组件数</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="h in history" :key="h.version + ':' + h.ts">
          <td>{{ h.version }}</td>
          <td>{{ fmt(h.ts) }}</td>
          <td>{{ h.publishedBy }}</td>
          <td>{{ h.config.template }} · {{ h.config.widgets.length }}</td>
          <td><button type="button" class="pp-mini" :disabled="busy" @click="restore(h)">恢复为当前</button></td>
        </tr>
      </tbody>
    </table>
    <div v-else class="dim">还没有历史(首次发布或资产不存在)</div>
  </div>
</template>

<style>
.pp {
  display: grid;
  gap: 8px;
  font-size: 13px;
}
.pp-head {
  display: flex;
  align-items: baseline;
  gap: 10px;
}
.pp-x {
  margin-left: auto;
  background: none;
  border: 0;
  color: inherit;
  font-size: 18px;
  cursor: pointer;
}
.pp-field {
  display: grid;
  gap: 4px;
}
.pp-field input {
  background: var(--ed-bg-1, #0b1a33);
  border: 1px solid var(--ed-line, rgba(83, 196, 255, 0.2));
  border-radius: 6px;
  padding: 5px 8px;
  color: inherit;
  font: inherit;
}
.pp-actions {
  display: flex;
  gap: 10px;
  align-items: center;
}
.pp-primary {
  background: #1f6feb;
  border: 0;
  border-radius: 6px;
  padding: 6px 14px;
  color: #fff;
  font: inherit;
  cursor: pointer;
}
.pp-primary:disabled {
  opacity: 0.45;
  cursor: default;
}
.pp .warn {
  color: #ffd27a;
}
.pp-steps {
  margin: 0;
  padding-left: 0;
  list-style: none;
  display: grid;
  gap: 2px;
}
.pp-steps li.err {
  color: #ff8a8a;
}
.pp-steps li.rollback {
  color: #ffd27a;
}
.pp-mark {
  display: inline-block;
  width: 1.2em;
}
.pp-result {
  padding: 8px 10px;
  border-radius: 6px;
  border: 1px solid;
}
.pp-result.ok {
  border-color: rgba(111, 227, 160, 0.5);
  background: rgba(111, 227, 160, 0.08);
}
.pp-result.bad {
  border-color: rgba(255, 138, 138, 0.5);
  background: rgba(255, 138, 138, 0.08);
}
.pp h3 {
  margin: 6px 0 0;
  font-size: 13px;
}
.pp-hist {
  border-collapse: collapse;
  width: 100%;
}
.pp-hist th,
.pp-hist td {
  text-align: left;
  padding: 3px 6px;
  border-bottom: 1px solid var(--ed-line, rgba(83, 196, 255, 0.15));
  font-weight: 400;
}
.pp-mini {
  background: var(--ed-bg-1, #0b1a33);
  border: 1px solid var(--ed-line, rgba(83, 196, 255, 0.2));
  border-radius: 4px;
  padding: 1px 8px;
  color: inherit;
  font: inherit;
  font-size: 12px;
  cursor: pointer;
}
</style>
