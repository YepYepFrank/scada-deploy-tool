<script setup lang="ts">
/**
 * 接线图编辑器的全屏覆盖层(T5.8,ADR-005):第 4 步页面编辑器里点「编辑接线图…」打开。
 *
 * - `<SldEditor>` 懒加载(X6 不进页面编辑器的首屏包);
 * - 编辑器每次改动(`update:content`)只更新本层的本地副本,页面配置不动;
 * - 两个出口:「完成」(或接线图编辑器自己的「关闭」)→ emit `done` 交回最终内容,由 EditorApp 一次性 commit;
 *   「放弃修改」→ 有改动时二次确认,emit `cancel`;
 * - 有改动时拦住浏览器刷新 / 关页(beforeunload;EditorApp 本身没有离开保护,这里只在覆盖层打开且有改动时挂)。
 * 层级 1100:盖过页面编辑器的全屏层(1000),低于 KeyPicker 浮层(1200)——接线图的绑定面板里也会弹 KeyPicker。
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

/** 停手这么久就自动保存一次 */
const AUTOSAVE_MS = 2000
let timer: ReturnType<typeof setTimeout> | undefined
function save(): void {
  clearTimeout(timer)
  if (!dirty.value) return
  saved.value = draft.value
  savedAt.value = new Date().toLocaleTimeString('zh-CN', { hour12: false })
  emit('save', draft.value)
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
    save()
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
        <span class="sldo-dim" data-role="sld-dirty">{{
          dirty ? '有未保存的修改 · 停手 2 秒自动保存' : savedAt ? `已保存到页面 ${savedAt}` : '未修改'
        }}</span>
        <span class="sldo-grow" />
        <button type="button" class="sldo-btn" data-role="sld-discard" @click="discard">放弃修改</button>
        <button type="button" class="sldo-btn" data-role="sld-save" :disabled="!dirty" title="Ctrl+S" @click="save">
          保存
        </button>
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
