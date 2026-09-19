<script setup lang="ts">
/** 底图浮层:显隐 / 透明度 / 位置 / 缩放 / 换图 / 移除。数值在 change(松手、回车、失焦)时提交,一次一步撤销。 */
import { computed, inject } from 'vue'
import { SLD_EDITOR_CTX } from '../../ext'
import ToolPopover from '../_shared/ToolPopover.vue'
import { pickBackgroundFile } from './load'
import { backgroundScale, patchBackground, removeBackground, scaleBackground } from './ops'
import { bgState } from './state'

const ctx = inject(SLD_EDITOR_CTX)
if (!ctx) throw new Error('BackgroundPanel 必须放在 <SldEditor> 里')
const state = bgState(ctx)

const doc = computed(() => ctx.content.value.doc)
const bg = computed(() => doc.value.background)
const ro = computed(() => ctx.readonly.value)
const scale = computed(() => backgroundScale(doc.value))

const num = (e: Event): number => Number((e.target as HTMLInputElement).value)

function patch(p: { opacity?: number; x?: number; y?: number }, label: string): void {
  ctx!.apply(d => (patchBackground(d.doc, p) ? undefined : false), label)
}
function setScale(e: Event): void {
  const v = num(e)
  ctx!.apply(d => (scaleBackground(d.doc, v) ? undefined : false), '缩放底图')
}
function remove(): void {
  if (ctx!.apply(d => (removeBackground(d.doc) ? undefined : false), '移除底图')) state.panel = false
}
</script>

<template>
  <ToolPopover v-if="state.panel" anchor="background" label="底图描摹" @close="state.panel = false">
    <div class="sld-bg-panel">
      <p v-if="state.error" class="sld-tf-hint sld-bg-error" data-field="error">{{ state.error }}</p>
      <template v-if="bg">
        <div class="sld-tf-row">
          <span class="sld-tf-label">显示</span>
          <label><input v-model="state.visible" data-field="visible" type="checkbox" />显示底图</label>
        </div>
        <div class="sld-tf-row">
          <span class="sld-tf-label">透明度</span>
          <input
            data-field="opacity"
            type="range"
            min="0.05"
            max="1"
            step="0.05"
            :value="bg.opacity"
            :disabled="ro"
            @change="patch({ opacity: num($event) }, '底图透明度')"
          />
          <span>{{ Math.round(bg.opacity * 100) }}%</span>
        </div>
        <div class="sld-tf-row">
          <span class="sld-tf-label">位置 x / y</span>
          <input
            data-field="x"
            type="number"
            step="10"
            :value="bg.x ?? 0"
            :disabled="ro"
            @change="patch({ x: num($event) }, '移动底图')"
          />
          <input
            data-field="y"
            type="number"
            step="10"
            :value="bg.y ?? 0"
            :disabled="ro"
            @change="patch({ y: num($event) }, '移动底图')"
          />
        </div>
        <div class="sld-tf-row">
          <span class="sld-tf-label">缩放</span>
          <input data-field="scale" type="number" step="5" :value="scale" :disabled="ro" @change="setScale" />
          <span>% 画布宽</span>
        </div>
      </template>
      <p v-else class="sld-tf-hint">还没有底图。</p>
      <div class="sld-tf-row">
        <button type="button" class="sld-tp-btn" data-act="pick" :disabled="ro" @click="pickBackgroundFile(ctx)">
          {{ bg ? '换一张图…' : '选择图片…' }}
        </button>
        <button v-if="bg" type="button" class="sld-tp-btn" data-act="remove" :disabled="ro" @click="remove">
          移除底图
        </button>
      </div>
      <p class="sld-tp-hint">png / jpg / svg,≤ 3 MB。底图只存在项目文件里,发布时会剥掉。</p>
    </div>
  </ToolPopover>
</template>

<style>
.sld-bg-panel {
  width: 300px;
}
.sld-bg-panel input[type='range'] {
  flex: 1;
}
.sld-bg-panel input[type='number'] {
  width: 70px;
}
.sld-bg-error {
  color: #f87171;
  opacity: 1;
}
</style>
