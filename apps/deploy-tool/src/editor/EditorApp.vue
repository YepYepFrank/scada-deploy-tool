<script setup lang="ts">
/**
 * 组态编辑器(T3.2 起,独立页 editor.html;T3.7 发布器完成后接入向导第 4 步):
 * 左:模板卡片;中:槽位示意图(点槽位选组件);右:当前槽位、撤销 / 重做、校验结果、JSON。
 */
import { computed, reactive, ref, watch } from 'vue'
import {
  getTemplate,
  listTemplates,
  listWidgets,
  migrateConfigProps,
  registerBuiltins,
  type PageConfig,
  type TemplateDefinition,
  type TemplateSlotDefinition,
  type WidgetConfig,
  type WidgetDefinition,
} from '@grid/scada-renderer'
import TemplatePicker from './TemplatePicker.vue'
import SlotBoard from './SlotBoard.vue'
import WidgetPicker from './WidgetPicker.vue'
import PropsForm from './PropsForm.vue'
import BindingsPanel from './BindingsPanel.vue'
import PreviewPane from './PreviewPane.vue'
import PublishPanel from './PublishPanel.vue'
import { useProject } from '../project/useProject'
import { ProjectParseError } from '../project/scadaproj'
import { detectDrift, pageNameOf, readPageState, type DriftItem, type PublishedRecord } from '../publish/publishPage'
import { useEditorState } from './useEditorState'
import { useMeta, type EditorSession } from '../meta/useMeta'
import { serializeProject } from '../project/scadaproj'
import { LAYER_TITLE, sortIssues, validateBindingsLayer, validateStatic, type PageIssue } from './validate'
import type { BindingFlag } from './binding-check'

/**
 * embedded:嵌进向导第 4 步——隐藏标题与 TB 连接面板,采用向导已登录的 session(T3.7 接入)。
 * 独立页(editor.html)不传这两个 prop。
 */
const props = defineProps<{ embedded?: boolean; session?: EditorSession | null }>()

registerBuiltins()
const templates = listTemplates()
const widgets = listWidgets()

const initial: PageConfig = { schemaVersion: 1, template: templates[0]!.id, title: '新页面', widgets: [] }
const ed = useEditorState(initial)
// TB 连接 + 元数据树(绑定选择器用);凭据只在内存
const meta = useMeta()
watch(
  () => props.session,
  s => {
    if (s?.token) void meta.adopt(s)
  },
  { immediate: true, deep: true }
)

// ---------- 项目文件 / 发布 / 漂移(T3.7) ----------
/** 读入外部配置(导入 / TB 读回 / 恢复历史 / JSON 粘贴)统一走这里:旧属性名先正规化,校验层才不会把它当多余键 */
function loadConfig(cfg: PageConfig) {
  ed.commit(migrateConfigProps(cfg))
  selected.value = null
}
const project = useProject({ getConfig: () => ed.config.value, setConfig: loadConfig, conn: meta.conn })
const publishOpen = ref(false)
/** 页面资产名:缺省 <站点>-<标题>;从 TB 读回的页面沿用它在 TB 上的名字(里程碑 A 那种自由命名的资产也能原地更新) */
const pageNameOverride = ref<string | null>(null)
const currentPageName = computed(() => pageNameOverride.value ?? pageNameOf(meta.conn.siteName, ed.config.value))
const currentPublished = computed(() => project.published.value[currentPageName.value])
/** 清空:配置回到初始,同时放弃沿用的资产名(否则新页面会原地覆盖刚才读回的那个资产) */
function resetAll() {
  ed.reset()
  pageNameOverride.value = null
  selected.value = null
}
function onPublished(name: string, rec: PublishedRecord) {
  pageNameOverride.value = name
  project.recordPublished(name, rec)
  toast(`已发布「${name}」version ${rec.version}`)
}
async function importProject(e: Event) {
  const input = e.target as HTMLInputElement
  const f = input.files?.[0]
  input.value = ''
  if (!f) return
  try {
    const p = project.importText(await f.text(), f.name)
    selected.value = null
    toast(
      `已导入 ${f.name}:站点 ${p.siteName || '(空)'} · ${p.pages.length} 页 · 已发布记录 ${Object.keys(p.published).length} 条`
    )
    if (meta.connected.value) void checkDrift()
  } catch (err) {
    toast(err instanceof ProjectParseError ? `${err.message}:${err.issues[0] ?? ''}` : String(err))
  }
}
/** 漂移:项目文件记录的已发布 version 与 TB 上资产 additionalInfo.version 不一致(架构 §10「变更单向」) */
const drift = ref<DriftItem[]>([])
async function checkDrift() {
  if (!meta.connected.value || !meta.conn.siteName || !Object.keys(project.published.value).length) return
  try {
    drift.value = await detectDrift(meta.api, meta.conn.siteName, project.published.value)
  } catch (err) {
    toast('漂移检测失败:' + (err instanceof Error ? err.message : String(err)))
  }
}
// 每次连接 / 重新连接都重建元数据树(shallowRef 换引用),以它为信号跑漂移检测
watch(
  () => meta.tree.value,
  t => {
    if (t) void checkDrift()
  }
)
const dropDrift = (d: DriftItem) => (drift.value = drift.value.filter(x => x !== d))
/** 覆盖:以本地为准 → 打开发布面板重发 */
function driftOverride(d: DriftItem) {
  dropDrift(d)
  publishOpen.value = true
}
/** 保留:以 TB 为准 → 把 TB 上的当前版反向导入编辑器,项目记录对齐到远端 version */
async function driftKeep(d: DriftItem) {
  if (!d.assetId) return dropDrift(d)
  try {
    const st = await readPageState(meta.api, d.assetId)
    if (st.config) {
      loadConfig(st.config as unknown as PageConfig)
      pageNameOverride.value = d.pageName
      project.recordPublished(d.pageName, { assetId: d.assetId, version: d.remote ?? 0, at: Date.now(), by: '(TB)' })
      toast(`已以 TB 为准反向导入「${d.pageName}」version ${d.remote}`)
    }
  } catch (err) {
    toast('读取 TB 上的页面失败:' + (err instanceof Error ? err.message : String(err)))
  }
  dropDrift(d)
}
const bindingFlags = ref<Record<string, BindingFlag | null>>({})
function onBindings(next: WidgetConfig['bindings']) {
  const w = selectedWidget.value
  if (w) ed.patchWidget(w.id, x => (x.bindings = next))
}

const template = computed<TemplateDefinition>(() => getTemplate(ed.config.value.template) ?? templates[0]!)
const templateId = computed({
  get: () => ed.config.value.template,
  set: id => {
    const t = getTemplate(id)
    if (!t || t.id === ed.config.value.template) return
    const dropped = ed.setTemplate(t)
    toast(
      dropped.length
        ? `已切换到「${t.name}」,${dropped.length} 个组件因槽位不匹配被移除:${dropped.join(', ')}`
        : `已切换到「${t.name}」`
    )
    selected.value = null
  },
})

const selected = ref<string | null>(null)
const selectedSlot = computed<TemplateSlotDefinition | null>(
  () => template.value.slots.find(s => s.name === selected.value) ?? null
)
const selectedWidget = computed(() => (selected.value ? ed.widgetAt(selected.value) : undefined))
const selectedDef = computed(() =>
  selectedWidget.value ? widgets.find(w => w.type === selectedWidget.value!.type) : undefined
)
const pickerOpen = ref(false)

/** 属性面板 v-model:显示 defaults 与已设值的合并,写回时只存与默认不同的键 */
const widgetProps = computed<Record<string, unknown>>({
  get: () => ({ ...(selectedDef.value?.defaults ?? {}), ...(selectedWidget.value?.props ?? {}) }),
  set: next => {
    const w = selectedWidget.value
    if (!w) return
    const defaults = (selectedDef.value?.defaults ?? {}) as Record<string, unknown>
    const props: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(next)) if (JSON.stringify(v) !== JSON.stringify(defaults[k])) props[k] = v
    ed.setWidgetProps(w.id, props)
  },
})

function onSelect(slot: string) {
  selected.value = slot
  pickerOpen.value = true
}
function onPick(def: WidgetDefinition) {
  if (!selectedSlot.value) return
  const w = ed.placeWidget(selectedSlot.value.name, def)
  pickerOpen.value = false
  toast(`槽位 ${selectedSlot.value.name} ← ${def.name}(${w.id})`)
}
function onRemove() {
  if (!selectedSlot.value) return
  ed.removeWidget(selectedSlot.value.name)
  pickerOpen.value = false
}

// ---------- 校验(T3.5 四层:同步层随配置即时算;绑定存在性层连上 TB 后防抖异步跑) ----------
const staticIssues = computed(() => validateStatic(ed.config.value))
const bindingIssues = ref<PageIssue[]>([])
const bindingChecked = ref(false)
const bindingBusy = ref(false)
let bindingRun = 0
let bindingTimer: ReturnType<typeof setTimeout> | undefined
async function runBindingLayer() {
  const run = ++bindingRun
  const cfg = ed.config.value
  const m = { tree: meta.tree.value, client: meta.client.value }
  if (!m.tree || !m.client) {
    bindingIssues.value = []
    bindingChecked.value = false
    return
  }
  bindingBusy.value = true
  try {
    const list = await validateBindingsLayer(cfg, m)
    if (run !== bindingRun) return
    bindingIssues.value = list
    bindingChecked.value = true
  } finally {
    if (run === bindingRun) bindingBusy.value = false
  }
}
watch(
  () => [ed.config.value, meta.client.value] as const,
  () => {
    clearTimeout(bindingTimer)
    bindingTimer = setTimeout(runBindingLayer, 300)
  },
  { immediate: true }
)
const issues = computed(() => {
  const list: PageIssue[] = [...staticIssues.value, ...bindingIssues.value]
  // 当前组件绑定面板给出的类型提示(黄,来自最近值类型),校验层没有这条
  if (selectedWidget.value)
    for (const [slot, f] of Object.entries(bindingFlags.value))
      if (f?.level === 'warning')
        list.push({
          level: 'warning',
          layer: 'binding',
          path: `/widgets/${selectedWidget.value.id}/bindings/${slot}`,
          widgetId: selectedWidget.value.id,
          slot,
          message: f.message,
        })
  return sortIssues(list)
})
const errorCount = computed(() => issues.value.filter(i => i.level === 'error').length)
const warningCount = computed(() => issues.value.length - errorCount.value)
/** 点问题行 → 选中对应组件所在槽位(模板槽位问题直接选该槽位) */
function gotoIssue(i: PageIssue) {
  const w = i.widgetId ? ed.config.value.widgets.find(x => x.id === i.widgetId) : undefined
  const slot = w?.slot ?? (i.layer === 'template' && !i.widgetId ? i.slot : undefined)
  if (slot && template.value.slots.some(s => s.name === slot)) {
    selected.value = slot
    pickerOpen.value = false
  }
}

// ---------- 标题 / JSON ----------
const title = computed({
  get: () => ed.config.value.title ?? '',
  set: v => ed.update(d => (d.title = v)),
})
const json = computed(() => JSON.stringify(ed.config.value, null, 2))
const jsonDraft = ref('')
const jsonMsg = ref('')
watch(json, v => (jsonDraft.value = v), { immediate: true })
function applyJson() {
  try {
    const cfg = JSON.parse(jsonDraft.value) as PageConfig
    loadConfig(cfg)
    jsonMsg.value = '已应用'
  } catch (e) {
    jsonMsg.value = 'JSON 解析失败:' + (e instanceof Error ? e.message : String(e))
  }
}
async function copyJson() {
  try {
    await navigator.clipboard.writeText(json.value)
    toast('JSON 已复制')
  } catch {
    toast('复制失败,请手动选择文本')
  }
}
function importFile(e: Event) {
  const f = (e.target as HTMLInputElement).files?.[0]
  if (!f) return
  f.text().then(t => {
    jsonDraft.value = t
    applyJson()
  })
}

// ---------- 撤销 / 重做 + 快捷键 ----------
function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape' && previewOpen.value) {
    previewOpen.value = false
    return
  }
  if (previewOpen.value) return
  if (!(e.ctrlKey || e.metaKey)) return
  if (e.key.toLowerCase() === 'z' && !e.shiftKey) {
    e.preventDefault()
    ed.undo()
  } else if (e.key.toLowerCase() === 'y' || (e.key.toLowerCase() === 'z' && e.shiftKey)) {
    e.preventDefault()
    ed.redo()
  }
}
window.addEventListener('keydown', onKey)

// ---------- 预览(T3.6):隐藏编辑壳,用编辑器已登录的租户连接 / 现场登录的 Customer 渲染 ----------
const previewOpen = ref(false)
const customerIdentity = computed(() => meta.identities.find(i => i.id === 'customer'))
const previewTitle = computed(() =>
  !meta.connected.value
    ? '先在左栏连接 TB'
    : meta.conn.authority !== 'TENANT_ADMIN'
      ? `当前连接是 ${meta.conn.authority},预览会以此身份渲染`
      : '用真数据渲染当前 JSON'
)

const toastMsg = ref('')
let toastTimer: ReturnType<typeof setTimeout> | null = null
function toast(m: string) {
  toastMsg.value = m
  if (toastTimer) clearTimeout(toastTimer)
  toastTimer = setTimeout(() => (toastMsg.value = ''), 2600)
}

/** 给外部壳(向导)用的只读状态与少量操作 */
const state = reactive({
  config: computed(() => ed.config.value),
  errorCount: computed(() => errorCount.value),
  published: computed(() => project.published.value),
  currentPageName: computed(() => currentPageName.value),
  connected: computed(() => meta.connected.value),
})
defineExpose({
  state,
  setConfig: loadConfig,
  recordPublished: project.recordPublished,
  /** 从 TB 读回的页面:沿用资产名,发布时原地更新而不是新建 */
  setPageName(name: string | null) {
    pageNameOverride.value = name
  },
  /** 导出 .scadaproj 文本;向导把 rules(tbsite 配置)一起塞进去 */
  exportText(rules: unknown = null) {
    return serializeProject({ ...project.current.value, rules })
  },
  importText: project.importText,
  openPublish() {
    publishOpen.value = true
  },
  openPreview() {
    previewOpen.value = true
  },
})
</script>

<template>
  <PreviewPane
    v-if="previewOpen"
    :config="ed.config.value"
    :base="meta.conn.base"
    :tenant-token="meta.conn.token"
    :tenant-user="meta.conn.user"
    :customer-user="customerIdentity?.user"
    :customer-pass="customerIdentity?.pass"
    @close="previewOpen = false"
  />
  <div v-else class="ed" :class="{ 'ed-embedded': embedded }">
    <div v-if="publishOpen" class="ed-modal" data-role="publish-modal">
      <div class="ed-modal-box">
        <PublishPanel
          :config="ed.config.value"
          :site-name="meta.conn.siteName"
          :user="meta.conn.user"
          :api="meta.api"
          :error-count="errorCount"
          :page-name="currentPageName"
          :published="currentPublished"
          @published="onPublished"
          @restored="loadConfig"
          @close="publishOpen = false"
        />
      </div>
    </div>
    <div v-if="drift.length" class="ed-modal" data-role="drift-modal">
      <div class="ed-modal-box">
        <b>发布版本与 ThingsBoard 不一致</b>
        <p class="dim">
          项目文件记录的已发布 version 与 TB 上资产的 version 不同,说明有人在 TB 上直接改过,或这份项目文件不是最新。
        </p>
        <div v-for="d in drift" :key="d.pageName" class="ed-drift" :data-page="d.pageName">
          <div>
            <code>{{ d.pageName }}</code> 本地 version {{ d.local }} · TB 上
            {{ d.remote === null ? '资产已不存在' : `version ${d.remote}` }}
          </div>
          <div class="ed-drift-btns">
            <button type="button" data-role="drift-override" @click="driftOverride(d)">
              覆盖(以本地为准,重新发布)
            </button>
            <button type="button" :disabled="d.remote === null" data-role="drift-keep" @click="driftKeep(d)">
              保留(以 TB 为准,反向导入)
            </button>
            <button type="button" data-role="drift-cancel" @click="dropDrift(d)">取消</button>
          </div>
        </div>
      </div>
    </div>
    <aside class="ed-left">
      <h1 v-if="!embedded">组态编辑器 <small>T3.2 · 模板与槽位</small></h1>
      <label class="ed-field">页面标题 <input v-model.lazy="title" /></label>
      <h2>模板</h2>
      <TemplatePicker v-model="templateId" :templates="templates" />

      <h2>项目文件 <span class="dim">.scadaproj · 页面的「源码」</span></h2>
      <div class="ed-proj">
        <button type="button" class="ed-mini" data-role="proj-export" @click="project.exportFile()">导出</button>
        <label class="ed-mini ed-file"
          >导入<input type="file" accept=".scadaproj,application/json" data-role="proj-import" @change="importProject"
        /></label>
        <span class="dim">{{ project.fileName.value || '未保存' }}</span>
        <div v-if="currentPublished" class="dim" data-role="proj-published">
          「{{ currentPageName }}」已发布 version {{ currentPublished.version }} · {{ currentPublished.by }}
        </div>
      </div>

      <h2 v-if="!embedded">ThingsBoard <span class="dim">绑定选择器的实体 / 测点来源</span></h2>
      <div v-if="!embedded" class="ed-conn">
        <label class="ed-field">地址 <input v-model="meta.conn.base" /></label>
        <label v-if="meta.identities.length > 1" class="ed-field"
          >身份预填
          <select v-model="meta.conn.identity" @change="meta.pickIdentity()">
            <option v-for="i in meta.identities" :key="i.id" :value="i.id">{{ i.label }} · {{ i.user }}</option>
          </select></label
        >
        <label class="ed-field">账号 <input v-model="meta.conn.user" autocomplete="username" /></label>
        <label class="ed-field"
          >密码 <input v-model="meta.conn.pass" type="password" autocomplete="current-password"
        /></label>
        <label class="ed-field">站点名 <input v-model="meta.conn.siteName" placeholder="树根显示用" /></label>
        <div class="ed-conn-foot">
          <button type="button" :disabled="meta.conn.busy" @click="meta.connect()">
            {{ meta.connected.value ? '重新连接' : '连接' }}
          </button>
          <button v-if="meta.connected.value" type="button" :disabled="meta.conn.busy" @click="meta.refresh()">
            刷新树
          </button>
          <span class="dim">{{ meta.conn.msg }}</span>
        </div>
      </div>
    </aside>

    <main class="ed-main">
      <div class="ed-toolbar">
        <button type="button" :disabled="!ed.canUndo.value" title="Ctrl+Z" @click="ed.undo()">
          撤销 ({{ ed.state.pastCount }})
        </button>
        <button type="button" :disabled="!ed.canRedo.value" title="Ctrl+Y" @click="ed.redo()">
          重做 ({{ ed.state.futureCount }})
        </button>
        <button type="button" @click="resetAll">清空</button>
        <button
          type="button"
          class="ed-preview"
          :disabled="!meta.connected.value"
          :title="previewTitle"
          data-role="preview"
          @click="previewOpen = true"
        >
          预览
        </button>
        <button
          type="button"
          class="ed-publish"
          :disabled="!meta.connected.value || errorCount > 0"
          :title="
            !meta.connected.value
              ? '先在左栏连接 TB'
              : errorCount
                ? `校验有 ${errorCount} 个错误`
                : '发布到 ScadaPage 资产'
          "
          data-role="publish-open"
          @click="publishOpen = true"
        >
          发布
        </button>
        <span class="ed-hint"
          >点击槽位选择组件 · {{ template.name }} · {{ ed.config.value.widgets.length }} 个组件</span
        >
        <span class="ed-issues" :class="{ bad: errorCount, warn: !errorCount && warningCount }">{{
          errorCount ? `${errorCount} 个错误,不可发布` : warningCount ? `${warningCount} 个提示` : '校验通过'
        }}</span>
      </div>
      <SlotBoard :config="ed.config.value" :template="template" :selected="selected" @select="onSelect" />
      <div v-if="toastMsg" class="ed-toast">{{ toastMsg }}</div>
    </main>

    <aside class="ed-right">
      <h2>当前槽位</h2>
      <div v-if="selectedSlot" class="ed-slot-info">
        <b>{{ selectedSlot.title ?? selectedSlot.name }}</b> <code>{{ selectedSlot.name }}</code>
        <div class="dim">
          {{
            selectedSlot.fixed
              ? `固定:${selectedSlot.fixed.type}`
              : selectedSlot.accepts
                ? `可放:${selectedSlot.accepts.join(' / ')}`
                : '任意组件'
          }}
          <span v-if="selectedSlot.required"> · 必填</span>
        </div>
        <div v-if="selectedWidget" class="ed-widget">
          组件 <code>{{ selectedWidget.type }}</code> <span class="dim">id {{ selectedWidget.id }}</span>
        </div>
        <div v-else class="dim">空槽位</div>
        <button type="button" @click="pickerOpen = true">{{ selectedWidget ? '更换 / 移除组件' : '选择组件' }}</button>
      </div>
      <div v-else class="dim">在示意图上点一个槽位</div>

      <template v-if="selectedWidget && selectedDef">
        <h2>
          属性 <span class="dim">{{ selectedDef.name }} · 改了即时反映到示意图</span>
        </h2>
        <PropsForm :key="selectedWidget.id" v-model="widgetProps" :schema="selectedDef.propsSchema" />
        <h2>
          绑定
          <span class="dim">{{
            meta.connected.value ? `${meta.entityCount.value} 个实体可选` : '未连接 TB,可手输'
          }}</span>
        </h2>
        <BindingsPanel
          :key="'b' + selectedWidget.id"
          :def="selectedDef"
          :widget="selectedWidget"
          :tree="meta.tree.value"
          :client="meta.client.value"
          @update="onBindings"
          @flags="bindingFlags = $event"
        />
      </template>

      <h2>
        校验
        <span class="dim ed-vstate">{{
          bindingBusy ? '正在核对绑定…' : bindingChecked ? '含绑定存在性' : '未连接 TB,绑定存在性未查'
        }}</span>
      </h2>
      <ul v-if="issues.length" class="ed-issue-list">
        <li
          v-for="(i, k) in issues"
          :key="k"
          :class="[i.level, { link: !!i.widgetId || (i.layer === 'template' && !!i.slot) }]"
          :data-layer="i.layer"
          :title="i.path"
          @click="gotoIssue(i)"
        >
          <span class="ed-layer">{{ LAYER_TITLE[i.layer] }}</span>
          <code v-if="i.widgetId">{{ i.widgetId }}{{ i.slot ? '/' + i.slot : '' }}</code>
          <code v-else-if="i.slot">槽位 {{ i.slot }}</code>
          {{ i.message }}
        </li>
      </ul>
      <div v-else class="dim">{{ bindingChecked ? '四层校验通过' : '形状 / 注册表 / 模板 / 属性校验通过' }}</div>

      <h2>
        JSON
        <button type="button" class="ed-mini" @click="copyJson">复制</button>
        <label class="ed-mini ed-file">导入<input type="file" accept="application/json" @change="importFile" /></label>
      </h2>
      <textarea v-model="jsonDraft" spellcheck="false"></textarea>
      <div class="ed-json-foot">
        <button type="button" @click="applyJson">应用编辑后的 JSON</button>
        <span class="dim">{{ jsonMsg }}</span>
      </div>
    </aside>

    <WidgetPicker
      v-if="pickerOpen && selectedSlot"
      :slot-def="selectedSlot"
      :widgets="widgets"
      :current="selectedWidget?.type"
      @pick="onPick"
      @remove="onRemove"
      @close="pickerOpen = false"
    />
  </div>
</template>

<style>
:root {
  --ed-bg-0: #061024;
  --ed-bg-1: #0b1a33;
  --ed-line: rgba(83, 196, 255, 0.2);
  --ed-accent: #19b7ff;
}
body {
  margin: 0;
  background: var(--ed-bg-0);
  color: #dbeaff;
  font:
    13px/1.5 system-ui,
    'PingFang SC',
    'Microsoft YaHei',
    sans-serif;
}
.ed {
  display: grid;
  grid-template-columns: 280px 1fr 340px;
  height: 100vh;
}
.ed.ed-embedded {
  height: min(82vh, 900px);
  border: 1px solid var(--ed-line, rgba(83, 196, 255, 0.2));
  border-radius: 10px;
  overflow: hidden;
}
.ed-left,
.ed-right {
  padding: 14px;
  overflow: auto;
  border-right: 1px solid var(--ed-line);
}
.ed-right {
  border-right: none;
  border-left: 1px solid var(--ed-line);
}
.ed h1 {
  font-size: 16px;
  margin: 0 0 12px;
}
.ed h1 small {
  opacity: 0.6;
  font-weight: 400;
  margin-left: 6px;
}
.ed h2 {
  font-size: 12px;
  letter-spacing: 0.1em;
  opacity: 0.7;
  margin: 16px 0 6px;
  display: flex;
  align-items: center;
  gap: 8px;
}
.ed-main {
  padding: 14px;
  overflow: auto;
  position: relative;
}
.ed-toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 10px;
}
.ed button,
.ed input,
.ed textarea {
  font: inherit;
  color: inherit;
}
.ed button {
  background: var(--ed-bg-1);
  border: 1px solid var(--ed-line);
  border-radius: 6px;
  padding: 5px 10px;
  cursor: pointer;
}
.ed button:disabled {
  opacity: 0.4;
  cursor: default;
}
.ed button:not(:disabled):hover {
  border-color: var(--ed-accent);
}
.ed-hint {
  opacity: 0.7;
  margin-left: 6px;
}
.ed-issues {
  margin-left: auto;
  color: #6fe3a0;
}
.ed-issues.bad {
  color: #ff8a8a;
}
.ed-issues.warn {
  color: #ffd27a;
}
.ed-vstate {
  font-weight: 400;
  font-size: 11px;
  margin-left: 6px;
}
.ed-layer {
  display: inline-block;
  min-width: 2.5em;
  margin-right: 4px;
  padding: 0 4px;
  border-radius: 3px;
  font-size: 10px;
  background: rgba(255, 255, 255, 0.08);
  opacity: 0.85;
}
.ed-issue-list li.link {
  cursor: pointer;
}
.ed-issue-list li.link:hover {
  text-decoration: underline;
}
.ed-field {
  display: block;
  margin-bottom: 10px;
}
.ed-field input,
.ed textarea {
  width: 100%;
  box-sizing: border-box;
  background: var(--ed-bg-1);
  border: 1px solid var(--ed-line);
  border-radius: 6px;
  padding: 5px 8px;
}
.ed textarea {
  min-height: 260px;
  font-family: ui-monospace, Consolas, monospace;
  font-size: 12px;
}
.ed .dim {
  opacity: 0.65;
}
.ed code {
  color: var(--ed-accent);
}
.ed-slot-info button {
  margin-top: 8px;
}
.ed-widget {
  margin-top: 6px;
}
.ed-conn {
  display: grid;
  gap: 4px;
}
.ed-conn .ed-field {
  margin-bottom: 4px;
}
.ed-conn select {
  width: 100%;
  box-sizing: border-box;
  background: var(--ed-bg-1);
  border: 1px solid var(--ed-line);
  border-radius: 6px;
  padding: 5px 8px;
  color: inherit;
  font: inherit;
}
.ed-conn-foot {
  display: flex;
  gap: 6px;
  align-items: center;
  flex-wrap: wrap;
}
.ed-issue-list {
  padding-left: 16px;
  margin: 0;
}
.ed-issue-list li.error {
  color: #ff8a8a;
}
.ed-issue-list li.warning {
  color: #ffd27a;
}
.ed-mini {
  padding: 1px 8px !important;
  font-size: 12px;
}
.ed-file {
  position: relative;
  background: var(--ed-bg-1);
  border: 1px solid var(--ed-line);
  border-radius: 6px;
  cursor: pointer;
}
.ed-file input {
  position: absolute;
  inset: 0;
  opacity: 0;
  cursor: pointer;
}
.ed-json-foot {
  display: flex;
  gap: 8px;
  align-items: center;
  margin-top: 6px;
}
.ed-proj {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  margin-bottom: 10px;
  font-size: 12px;
}
.ed-proj > div {
  flex-basis: 100%;
}
.ed-publish {
  background: #1f6feb;
  color: #fff;
}
.ed-modal {
  position: fixed;
  inset: 0;
  z-index: 50;
  background: rgba(3, 10, 24, 0.7);
  display: grid;
  place-items: center;
}
.ed-modal-box {
  width: min(720px, 92vw);
  max-height: 88vh;
  overflow: auto;
  background: var(--ed-bg-0, #061127);
  border: 1px solid var(--ed-line, rgba(83, 196, 255, 0.25));
  border-radius: 10px;
  padding: 16px 18px;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
}
.ed-modal-box button {
  background: var(--ed-bg-1, #0b1a33);
  border: 1px solid var(--ed-line, rgba(83, 196, 255, 0.2));
  border-radius: 6px;
  padding: 4px 10px;
  color: inherit;
  font: inherit;
  cursor: pointer;
}
.ed-drift {
  display: grid;
  gap: 6px;
  padding: 8px 0;
  border-top: 1px solid var(--ed-line, rgba(83, 196, 255, 0.15));
}
.ed-drift-btns {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}
.ed-toast {
  position: absolute;
  left: 50%;
  bottom: 24px;
  transform: translateX(-50%);
  background: rgba(11, 26, 51, 0.95);
  border: 1px solid var(--ed-accent);
  border-radius: 8px;
  padding: 8px 14px;
}
</style>
