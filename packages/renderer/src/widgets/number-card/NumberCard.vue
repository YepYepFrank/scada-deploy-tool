<script setup lang="ts">
/** 数字卡(← StatTile):标签 + 英文副标 + 大数字 + 单位 + 说明行;新值到达时闪一下;左侧色条 accent。 */
import { computed, ref, watch } from 'vue'

const props = withDefaults(
  defineProps<{
    title?: string
    subtitle?: string
    unit?: string
    decimals?: number
    sub?: string
    color?: string
    values?: Record<string, unknown>
    errors?: Record<string, string>
    disabled?: boolean
  }>(),
  {
    title: '',
    subtitle: '',
    unit: '',
    decimals: 1,
    sub: '',
    color: '#3987e5',
    values: () => ({}),
    errors: () => ({}),
    disabled: false,
  }
)
const display = computed(() => {
  const v = props.values.value
  if (v === null || v === undefined) return null
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n.toFixed(props.decimals) : String(v)
})
const flash = ref(false)
let t: ReturnType<typeof setTimeout> | null = null
watch(display, () => {
  flash.value = true
  if (t) clearTimeout(t)
  t = setTimeout(() => (flash.value = false), 320)
})
</script>

<template>
  <div
    class="sr-card sr-number-card"
    :class="{ 'sr-error': errors.value, 'sr-empty': display === null && !errors.value }"
    :style="{ '--sr-accent-local': color }"
  >
    <div class="sr-card-title">
      <span>{{ title }}</span>
      <span v-if="subtitle" class="sr-card-en">{{ subtitle }}</span>
    </div>
    <div class="sr-number" :class="{ 'sr-flash': flash }">
      <template v-if="errors.value"><span class="sr-number-err" :title="errors.value">不可用</span></template>
      <template v-else-if="display === null"><span class="sr-number-empty">——</span></template>
      <template v-else>
        <span class="sr-number-val">{{ display }}</span>
        <span v-if="unit" class="sr-number-unit">{{ unit }}</span>
      </template>
    </div>
    <div class="sr-number-sub">{{ sub }}</div>
  </div>
</template>

<style>
.sr-number-card {
  padding: 14px 16px;
  gap: 6px;
  border-top: 2px solid var(--sr-accent-local, var(--sr-accent));
  justify-content: space-between;
}
.sr-number-card .sr-card-title {
  display: flex;
  justify-content: space-between;
  font-size: 12px;
  letter-spacing: 0.12em;
  color: var(--sr-ink-2);
  font-family: var(--sr-font-body);
  border: 0;
  padding: 0;
}
.sr-number {
  font-family: var(--sr-font-num);
  font-size: 36px;
  line-height: 1;
  color: var(--sr-ink-0);
  display: flex;
  align-items: baseline;
  gap: 6px;
  transition: text-shadow 0.3s;
}
.sr-number.sr-flash {
  text-shadow: 0 0 14px var(--sr-accent-local, var(--sr-accent));
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
.sr-number-sub {
  min-height: 1.2em;
  font-size: 11px;
  color: var(--sr-ink-2);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
</style>
