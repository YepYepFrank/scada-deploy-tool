<script setup lang="ts">
import { computed } from 'vue'
const props = withDefaults(
  defineProps<{
    title?: string
    unit?: string
    decimals?: number
    values?: Record<string, unknown>
    errors?: Record<string, string>
    disabled?: boolean
  }>(),
  { title: '', unit: '', decimals: 1, values: () => ({}), errors: () => ({}), disabled: false }
)
const display = computed(() => {
  const v = props.values.value
  if (v === null || v === undefined) return null
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n.toFixed(props.decimals) : String(v)
})
</script>

<template>
  <div
    class="sr-card sr-number-card"
    :class="{ 'sr-error': errors.value, 'sr-empty': display === null && !errors.value }"
  >
    <div class="sr-card-title">{{ title }}</div>
    <div class="sr-number">
      <template v-if="errors.value"><span class="sr-number-err" :title="errors.value">不可用</span></template>
      <template v-else-if="display === null"><span class="sr-number-empty">——</span></template>
      <template v-else>
        <span class="sr-number-val">{{ display }}</span>
        <span v-if="unit" class="sr-number-unit">{{ unit }}</span>
      </template>
    </div>
  </div>
</template>

<style>
.sr-card {
  width: 100%;
  height: 100%;
  box-sizing: border-box;
  padding: 14px 16px;
  border: 1px solid var(--sr-line-0);
  border-radius: var(--sr-radius);
  background: var(--sr-bg-1);
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.sr-card-title {
  font-size: 12px;
  letter-spacing: 0.12em;
  color: var(--sr-ink-2);
  text-transform: uppercase;
}
.sr-number {
  font-family: var(--sr-font-num);
  font-size: 36px;
  line-height: 1;
  color: var(--sr-ink-0);
  display: flex;
  align-items: baseline;
  gap: 6px;
}
.sr-number-unit {
  font-size: 14px;
  color: var(--sr-ink-2);
}
.sr-number-empty {
  color: var(--sr-ink-2);
}
.sr-number-err {
  font-size: 14px;
  color: var(--sr-bad);
}
</style>
