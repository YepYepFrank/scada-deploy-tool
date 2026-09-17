<script setup lang="ts">
/**
 * 组态编辑器(T3.2 起,独立页 editor.html;T3.7 发布器完成后接入向导第 4 步):
 * 左:模板卡片;中:槽位示意图(点槽位选组件);右:当前槽位、撤销 / 重做、校验结果、JSON。
 */
import { computed, onBeforeUnmount, provide, reactive, ref, watch } from 'vue'
import {
  CARDS_TEMPLATE_ID,
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
import { countEntities } from '../meta/MetaNode'
import { applyEntityNames, pruneTree, type EntityScope } from '../meta/scope'
import { refJson as refJsonText, refSnippet as refSnippetText } from './widget-ref'
import type { Declared } from './declared-keys'
import { serializeProject } from '../project/scadaproj'
import { LAYER_TITLE, sortIssues, validateBindingsLayer, validateStatic, type PageIssue } from './validate'
import type { BindingFlag } from './binding-check'

/**
 * embedded:嵌进向导第 4 步——隐藏标题与 TB 连接面板,采用向导已登录的 session(T3.7 接入)。
 * 嵌入态默认只显示画布缩略图(compact),点击进入全屏编辑(Teleport 到 body 的覆盖层 + 浏览器全屏),
 * 同一个组件实例,撤销栈 / 选中槽位 / 未保存改动全部保留;Esc 或「返回向导」退出。
 * 独立页(editor.html)不传这两个 prop。
 */
const props = defineProps<{
  embedded?: boolean
  session?: EditorSession | null
  /** 向导第 3 步声明、可能还没发布的输出;独立编辑器不传(见 editor/declared-keys.ts) */
  declared?: Declared | null
  /**
   * 文档种类(2026-09-14 单卡片嵌入 P2):'cards' = 站点的「卡片库」页——模板固定为 cards、标题「卡片库」、
   * 发布时资产 additionalInfo.kind = 'cards'(大屏列表跳过);缺省 'page' = 普通页面。
   */
  docKind?: 'page' | 'cards'
  /** 普通页面的编辑器:站点卡片库里的卡,组件选择器多一组「从卡片库放入」;不传则没有 */
  library?: WidgetConfig[]
  /**
   * 本站点的实体范围(2026-09-17):第 2 步认领的设备 + 第 3 步运算涉及的资产 + 站点资产。
   * 传了就默认只列这些(绑定面板有「全部实体」开关可切回全库);不传(独立 editor.html)列全库。
   */
  scope?: EntityScope | null
  /**
   * 向导里的中文名(2026-09-17):keys = 测点键 → 中文(第 2 步人工改的中文名优先于字典),
   * entities = 设备名 / 网关 TB id → 中文(补给 TB 标签没有中文的节点)。不传只用 TB 标签 + 字典。
   */
  names?: { keys?: Record<string, string>; entities?: Record<string, string> } | null
}>()
const emit = defineEmits<{
  /** 普通页面里点「存为可复用卡片」:向导把这张卡(深拷贝)放进卡片库编辑器 */
  saveCard: [card: WidgetConfig]
}>()

registerBuiltins()
const isCards = computed(() => props.docKind === 'cards')
/** 卡片库文档只有 cards 模板可选(模板固定);普通页面列表里不出现 cards */
const templates = listTemplates().filter(t =>
  props.docKind === 'cards' ? t.id === CARDS_TEMPLATE_ID : t.id !== CARDS_TEMPLATE_ID
)
const widgets = listWidgets()

const initial: PageConfig =
  props.docKind === 'cards'
    ? { schemaVersion: 1, template: CARDS_TEMPLATE_ID, title: '卡片库', widgets: [] }
    : { schemaVersion: 1, template: templates[0]!.id, title: '新页面', widgets: [] }
const ed = useEditorState(initial)
// TB 连接 + 元数据树(绑定选择器用);凭据只在内存
const meta = useMeta()
// 测点中文名给各绑定行(BindingRow 注入):网关 / 设备 / 测点一律「中文(英文)」(2026-09-11)
// 向导传来的中文(第 2 步人工改的测点中文名)优先,其次字典 / 派生规则(2026-09-17)
provide('keyCn', (key: string) => props.names?.keys?.[key] || meta.keyCn(key))
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
    // 全屏里选好模板就把左栏收起,空间让给右边的属性 / 绑定栏(2026-09-17)
    if (fullscreen.value) leftCollapsed.value = true
  },
})
/**
 * 全屏时左栏(模板 / 项目文件)可收起(2026-09-17 YY:绑定面板的下拉太窄太靠下):
 * 收起后右栏从 340px 加宽到 520px;选好模板自动收起,进全屏时页面里已有组件也默认收起;点左侧竖条随时展开。
 */
const leftCollapsed = ref(false)

/**
 * 绑定选择器用的实体树(2026-09-17):向导传了 scope 就默认只列本站点范围(认领的设备 + 运算涉及的资产 + 站点资产),
 * 「全部实体」开关可切回全库;校验层仍用全库树(绑到范围外的实体也是存在的,不算错)。
 */
const scopeOnly = ref(true)
const tree = computed(() =>
  applyEntityNames(
    props.scope && scopeOnly.value ? pruneTree(meta.tree.value, props.scope) : meta.tree.value,
    props.names?.entities
  )
)
const entityCount = computed(() => (tree.value ? countEntities(tree.value) : 0))

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
const cloneCard = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T
/** 从卡片库放入当前槽位:整张卡(属性 + 绑定)复制,新 id;复制后两边各改各的 */
function onPickCard(card: WidgetConfig) {
  if (!selectedSlot.value) return
  const def = widgets.find(w => w.type === card.type)
  if (!def) return toast(`卡片类型 ${card.type} 未注册`)
  const w = ed.placeWidget(selectedSlot.value.name, def, {
    props: cloneCard(card.props ?? {}),
    bindings: cloneCard(card.bindings ?? {}),
    ...(card.actions ? { actions: cloneCard(card.actions) } : {}),
  })
  pickerOpen.value = false
  toast(`槽位 ${selectedSlot.value.name} ← 卡片库「${cardTitle(card)}」(新 id ${w.id})`)
}
const cardTitle = (c: WidgetConfig) => (typeof c.props?.title === 'string' && c.props.title) || c.type
/**
 * 复制引用(2026-09-14 单卡片嵌入 P3):前端按「页面资产 id + 组件 id」嵌单卡。
 * 页面 id 只有发布过才有(项目记录里的 assetId);没发布提示先发布。
 */
const refPageId = computed(() => currentPublished.value?.assetId ?? null)
const refJson = (w: WidgetConfig) => refJsonText(refPageId.value, w.id)
const refSnippet = (w: WidgetConfig) => refSnippetText(refPageId.value, w, cardTitle(w))
async function copyRef(kind: 'json' | 'code') {
  const w = selectedWidget.value
  if (!w) return
  if (!refPageId.value) return toast('页面还没发布,没有页面 id;先发布再复制引用')
  try {
    await navigator.clipboard.writeText(kind === 'json' ? refJson(w) : refSnippet(w))
    toast(kind === 'json' ? '引用已复制:{ pageId, widgetId }' : '接入代码已复制')
  } catch {
    toast('复制失败,请手动选择文本')
  }
}
/** 普通页面:把当前组件存为可复用卡片(向导接住,放进卡片库编辑器) */
function saveAsCard() {
  const w = selectedWidget.value
  if (!w) return
  emit('saveCard', cloneCard(w))
}
/**
 * 把一张卡放进本文档的第一个空槽位(卡片库编辑器接「存为可复用卡片」用):复制、新 id;满了返回 null。
 * 只放类型允许的槽位(cards 模板任意组件,这里仍按 accepts / fixed 过滤以防以后换模板)。
 */
function addWidget(card: WidgetConfig): string | null {
  const def = widgets.find(w => w.type === card.type)
  if (!def) return null
  const used = new Set(ed.config.value.widgets.map(w => w.slot))
  const slot = template.value.slots.find(
    s => !used.has(s.name) && (s.fixed ? s.fixed.type === card.type : !s.accepts || s.accepts.includes(card.type))
  )
  if (!slot) return null
  ed.placeWidget(slot.name, def, {
    props: cloneCard(card.props ?? {}),
    bindings: cloneCard(card.bindings ?? {}),
    ...(card.actions ? { actions: cloneCard(card.actions) } : {}),
  })
  return slot.name
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
  if (e.key === 'Escape' && fullscreen.value && !previewOpen.value && !pickerOpen.value && !publishOpen.value) {
    void exitFullscreen()
    return
  }
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

// ---------- 全屏编辑(嵌入向导时:缩略图 → 点击全屏;Esc / 返回向导 退出) ----------
const fullscreen = ref(false)
/** 嵌入且未全屏:只画缩略图 + 一行状态,左右栏与工具栏都不显示 */
const compact = computed(() => !!props.embedded && !fullscreen.value)
/** 右栏 JSON 源码默认折起(高级功能,不和「当前槽位」抢空间) */
const showJson = ref(false)
async function enterFullscreen() {
  if (!props.embedded) return
  fullscreen.value = true
  // 页面里已经有组件 = 模板已定,进来就把左栏收起;空页面先让人选模板
  leftCollapsed.value = ed.config.value.widgets.length > 0
  try {
    await document.documentElement.requestFullscreen?.()
  } catch {
    /* 浏览器不允许时只用覆盖层,效果一样 */
  }
}
async function exitFullscreen() {
  fullscreen.value = false
  if (document.fullscreenElement) await document.exitFullscreen().catch(() => {})
}
/** 浏览器层按 Esc 退出全屏 → 一起退回向导;预览 / 弹窗打开时 Esc 归它们,覆盖层留着 */
function onFsChange() {
  if (fullscreen.value && !document.fullscreenElement && !previewOpen.value && !pickerOpen.value && !publishOpen.value)
    fullscreen.value = false
}
document.addEventListener('fullscreenchange', onFsChange)
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKey)
  document.removeEventListener('fullscreenchange', onFsChange)
  if (document.fullscreenElement) void document.exitFullscreen().catch(() => {})
})

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
  /** 把一张卡放进第一个空槽位(卡片库接「存为可复用卡片」);返回槽位名,满了 / 类型未注册返回 null */
  addWidget,
  openPublish() {
    publishOpen.value = true
  },
  openPreview() {
    previewOpen.value = true
  },
  enterFullscreen,
  exitFullscreen,
  /** 卡片库列表(向导)用:进全屏并选中某格;格是空的就弹组件选择 */
  async editSlot(slot: string) {
    await enterFullscreen()
    selected.value = slot
    pickerOpen.value = !ed.widgetAt(slot)
  },
  removeSlot(slot: string) {
    ed.removeWidget(slot)
    if (selected.value === slot) selected.value = null
  },
  /** 第一个空格的槽位名;满了 null */
  firstEmptySlot(): string | null {
    const used = new Set(ed.config.value.widgets.map(w => w.slot))
    return template.value.slots.find(s => !used.has(s.name))?.name ?? null
  },
})
</script>

<template>
  <Teleport to="body" :disabled="!fullscreen">
    <div :class="{ 'ed-fs-host': fullscreen }">
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
      <div
        v-else
        class="ed"
        :class="{
          'ed-embedded': compact,
          'ed-compact': compact,
          'ed-fullscreen': fullscreen,
          'ed-left-collapsed': fullscreen && leftCollapsed,
        }"
      >
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
              :kind="isCards ? 'cards' : undefined"
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
        <!-- 嵌入向导的缩略图态:只看画布,点击进入全屏 -->
        <template v-if="compact">
          <div class="ed-compact-canvas" data-role="compact-canvas" @click="enterFullscreen">
            <SlotBoard :config="ed.config.value" :template="template" :selected="null" />
            <div class="ed-compact-mask"><span>点击进入全屏编辑</span></div>
          </div>
          <div class="ed-compact-bar">
            <b>{{ title }}</b>
            <span class="dim">{{ template.name }} · {{ ed.config.value.widgets.length }} 个组件</span>
            <span class="ed-issues" :class="{ bad: errorCount, warn: !errorCount && warningCount }">{{
              errorCount ? `${errorCount} 个错误,不可发布` : warningCount ? `${warningCount} 个提示` : '校验通过'
            }}</span>
            <span v-if="currentPublished" class="dim">已发布 version {{ currentPublished.version }}</span>
            <button type="button" class="ed-fs-btn" data-role="fullscreen-open" @click="enterFullscreen">
              全屏编辑
            </button>
          </div>
        </template>
        <template v-else>
          <header v-if="fullscreen" class="ed-fsbar">
            <button type="button" data-role="fullscreen-exit" @click="exitFullscreen">
              ← 返回向导 <span class="dim">Esc</span>
            </button>
            <b>{{ title }}</b>
            <span class="dim">{{ template.name }} · {{ ed.config.value.widgets.length }} 个组件</span>
            <span v-if="currentPublished" class="dim"
              >已发布 version {{ currentPublished.version }} · {{ currentPublished.by }}</span
            >
          </header>
          <aside v-if="fullscreen && leftCollapsed" class="ed-left ed-left-strip" data-role="left-strip">
            <button
              type="button"
              class="ed-strip-btn"
              title="展开左栏(模板 / 项目文件)"
              data-role="left-expand"
              @click="leftCollapsed = false"
            >
              ▶<span class="ed-strip-text">{{ isCards ? '卡片库' : template.name }}</span>
            </button>
          </aside>
          <aside v-else class="ed-left">
            <button
              v-if="fullscreen"
              type="button"
              class="ed-mini ed-left-collapse"
              title="收起左栏,把空间让给右边的属性 / 绑定栏"
              data-role="left-collapse"
              @click="leftCollapsed = true"
            >
              ◀ 收起
            </button>
            <h1 v-if="!embedded">组态编辑器 <small>T3.2 · 模板与槽位</small></h1>
            <label class="ed-field">页面标题 <input v-model.lazy="title" /></label>
            <template v-if="isCards">
              <h2>卡片库</h2>
              <p class="dim ed-cards-hint" data-role="cards-hint">
                这里配的每张卡都可以被宿主应用单独引用(页面 id + 组件 id),也可以在配页面时「从卡片库放入」。模板固定 24
                格,不作为大屏页面显示。
              </p>
            </template>
            <template v-else>
              <h2>模板</h2>
              <TemplatePicker v-model="templateId" :templates="templates" />
            </template>

            <h2>项目文件 <span class="dim">.scadaproj · 页面的「源码」</span></h2>
            <div class="ed-proj">
              <button type="button" class="ed-mini" data-role="proj-export" @click="project.exportFile()">导出</button>
              <label class="ed-mini ed-file"
                >导入<input
                  type="file"
                  accept=".scadaproj,application/json"
                  data-role="proj-import"
                  @change="importProject"
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
              <!-- 嵌在向导里时不显示「发布」:写平台只在第 5 步「一键发布」(2026-09-17 收口);独立 editor.html 保留 -->
              <button
                v-if="!embedded"
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
              <span class="ed-issues" :class="{ bad: errorCount, warn: !errorCount && warningCount }">{{
                errorCount ? `${errorCount} 个错误,不可发布` : warningCount ? `${warningCount} 个提示` : '校验通过'
              }}</span>
            </div>
            <div class="ed-status">
              点击槽位选择组件 · {{ template.name }} · {{ ed.config.value.widgets.length }} 个组件
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
                <button
                  v-if="!isCards && library"
                  type="button"
                  class="ed-mini ed-save-card"
                  data-role="save-card"
                  title="把这张卡(属性 + 绑定)复制进站点卡片库,供宿主应用单独引用或在别的页面放入"
                  @click="saveAsCard"
                >
                  存为可复用卡片
                </button>
              </div>
              <div v-if="selectedWidget" class="ed-ref" data-role="widget-ref">
                <span class="dim">引用(给前端):</span>
                <template v-if="refPageId">
                  <code class="ed-ref-id" :title="`页面资产 id ${refPageId}`">{{ refPageId.slice(0, 8) }}…</code>
                  <span class="dim">+</span>
                  <code class="ed-ref-id">{{ selectedWidget.id }}</code>
                  <button type="button" class="ed-mini" data-role="copy-ref-json" @click="copyRef('json')">
                    复制引用
                  </button>
                  <button type="button" class="ed-mini" data-role="copy-ref-code" @click="copyRef('code')">
                    复制接入代码
                  </button>
                </template>
                <span v-else class="dim" data-role="ref-unpublished">页面发布后才有页面 id,组件 id 已固定</span>
              </div>
              <div v-else class="dim">空槽位</div>
              <button type="button" @click="pickerOpen = true">
                {{ selectedWidget ? '更换 / 移除组件' : '选择组件' }}
              </button>
            </div>
            <div v-else class="dim">在示意图上点一个槽位</div>

            <template v-if="selectedWidget && selectedDef">
              <!-- 2026-09-17:绑定(数据从哪来)放在属性(长什么样)上面——配卡先选数据源,下拉不再压在表单底下 -->
              <h2>
                绑定
                <span class="dim">{{ meta.connected.value ? `${entityCount} 个实体可选` : '未连接 TB,可手输' }}</span>
                <label
                  v-if="scope"
                  class="ed-scope-toggle"
                  title="默认只列第 2 步认领的设备与第 3 步运算涉及的资产;勾上看 TB 全库"
                >
                  <input
                    v-model="scopeOnly"
                    type="checkbox"
                    :true-value="false"
                    :false-value="true"
                    data-role="scope-all"
                  />
                  全部实体
                </label>
              </h2>
              <BindingsPanel
                :key="'b' + selectedWidget.id"
                :def="selectedDef"
                :widget="selectedWidget"
                :tree="tree"
                :client="meta.client.value"
                :declared="declared"
                @update="onBindings"
                @flags="bindingFlags = $event"
              />
              <h2>
                属性 <span class="dim">{{ selectedDef.name }} · 改了即时反映到示意图</span>
              </h2>
              <PropsForm :key="selectedWidget.id" v-model="widgetProps" :schema="selectedDef.propsSchema" />
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

            <h2 class="ed-fold" data-role="json-toggle" @click="showJson = !showJson">
              <span class="ed-caret">{{ showJson ? '▾' : '▸' }}</span> JSON
              <span class="dim">{{ showJson ? '源码 · 改完点「应用」' : '源码与导入(高级)' }}</span>
            </h2>
            <template v-if="showJson">
              <div class="ed-json-tools">
                <button type="button" class="ed-mini" @click="copyJson">复制</button>
                <label class="ed-mini ed-file"
                  >导入<input type="file" accept="application/json" @change="importFile"
                /></label>
              </div>
              <textarea v-model="jsonDraft" spellcheck="false"></textarea>
              <div class="ed-json-foot">
                <button type="button" @click="applyJson">应用编辑后的 JSON</button>
                <span class="dim">{{ jsonMsg }}</span>
              </div>
            </template>
          </aside>
        </template>

        <WidgetPicker
          v-if="pickerOpen && selectedSlot"
          :slot-def="selectedSlot"
          :widgets="widgets"
          :current="selectedWidget?.type"
          :library="isCards ? undefined : library"
          @pick="onPick"
          @pick-card="onPickCard"
          @remove="onRemove"
          @close="pickerOpen = false"
        />
      </div>
    </div>
  </Teleport>
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
/* 嵌入态缩略图:只有画布 + 一行状态 */
.ed.ed-compact {
  display: block;
  height: auto;
  position: relative;
}
.ed-compact-canvas {
  position: relative;
  padding: 10px;
  cursor: zoom-in;
}
.ed-compact-canvas .sb {
  pointer-events: none;
}
.ed-compact-mask {
  position: absolute;
  inset: 10px;
  display: grid;
  place-items: center;
  border-radius: 8px;
  background: rgba(6, 16, 36, 0.55);
  opacity: 0;
  transition: opacity 0.15s;
}
.ed-compact-mask span {
  padding: 10px 18px;
  border: 1px solid var(--ed-accent);
  border-radius: 999px;
  background: rgba(6, 16, 36, 0.85);
  color: #dbeaff;
  font-size: 14px;
}
.ed-compact-canvas:hover .ed-compact-mask {
  opacity: 1;
}
.ed-compact-bar {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 12px;
  border-top: 1px solid var(--ed-line);
  white-space: nowrap;
  overflow: hidden;
}
.ed-compact-bar .ed-issues {
  margin-left: 0;
}
.ed-compact-bar .ed-fs-btn {
  margin-left: auto;
  border-color: var(--ed-accent);
}
/* 全屏编辑:Teleport 到 body 的覆盖层;顶栏 + 三栏 */
.ed-fs-host {
  position: fixed;
  inset: 0;
  z-index: 1000;
  background: var(--ed-bg-0);
}
.ed.ed-fullscreen {
  height: 100vh;
  grid-template-rows: auto minmax(0, 1fr);
}
/* 全屏左栏收起:左边只留一条竖条,省下的宽度给右边属性 / 绑定栏(340 → 520px) */
.ed.ed-fullscreen.ed-left-collapsed {
  grid-template-columns: 40px 1fr 520px;
}
.ed-left-strip {
  padding: 8px 0;
  display: flex;
  justify-content: center;
  align-items: flex-start;
}
.ed-strip-btn {
  writing-mode: vertical-rl;
  background: none;
  border: 1px solid var(--ed-line, rgba(83, 196, 255, 0.3));
  border-radius: 6px;
  color: inherit;
  font: inherit;
  font-size: 12px;
  padding: 10px 4px;
  cursor: pointer;
  letter-spacing: 0.1em;
}
.ed-strip-btn:hover {
  border-color: var(--ed-accent, #19b7ff);
}
.ed-strip-text {
  margin-top: 6px;
}
.ed-left-collapse {
  float: right;
  margin: 0 0 8px 8px;
}
.ed-fsbar {
  grid-column: 1 / -1;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 14px;
  border-bottom: 1px solid var(--ed-line);
  white-space: nowrap;
}
.ed-fsbar .dim {
  font-weight: 400;
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
  margin-bottom: 6px;
  flex-wrap: nowrap;
  white-space: nowrap;
}
.ed-toolbar > button {
  flex: none;
}
.ed-status {
  opacity: 0.7;
  margin-bottom: 8px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.ed-fold {
  cursor: pointer;
  user-select: none;
}
.ed-caret {
  display: inline-block;
  width: 1em;
}
.ed-json-tools {
  display: flex;
  gap: 6px;
  margin-bottom: 6px;
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
.ed-ref {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  margin-top: 6px;
  font-size: 12px;
}
.ed-ref-id {
  font-size: 11px;
  padding: 1px 5px;
  border: 1px solid rgba(83, 196, 255, 0.25);
  border-radius: 4px;
}
.ed-scope-toggle {
  float: right;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  font-weight: 400;
  letter-spacing: 0;
  opacity: 0.8;
  cursor: pointer;
}
.ed-save-card {
  margin-left: 8px;
  border-color: rgba(111, 227, 160, 0.5);
}
.ed-cards-hint {
  font-size: 12px;
  line-height: 1.5;
  margin: 0 0 8px;
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
