<script setup lang="ts">
/**
 * 独立开发入口的宿主:内置 mock 图与 mock 绑定,演示 <SldEditor> 的对外用法(v-model:content / readonly / host / close)。
 * 「导出 JSON」下载当前内容;「导入 JSON」读一个同样形状的文件({ doc, bindings },或单独一个 SldDoc)。
 */
import { ref, shallowRef } from 'vue'
import { isSldDoc } from '@grid/scada-renderer'
import SldEditor from '../SldEditor.vue'
import type { SldEditorContent, SldEditorHost } from '../ext'
import { makeMockContent } from './mock'

const content = shallowRef<SldEditorContent>(makeMockContent())
const readonly = ref(false)
const updates = ref(0)
const message = ref('')
const fileEl = ref<HTMLInputElement>()
const editorEl = ref<InstanceType<typeof SldEditor>>()
const host: SldEditorHost = { siteName: 'mock-site', meta: { mock: true } }

function onUpdate(next: SldEditorContent): void {
  content.value = next
  updates.value += 1
}

function exportJson(): void {
  const blob = new Blob([JSON.stringify(content.value, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${host.siteName}-sld.json`
  a.click()
  URL.revokeObjectURL(url)
  message.value = `已导出 ${a.download}`
}

/** 解析导入的文本;不合法抛错(消息给人看) */
function parseContent(text: string): SldEditorContent {
  const data = JSON.parse(text) as unknown
  if (isSldDoc(data)) return { doc: data, bindings: {} }
  const c = data as Partial<SldEditorContent> | null
  if (c && isSldDoc(c.doc)) return { doc: c.doc, bindings: c.bindings ?? {} }
  throw new Error('不是接线图 JSON(要 { doc, bindings } 或一个 SldDoc)')
}

async function onFile(e: Event): Promise<void> {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  try {
    content.value = parseContent(await file.text())
    message.value = `已导入 ${file.name}`
  } catch (err) {
    message.value = `导入失败:${err instanceof Error ? err.message : String(err)}`
  }
}

function resetMock(): void {
  content.value = makeMockContent()
  message.value = '已恢复 mock 图'
}

// 方便在浏览器控制台 / 自动化里取当前内容、直接灌一份内容
Object.assign(window, {
  __sldDev: {
    get content() {
      return content.value
    },
    /** <SldEditor> 暴露的 { ctx, store }(调试用) */
    get editor() {
      return editorEl.value
    },
    load(text: string) {
      content.value = parseContent(text)
    },
  },
})
</script>

<template>
  <div class="sld-dev">
    <header class="sld-dev-bar">
      <b>一次接线图编辑器 · 独立开发入口</b>
      <span class="sld-dev-dim">不连 TB · mock 图 + mock 绑定</span>
      <span class="sld-dev-grow" />
      <span class="sld-dev-dim" data-dev="updates">update:content × {{ updates }}</span>
      <span v-if="message" class="sld-dev-msg" data-dev="message">{{ message }}</span>
      <button type="button" data-dev="export" @click="exportJson">导出 JSON</button>
      <button type="button" data-dev="import" @click="fileEl?.click()">导入 JSON</button>
      <button type="button" data-dev="reset" @click="resetMock">恢复 mock</button>
      <label class="sld-dev-check"><input v-model="readonly" type="checkbox" data-dev="readonly" /> 只读</label>
      <input ref="fileEl" type="file" accept=".json,application/json" hidden @change="onFile" />
    </header>
    <div class="sld-dev-body">
      <SldEditor
        ref="editorEl"
        :content="content"
        :host="host"
        :readonly="readonly"
        @update:content="onUpdate"
        @close="message = '收到 close 事件(宿主在这里关对话框)'"
      />
    </div>
  </div>
</template>

<style>
html,
body,
#app {
  height: 100%;
  margin: 0;
}
body {
  background: #061024;
}
.sld-dev {
  display: flex;
  flex-direction: column;
  height: 100%;
  color: #dbeaff;
  font:
    13px/1.5 system-ui,
    'PingFang SC',
    'Microsoft YaHei',
    sans-serif;
}
.sld-dev-bar {
  display: flex;
  flex: none;
  align-items: center;
  gap: 10px;
  padding: 6px 12px;
  background: #040b1a;
  border-bottom: 1px solid rgba(83, 196, 255, 0.2);
}
.sld-dev-bar button {
  padding: 3px 10px;
  color: inherit;
  font: inherit;
  font-size: 12px;
  background: transparent;
  border: 1px solid rgba(83, 196, 255, 0.3);
  border-radius: 4px;
  cursor: pointer;
}
.sld-dev-bar button:hover {
  border-color: #19b7ff;
}
.sld-dev-dim {
  font-size: 12px;
  opacity: 0.55;
}
.sld-dev-msg {
  font-size: 12px;
  color: #f59e0b;
}
.sld-dev-grow {
  flex: 1;
}
.sld-dev-check {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  cursor: pointer;
}
.sld-dev-body {
  flex: 1;
  min-height: 0;
}
</style>
