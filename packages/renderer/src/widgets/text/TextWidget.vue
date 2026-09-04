<script setup lang="ts">
import { computed } from 'vue'
const props = withDefaults(
  defineProps<{
    content?: string
    size?: number
    align?: 'left' | 'center' | 'right'
    values?: Record<string, unknown>
    errors?: Record<string, string>
    disabled?: boolean
  }>(),
  { content: '', size: 16, align: 'left', values: () => ({}), errors: () => ({}), disabled: false }
)
// 文本模板插值:{{value}} → 绑定槽位 value 的当前值
const text = computed(() => {
  const v = props.values.value
  const s = v === null || v === undefined ? '—' : String(v)
  return props.content.includes('{{value}}') ? props.content.replaceAll('{{value}}', s) : props.content || s
})
</script>

<template>
  <div class="sr-text" :style="{ fontSize: size + 'px', textAlign: align }" :class="{ 'sr-error': errors.value }">
    <span v-if="errors.value" :title="errors.value">数据不可用</span>
    <span v-else>{{ text }}</span>
  </div>
</template>

<style>
.sr-text {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  padding: 8px 12px;
  box-sizing: border-box;
  color: var(--sr-ink-0);
  white-space: pre-wrap;
}
.sr-text.sr-error {
  color: var(--sr-bad);
}
</style>
