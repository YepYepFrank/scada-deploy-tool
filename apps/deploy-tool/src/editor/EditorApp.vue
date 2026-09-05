<script setup lang="ts">
/**
 * 组态编辑器(T3.2 起,独立页 editor.html;T3.7 发布器完成后接入向导第 4 步):
 * 左:模板卡片;中:槽位示意图(点槽位选组件);右:当前槽位、撤销 / 重做、校验结果、JSON。
 */
import { computed, ref, watch } from 'vue'
import {
  getTemplate,
  listTemplates,
  listWidgets,
  registerBuiltins,
  validateAgainstRegistry,
  validatePageConfig,
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
import { useEditorState } from './useEditorState'
import { validateProps } from './props-form'
import { useMeta } from '../meta/useMeta'
import type { BindingFlag } from './binding-check'

registerBuiltins()
const templates = listTemplates()
const widgets = listWidgets()

const initial: PageConfig = { schemaVersion: 1, template: templates[0]!.id, title: '新页面', widgets: [] }
const ed = useEditorState(initial)
// TB 连接 + 元数据树(绑定选择器用);凭据只在内存
const meta = useMeta()
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

// ---------- 校验(schema + 注册表;T3.5 再加绑定存在性等层) ----------
const issues = computed(() => {
  const cfg = ed.config.value
  const sv = validatePageConfig(cfg)
  const list: { level: string; path: string; message: string }[] = []
  if (!sv.ok) list.push(...sv.issues.map(i => ({ level: 'error', path: i.path, message: i.message })))
  list.push(...validateAgainstRegistry(cfg))
  // 属性值校验(propsSchema:越界 / 类型 / 枚举),T3.5 会并入统一校验层
  for (const w of cfg.widgets) {
    const def = widgets.find(d => d.type === w.type)
    if (!def) continue
    for (const i of validateProps(def.propsSchema, w.props ?? {}))
      list.push({ level: 'error', path: `/widgets/${w.id}/props/${i.path}`, message: i.message })
  }
  // 当前组件绑定面板给出的类型提示(黄)
  if (selectedWidget.value)
    for (const [slot, f] of Object.entries(bindingFlags.value))
      if (f?.level === 'warning')
        list.push({
          level: 'warning',
          path: `/widgets/${selectedWidget.value.id}/bindings/${slot}`,
          message: f.message,
        })
  return list
})
const errorCount = computed(() => issues.value.filter(i => i.level === 'error').length)

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
    ed.commit(cfg)
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

const toastMsg = ref('')
let toastTimer: ReturnType<typeof setTimeout> | null = null
function toast(m: string) {
  toastMsg.value = m
  if (toastTimer) clearTimeout(toastTimer)
  toastTimer = setTimeout(() => (toastMsg.value = ''), 2600)
}
</script>

<template>
  <div class="ed">
    <aside class="ed-left">
      <h1>组态编辑器 <small>T3.2 · 模板与槽位</small></h1>
      <label class="ed-field">页面标题 <input v-model.lazy="title" /></label>
      <h2>模板</h2>
      <TemplatePicker v-model="templateId" :templates="templates" />

      <h2>ThingsBoard <span class="dim">绑定选择器的实体 / 测点来源</span></h2>
      <div class="ed-conn">
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
        <button type="button" @click="ed.reset()">清空</button>
        <span class="ed-hint"
          >点击槽位选择组件 · {{ template.name }} · {{ ed.config.value.widgets.length }} 个组件</span
        >
        <span class="ed-issues" :class="{ bad: errorCount }">{{
          errorCount ? `${errorCount} 个错误` : '校验通过'
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

      <h2>校验</h2>
      <ul v-if="issues.length" class="ed-issue-list">
        <li v-for="(i, k) in issues" :key="k" :class="i.level">
          <code>{{ i.path }}</code> {{ i.message }}
        </li>
      </ul>
      <div v-else class="dim">schema 与注册表校验通过</div>

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
