<script setup lang="ts">
/**
 * 「复制间隔 ×N」对话框:份数 / 方向 / 间距 / 改名规则(预览表)/ 分组框标题与文字是否一并改名。
 * 确认 = 一次 ctx.apply(doc 与新绑定同进同退),成功后选中最后一份。
 */
import { computed, inject, reactive, ref, watch } from 'vue'
import { lookupSldSymbol } from '@grid/scada-renderer'
import { SLD_EDITOR_CTX } from '../../ext'
import ToolModal from '../_shared/ToolModal.vue'
import { snap } from '../_shared/geometry'
import {
  MAX_COPIES,
  applyDuplicateBay,
  bayNames,
  clampCount,
  defaultSpacing,
  expandBaySelection,
  guessDirection,
  maxSegments,
  renamePreview,
  stepOf,
  type BayDirection,
} from './ops'
import { bayDialog } from './state'

const ctx = inject(SLD_EDITOR_CTX)
if (!ctx) throw new Error('DuplicateBayDialog 必须放在 <SldEditor> 里')
const state = bayDialog(ctx)

const form = reactive({
  count: 1,
  dir: 'right' as BayDirection,
  spacing: 100,
  dx: 100,
  dy: 0,
  renameOn: true,
  /** '' = 最后一段;否则段号(从 0 起)的字符串 */
  segment: '',
  renameTitles: true,
})
const error = ref('')

const picked = computed(() => (state.sel ? expandBaySelection(ctx.content.value.doc, state.sel) : null))

/** 每次打开按当前选择重新给默认值 */
watch(
  () => state.open,
  open => {
    if (!open || !picked.value) return
    const doc = ctx.content.value.doc
    const dir = guessDirection(doc, picked.value, lookupSldSymbol)
    const spacing = defaultSpacing(doc, picked.value, dir, lookupSldSymbol)
    Object.assign(form, { count: 1, dir, spacing, ...stepOf(dir, spacing, { dx: 0, dy: 0 }) })
    error.value = ''
  },
  { immediate: true }
)

/** 切方向时按新方向重算默认间距(用户手改过的数值在同方向内保留) */
function setDir(dir: BayDirection): void {
  form.dir = dir
  if (dir === 'custom' || !picked.value) return
  form.spacing = defaultSpacing(ctx!.content.value.doc, picked.value, dir, lookupSldSymbol)
}

const rule = computed(() => ({
  enabled: form.renameOn,
  segment: form.segment === '' ? undefined : Number(form.segment),
}))
const names = computed(() =>
  picked.value ? bayNames(ctx.content.value.doc, picked.value, form.renameTitles) : ([] as string[])
)
const segments = computed(() => maxSegments(names.value))
const preview = computed(() => renamePreview(names.value, clampCount(form.count), rule.value))
const previewCols = computed(() => Math.min(clampCount(form.count), 3))
const step = computed(() =>
  stepOf(form.dir, snap(form.spacing), { dx: snap(Number(form.dx) || 0), dy: snap(Number(form.dy) || 0) })
)
const summary = computed(() => {
  const p = picked.value
  if (!p) return ''
  return `${p.nodes.length} 个图元、${p.wires.length} 条连线、${p.labels.length} 个标签${
    p.buses.length ? `、${p.buses.length} 条母线` : ''
  }${p.frames?.length ? `、${p.frames.length} 个分组框` : ''}`
})
const canOk = computed(
  () => !ctx.readonly.value && !!picked.value?.nodes.length && (step.value.dx !== 0 || step.value.dy !== 0)
)

function close(): void {
  state.open = false
  state.sel = null
}

function confirm(): void {
  if (!canOk.value || !state.sel) return
  const sel = state.sel
  const count = clampCount(form.count)
  let created: ReturnType<typeof applyDuplicateBay> = []
  const ok = ctx!.apply(d => {
    created = applyDuplicateBay(d, sel, {
      count,
      dx: step.value.dx,
      dy: step.value.dy,
      rule: rule.value,
      renameTitles: form.renameTitles,
    })
    return created.length ? undefined : false
  }, `复制间隔 ×${count}`)
  if (!ok) {
    error.value = '没有复制成功(只读、或结果未通过校验——看画布底部的提示)'
    return
  }
  const last = created[created.length - 1]
  close()
  if (last) ctx!.select(last)
}
</script>

<template>
  <ToolModal
    v-if="state.open"
    title="复制间隔"
    :ok-text="`复制 ${clampCount(form.count)} 份`"
    :ok-disabled="!canOk"
    @ok="confirm"
    @cancel="close"
  >
    <p class="sld-tf-hint" data-field="summary">
      将复制:{{ summary }}。接在母线上的连线复制后接回同一条母线;母线本身不复制(除非显式选中)。
    </p>
    <div class="sld-tf-row">
      <span class="sld-tf-label">份数</span>
      <input v-model.number="form.count" data-field="count" type="number" min="1" :max="MAX_COPIES" />
      <span class="sld-tf-hint">1–{{ MAX_COPIES }},不含原件</span>
    </div>
    <div class="sld-tf-row">
      <span class="sld-tf-label">方向</span>
      <label
        ><input type="radio" data-dir="right" :checked="form.dir === 'right'" @change="setDir('right')" />向右</label
      >
      <label><input type="radio" data-dir="down" :checked="form.dir === 'down'" @change="setDir('down')" />向下</label>
      <label
        ><input
          type="radio"
          data-dir="custom"
          :checked="form.dir === 'custom'"
          @change="setDir('custom')"
        />自定义</label
      >
    </div>
    <div v-if="form.dir !== 'custom'" class="sld-tf-row">
      <span class="sld-tf-label">间距</span>
      <input v-model.number="form.spacing" data-field="spacing" type="number" step="10" />
      <span class="sld-tf-hint">像素,吸附到 10</span>
    </div>
    <div v-else class="sld-tf-row">
      <span class="sld-tf-label">每份位移</span>
      dx <input v-model.number="form.dx" data-field="dx" type="number" step="10" /> dy
      <input v-model.number="form.dy" data-field="dy" type="number" step="10" />
    </div>
    <div class="sld-tf-row">
      <span class="sld-tf-label">改名</span>
      <label><input v-model="form.renameOn" data-field="rename" type="checkbox" />按规则改名</label>
      <select v-model="form.segment" data-field="segment" :disabled="!form.renameOn">
        <option value="">最后一段数字 +1</option>
        <option v-for="i in segments" :key="i" :value="String(i - 1)">第 {{ i }} 段数字 +1</option>
      </select>
    </div>
    <div class="sld-tf-row">
      <span class="sld-tf-label" />
      <label>
        <input v-model="form.renameTitles" data-field="rename-titles" type="checkbox" :disabled="!form.renameOn" />
        分组框标题与文字标签也按规则改名
      </label>
    </div>
    <table v-if="form.renameOn && preview.length" class="sld-bay-preview" data-field="preview">
      <thead>
        <tr>
          <th>原名</th>
          <th v-for="i in previewCols" :key="i">第 {{ i }} 份</th>
          <th v-if="clampCount(form.count) > previewCols">…</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in preview" :key="row.from">
          <td>{{ row.from }}</td>
          <td v-for="(to, i) in row.to" :key="i" :class="{ 'sld-bay-same': to === row.from }">{{ to }}</td>
          <td v-if="clampCount(form.count) > previewCols" />
        </tr>
      </tbody>
    </table>
    <p v-else-if="form.renameOn" class="sld-tf-hint">选中的元素没有名称。</p>
    <p v-if="ctx.readonly.value" class="sld-tf-hint" data-field="readonly">只读模式,不能复制。</p>
    <p v-if="error" class="sld-tf-hint sld-bay-error">{{ error }}</p>
  </ToolModal>
</template>

<style>
.sld-bay-preview {
  width: 100%;
  margin-top: 8px;
  font-size: 12px;
  border-collapse: collapse;
}
.sld-bay-preview th,
.sld-bay-preview td {
  padding: 3px 6px;
  text-align: left;
  border-bottom: 1px solid var(--ed-line, rgba(83, 196, 255, 0.2));
}
.sld-bay-preview th {
  font-weight: 500;
  opacity: 0.6;
}
.sld-bay-same {
  color: #f59e0b;
}
.sld-bay-error {
  color: #f87171;
  opacity: 1;
}
</style>
