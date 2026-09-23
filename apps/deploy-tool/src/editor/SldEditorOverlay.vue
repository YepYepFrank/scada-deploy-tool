<script setup lang="ts">
/**
 * 接线图编辑器的全屏覆盖层(T5.8,ADR-005):第 4 步页面编辑器里点「编辑接线图…」打开。
 *
 * - `<SldEditor>` 懒加载(X6 不进页面编辑器的首屏包);
 * - 编辑器每次改动(`update:content`)只更新本层的本地副本,页面配置不动;
 * - 两个出口:「完成」(或接线图编辑器自己的「关闭」)→ emit `done` 交回最终内容,由 EditorApp 一次性 commit;
 *   「放弃修改」→ 有改动时二次确认,emit `cancel`;
 * - 有改动时拦住浏览器刷新 / 关页(beforeunload;EditorApp 本身没有离开保护,这里只在覆盖层打开且有改动时挂)。
 * 层级 1100:盖过页面编辑器的全屏层(1000),低于数据源面板(2000)——接线图的绑定面板里也会弹它。
 */
import { computed, defineAsyncComponent, onBeforeUnmount, onMounted, ref, shallowRef } from 'vue'
import type { SldEditorContent, SldEditorHost } from '../sld-editor/ext'
import { sameSldContent } from './sld-integration'

const SldEditor = defineAsyncComponent({
  loader: () => import('../sld-editor/SldEditor.vue').then(m => m.default),
  delay: 0,
})

const props = defineProps<{
  /** 打开时的内容(已与页面配置脱钩的深拷贝) */
  initial: SldEditorContent
  host?: SldEditorHost
  /** 标题栏上的说明(组件 id 等) */
  title?: string
}>()
const emit = defineEmits<{
  /** 保存(不关闭):把当前内容写回页面。点「保存」、Ctrl+S、停手 2 秒自动保存、覆盖层被卸载前兜底,都发它 */
  save: [content: SldEditorContent]
  /** 完成:最终内容(与 initial 相同时也照发,由调用方决定要不要 commit) */
  done: [content: SldEditorContent]
  /** 放弃修改 */
  cancel: []
}>()

const draft = shallowRef<SldEditorContent>(props.initial)
/** 上一次写回页面的内容;dirty = 还有没写回的修改 */
const saved = shallowRef<SldEditorContent>(props.initial)
const dirty = computed(() => !sameSldContent(saved.value, draft.value))
/** 自打开以来有没有改过(「放弃修改」要不要二次确认看它——中途保存过的也算改过) */
const changed = computed(() => !sameSldContent(props.initial, draft.value))
const savedAt = ref('')
/**
 * 保存的反馈(2026-09-23 现场反馈「保存无反馈」):以前没改动时按钮是灰的、点了没反应,
 * 保存后只有左边一行淡淡的小字。现在按钮一直能点,每次保存(手动或自动)按钮变「已保存 ✓」,
 * 手动保存再在按钮下面冒一条提示,说清楚存到了哪里。
 */
const flash = ref<'' | 'saved' | 'uptodate'>('')
let flashTimer: ReturnType<typeof setTimeout> | undefined
function showFlash(kind: 'saved' | 'uptodate'): void {
  flash.value = kind
  clearTimeout(flashTimer)
  flashTimer = setTimeout(() => (flash.value = ''), 3000)
}
const now = () => new Date().toLocaleTimeString('zh-CN', { hour12: false })

/** 停手这么久就自动保存一次 */
const AUTOSAVE_MS = 2000
let timer: ReturnType<typeof setTimeout> | undefined
/** manual:用户点「保存」/ Ctrl+S —— 没改动也给反馈;自动保存与卸载兜底不弹提示 */
function save(manual = false): void {
  clearTimeout(timer)
  if (!dirty.value) {
    if (manual) showFlash('uptodate')
    return
  }
  saved.value = draft.value
  savedAt.value = now()
  emit('save', draft.value)
  if (manual) showFlash('saved')
}
function onUpdate(next: SldEditorContent) {
  draft.value = next
  clearTimeout(timer)
  timer = setTimeout(save, AUTOSAVE_MS)
}
function finish() {
  clearTimeout(timer)
  saved.value = draft.value
  emit('done', draft.value)
}
function discard() {
  if (changed.value && !confirm('放弃这次打开以来对接线图的全部修改?(中途保存过的也会退回)')) return
  clearTimeout(timer)
  saved.value = draft.value // 不要在卸载兜底里又把它存回去
  emit('cancel')
}
function onKeyDown(e: KeyboardEvent): void {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
    e.preventDefault()
    save(true)
  }
}

function onBeforeUnload(e: BeforeUnloadEvent) {
  if (!dirty.value) return
  e.preventDefault()
  e.returnValue = ''
}
onMounted(() => {
  window.addEventListener('beforeunload', onBeforeUnload)
  window.addEventListener('keydown', onKeyDown, true)
})
onBeforeUnmount(() => {
  window.removeEventListener('beforeunload', onBeforeUnload)
  window.removeEventListener('keydown', onKeyDown, true)
  // 兜底:覆盖层不是经「完成 / 放弃」关掉的(外层把它卸载了),没写回的也别丢
  save()
})

defineExpose({ draft, dirty, changed, save })
</script>

<template>
  <Teleport to="body">
    <div class="sldo" data-role="sld-overlay" role="dialog" aria-label="编辑一次接线图">
      <header class="sldo-bar">
        <b>编辑一次接线图</b>
        <span v-if="title" class="sldo-dim">{{ title }}</span>
        <span
          class="sldo-state"
          :class="dirty ? 'sldo-state-dirty' : savedAt ? 'sldo-state-saved' : 'sldo-dim'"
          data-role="sld-dirty"
          >{{ dirty ? '● 有未保存的修改 · 停手 2 秒自动保存' : savedAt ? `✓ 已保存到页面 ${savedAt}` : '未修改' }}</span
        >
        <span class="sldo-grow" />
        <button type="button" class="sldo-btn" data-role="sld-discard" @click="discard">放弃修改</button>
        <span class="sldo-save-wrap">
          <button
            type="button"
            class="sldo-btn"
            :class="{ 'sldo-btn-ok': flash }"
            data-role="sld-save"
            title="Ctrl+S"
            @click="save(true)"
          >
            {{ flash ? '已保存 ✓' : '保存' }}
          </button>
          <span v-if="flash" class="sldo-toast" role="status" data-role="sld-save-toast">
            <template v-if="flash === 'saved'">已保存到页面 {{ savedAt }}</template>
            <template v-else>没有新的修改,页面里已是最新({{ savedAt || '打开时的内容' }})</template>
            <small>要留到下次打开浏览器,记得在第 4 步底部点「保存草稿」;上大屏走第 5 步发布</small>
          </span>
        </span>
        <button type="button" class="sldo-btn sldo-primary" data-role="sld-done" @click="finish">完成</button>
      </header>
      <div class="sldo-body">
        <SldEditor :content="draft" :host="host" @update:content="onUpdate" @close="finish" />
      </div>
    </div>
  </Teleport>
</template>

<style>
.sldo {
  position: fixed;
  inset: 0;
  z-index: 1100;
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  background: var(--ed-bg-0, #061024);
  color: #dbeaff;
  font:
    13px/1.5 system-ui,
    'PingFang SC',
    'Microsoft YaHei',
    sans-serif;
}
.sldo-bar {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 6px 12px;
  border-bottom: 1px solid var(--ed-line, rgba(83, 196, 255, 0.2));
  background: var(--ed-bg-1, #0b1a33);
  white-space: nowrap;
  overflow: hidden;
}
.sldo-dim {
  opacity: 0.6;
  overflow: hidden;
  text-overflow: ellipsis;
}
.sldo-state {
  overflow: hidden;
  text-overflow: ellipsis;
}
.sldo-state-dirty {
  color: #ffcf6b;
}
.sldo-state-saved {
  color: #2ff0bb;
}
.sldo-save-wrap {
  position: relative;
}
.sldo-btn-ok {
  border-color: #2ff0bb;
  color: #2ff0bb;
}
/* 按钮下方的提示:条栏 overflow: hidden,所以 fixed 定位浮在画布上 */
.sldo-toast {
  position: fixed;
  top: 44px;
  right: 12px;
  z-index: 1200;
  display: grid;
  gap: 2px;
  max-width: 420px;
  padding: 8px 12px;
  border: 1px solid #2ff0bb;
  border-radius: 6px;
  background: rgba(6, 30, 40, 0.96);
  color: #2ff0bb;
  white-space: normal;
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.4);
}
.sldo-toast small {
  color: #bcd4ee;
  font-size: 12px;
}
.sldo-grow {
  flex: 1;
}
.sldo-btn {
  padding: 3px 14px;
  border: 1px solid var(--ed-line, rgba(83, 196, 255, 0.3));
  border-radius: 6px;
  background: transparent;
  color: inherit;
  font: inherit;
  cursor: pointer;
}
.sldo-primary {
  border-color: var(--ed-accent, #19b7ff);
  background: rgba(25, 183, 255, 0.18);
}
.sldo-body {
  min-height: 0;
}
</style>
