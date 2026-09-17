<script setup lang="ts">
/**
 * 卡片库列表(2026-09-17 YY:卡片库不必堆在一块画布上,一张一张分开,两栏——左栏组件、右栏前端怎么引用):
 * 左栏:类型、标题、槽位、绑定数,「编辑」进全屏编辑器并选中该格,「删除」;
 * 右栏:页面 id + 组件 id、「复制引用」「复制接入代码」;页面没发布时提示先发布(组件 id 已固定)。
 * 24 格画布本身只在「编辑」时全屏打开;这里不画缩略图。
 */
import { computed, ref } from 'vue'
import { getWidget, type PageConfig, type WidgetConfig } from '@grid/scada-renderer'
import { refJson, refSnippet, widgetTitle } from '../editor/widget-ref'

const props = defineProps<{
  config: PageConfig
  /** 卡片库页面资产 id(已发布才有) */
  pageId: string | null
  /** 已发布版本(显示用) */
  version?: number | null
  /** 没有空格了(24 格满)→「新建」禁用 */
  full?: boolean
  errorCount?: number
}>()
const emit = defineEmits<{
  edit: [slot: string]
  add: []
  remove: [id: string, slot: string]
}>()

const rows = computed(() =>
  [...props.config.widgets]
    .sort((a, b) => a.slot.localeCompare(b.slot, 'en', { numeric: true }))
    .map(w => ({
      w,
      typeName: getWidget(w.type)?.name ?? w.type,
      title: widgetTitle(w, getWidget(w.type)?.name ?? w.type),
      bindings: Object.keys(w.bindings ?? {}).length,
    }))
)

const msg = ref('')
let timer: ReturnType<typeof setTimeout> | null = null
function toast(m: string) {
  msg.value = m
  if (timer) clearTimeout(timer)
  timer = setTimeout(() => (msg.value = ''), 2600)
}
async function copy(kind: 'json' | 'code', w: WidgetConfig) {
  if (!props.pageId) return toast('卡片库还没发布,没有页面 id;第 5 步一键发布后再复制')
  try {
    await navigator.clipboard.writeText(kind === 'json' ? refJson(props.pageId, w.id) : refSnippet(props.pageId, w))
    toast(kind === 'json' ? `已复制「${widgetTitle(w)}」的引用` : `已复制「${widgetTitle(w)}」的接入代码`)
  } catch {
    toast('复制失败,请手动选择文本')
  }
}
</script>

<template>
  <div class="cl" data-role="card-library">
    <div class="cl-head">
      <span class="cl-sum" data-role="cl-summary">
        {{ rows.length }} 张卡
        <template v-if="pageId"> · 已发布 version {{ version ?? '-' }}</template>
        <template v-else> · 未发布</template>
        <span v-if="errorCount" class="cl-bad"> · 校验有 {{ errorCount }} 个错误</span>
      </span>
      <span v-if="msg" class="cl-msg" data-role="cl-msg">{{ msg }}</span>
      <button type="button" class="btn sm" :disabled="full" data-role="cl-add" @click="emit('add')">＋ 新建卡片</button>
    </div>

    <p v-if="!rows.length" class="hint cl-empty">
      还没有卡片。点「＋ 新建卡片」在编辑器里配一张,或在「页面」标签里选中一张卡点「存为可复用卡片」。
    </p>

    <div v-else class="cl-list">
      <div class="cl-cols">
        <span>组件</span>
        <span>前端怎么引用</span>
      </div>
      <div v-for="r in rows" :key="r.w.id" class="cl-row" :data-card="r.w.id">
        <div class="cl-card">
          <div class="cl-title">
            <b>{{ r.title }}</b>
            <span class="dim">{{ r.typeName }} · 格 {{ r.w.slot }} · {{ r.bindings }} 个绑定</span>
          </div>
          <div class="cl-btns">
            <button type="button" class="btn sm" data-role="cl-edit" @click="emit('edit', r.w.slot)">编辑</button>
            <button type="button" class="btn ghost sm" data-role="cl-remove" @click="emit('remove', r.w.id, r.w.slot)">
              删除
            </button>
          </div>
        </div>
        <div class="cl-ref">
          <template v-if="pageId">
            <div class="cl-ids">
              <span class="dim">页面 id</span> <code :title="pageId">{{ pageId }}</code>
            </div>
            <div class="cl-ids">
              <span class="dim">组件 id</span> <code>{{ r.w.id }}</code>
            </div>
            <div class="cl-btns">
              <button type="button" class="btn ghost sm" data-role="cl-copy-json" @click="copy('json', r.w)">复制引用</button>
              <button type="button" class="btn ghost sm" data-role="cl-copy-code" @click="copy('code', r.w)">
                复制接入代码
              </button>
            </div>
          </template>
          <template v-else>
            <div class="cl-ids">
              <span class="dim">组件 id</span> <code>{{ r.w.id }}</code>
              <span class="dim">(已固定)</span>
            </div>
            <div class="hint" data-role="cl-unpublished">页面 id 要第 5 步一键发布后才有,发布后回这里复制引用</div>
          </template>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.cl-head {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 10px;
}
.cl-sum {
  font-size: 13px;
  color: var(--ink-1);
}
.cl-bad {
  color: var(--bad);
}
.cl-msg {
  font-size: 12px;
  color: var(--ok);
  margin-left: auto;
}
.cl-head .btn:last-child {
  margin-left: auto;
}
.cl-msg + .btn {
  margin-left: 0;
}
.cl-empty {
  padding: 18px;
  border: 1px dashed var(--line-1);
  border-radius: 8px;
}
.cl-list {
  border: 1px solid var(--line-0);
  border-radius: 8px;
  overflow: hidden;
}
.cl-cols,
.cl-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1.2fr);
}
.cl-cols {
  padding: 6px 12px;
  font-size: 12px;
  color: var(--ink-2);
  letter-spacing: 0.08em;
  background: var(--bg-2);
  border-bottom: 1px solid var(--line-0);
}
.cl-row {
  border-bottom: 1px solid var(--line-0);
}
.cl-row:last-child {
  border-bottom: none;
}
.cl-card,
.cl-ref {
  padding: 10px 12px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}
.cl-card {
  border-right: 1px solid var(--line-0);
}
.cl-title {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.cl-title .dim {
  font-size: 12px;
}
.cl-btns {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}
.cl-ids {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  min-width: 0;
}
.cl-ids code {
  font-size: 11px;
  padding: 1px 6px;
  border: 1px solid var(--line-1);
  border-radius: 4px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 100%;
}
</style>
