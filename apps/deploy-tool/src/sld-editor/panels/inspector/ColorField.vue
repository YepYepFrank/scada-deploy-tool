<script setup lang="ts">
/**
 * 颜色输入(2026-09-23 现场反馈「颜色优先显示 16 进制,支持复制 / 粘贴」):
 * 主体是一个显示 #rrggbb 的文本框,可以直接选中复制、粘贴别处的色值;左边的色块点开是系统取色器。
 * 粘贴 / 输入认这几种写法:#f80、#ff8800、ff8800、rgb(255, 136, 0),统一存成小写 #rrggbb;认不出来的不提交、标红。
 * 清空 = 恢复缺省(由调用方决定缺省是什么,比如「按电压等级」)。
 */
import { computed, ref, watch } from 'vue'

const props = withDefaults(
  defineProps<{
    /** 当前自定义色;undefined = 没设(显示 placeholder) */
    modelValue?: string
    /** 没设时色块显示的颜色 */
    fallback?: string
    /** 没设时文本框里的提示,如「按电压等级」 */
    placeholder?: string
    disabled?: boolean
    /** 给测试 / 外部定位用 */
    field?: string
  }>(),
  { modelValue: undefined, fallback: '#19b7ff', placeholder: '', disabled: false, field: undefined }
)
const emit = defineEmits<{ change: [color: string | undefined] }>()

const draft = ref(props.modelValue ?? '')
const bad = ref(false)
watch(
  () => props.modelValue,
  v => {
    draft.value = v ?? ''
    bad.value = false
  }
)

/** 各种写法 → 小写 #rrggbb;认不出来返回 null */
function normalize(raw: string): string | null {
  const t = raw.trim().toLowerCase()
  const rgb = /^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})/.exec(t)
  if (rgb) {
    const parts = rgb.slice(1, 4).map(Number)
    if (parts.some(n => n > 255)) return null
    return '#' + parts.map(n => n.toString(16).padStart(2, '0')).join('')
  }
  const hex = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/.exec(t)
  if (!hex) return null
  const h = hex[1]!
  return '#' + (h.length === 3 ? [...h].map(c => c + c).join('') : h)
}

function commit(): void {
  const t = draft.value.trim()
  if (!t) {
    bad.value = false
    if (props.modelValue !== undefined) emit('change', undefined)
    return
  }
  const hex = normalize(t)
  if (!hex) {
    bad.value = true
    return
  }
  bad.value = false
  draft.value = hex
  if (hex !== props.modelValue) emit('change', hex)
}
function onPicker(e: Event): void {
  const v = (e.target as HTMLInputElement).value.toLowerCase()
  draft.value = v
  bad.value = false
  if (v !== props.modelValue) emit('change', v)
}
const swatch = computed(() => normalize(draft.value) ?? props.modelValue ?? props.fallback)

defineExpose({ normalize })
</script>

<template>
  <span class="sld-color" :class="{ 'sld-color-bad': bad }">
    <label class="sld-color-swatch" :style="{ background: swatch }" title="点开取色器">
      <input type="color" :value="swatch" :disabled="disabled" tabindex="-1" @change="onPicker" />
    </label>
    <input
      v-model="draft"
      class="sld-color-hex"
      :data-field="field"
      :placeholder="placeholder"
      :disabled="disabled"
      spellcheck="false"
      autocomplete="off"
      title="#rrggbb,可以直接复制 / 粘贴;也认 #rgb、rgb(r, g, b)。清空 = 恢复缺省"
      @change="commit"
      @keydown.enter.prevent="commit"
    />
  </span>
</template>

<style>
.sld-color {
  display: inline-flex;
  flex: 1;
  min-width: 0;
  align-items: center;
  gap: 6px;
}
.sld-color-swatch {
  position: relative;
  flex: none;
  width: 22px;
  height: 22px;
  border: 1px solid var(--ed-line, rgba(83, 196, 255, 0.35));
  border-radius: 4px;
  cursor: pointer;
  overflow: hidden;
}
.sld-color-swatch input {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  opacity: 0;
  cursor: pointer;
}
.sld-color-hex {
  flex: 1;
  /* #rrggbb 七个字符要能完整显示,旁边还有「恢复」按钮 */
  min-width: 78px;
  padding: 4px 6px;
  color: inherit;
  font-family: var(--ed-font-mono, ui-monospace, Consolas, monospace);
  background: var(--ed-bg-0, #061024);
  border: 1px solid var(--ed-line, rgba(83, 196, 255, 0.2));
  border-radius: 4px;
  outline: none;
}
.sld-color-hex:focus {
  border-color: var(--ed-accent, #19b7ff);
}
.sld-color-bad .sld-color-hex {
  border-color: #ff6b6b;
}
</style>
