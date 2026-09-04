<script setup lang="ts">
/** 状态指示灯:state 槽位的值与 onValue 比较(按字符串比较,"1"/1/true 视为等价),命中显示 on 态。 */
import { computed } from 'vue'

const props = withDefaults(
  defineProps<{
    title?: string
    subtitle?: string
    onValue?: string
    onLabel?: string
    offLabel?: string
    onColor?: string
    offColor?: string
    sub?: string
    values?: Record<string, unknown>
    errors?: Record<string, string>
    disabled?: boolean
  }>(),
  {
    title: '',
    subtitle: '',
    onValue: '1',
    onLabel: '正常',
    offLabel: '异常',
    onColor: '',
    offColor: '',
    sub: '',
    values: () => ({}),
    errors: () => ({}),
    disabled: false,
  }
)

const norm = (v: unknown): string => {
  if (v === true) return '1'
  if (v === false) return '0'
  if (typeof v === 'number') return String(v)
  return String(v ?? '')
    .trim()
    .toLowerCase() === 'true'
    ? '1'
    : String(v ?? '')
          .trim()
          .toLowerCase() === 'false'
      ? '0'
      : String(v ?? '')
}
const state = computed<'on' | 'off' | 'unknown'>(() => {
  const v = props.values.state
  if (v === null || v === undefined || v === '') return 'unknown'
  return norm(v) === norm(props.onValue) ? 'on' : 'off'
})
const label = computed(() => (state.value === 'on' ? props.onLabel : state.value === 'off' ? props.offLabel : '——'))
const color = computed(() =>
  state.value === 'on'
    ? props.onColor || 'var(--sr-ok)'
    : state.value === 'off'
      ? props.offColor || 'var(--sr-bad)'
      : 'var(--sr-ink-2)'
)
</script>

<template>
  <div class="sr-card sr-status-light" :class="[`sr-state-${state}`, { 'sr-error': errors.state }]">
    <div class="sr-card-title sr-sl-title">
      <span>{{ title }}</span>
      <span v-if="subtitle" class="sr-card-en">{{ subtitle }}</span>
    </div>
    <div class="sr-sl-body">
      <template v-if="errors.state">
        <span class="sr-sl-dot" style="background: var(--sr-bad)"></span>
        <span class="sr-sl-label sr-sl-err" :title="errors.state">数据不可用</span>
      </template>
      <template v-else>
        <span class="sr-sl-dot" :style="{ background: color, boxShadow: `0 0 12px ${color}` }"></span>
        <span class="sr-sl-label" :style="{ color }">{{ label }}</span>
      </template>
    </div>
    <div class="sr-number-sub">{{ sub }}</div>
  </div>
</template>

<style>
.sr-status-light {
  padding: 14px 16px;
  gap: 6px;
  justify-content: space-between;
}
.sr-sl-title {
  display: flex;
  justify-content: space-between;
  font-size: 12px;
  letter-spacing: 0.12em;
  color: var(--sr-ink-2);
  border: 0;
  padding: 0;
}
.sr-sl-body {
  display: flex;
  align-items: center;
  gap: 14px;
}
.sr-sl-dot {
  width: 18px;
  height: 18px;
  border-radius: 50%;
  flex: none;
}
.sr-sl-label {
  font-family: var(--sr-font-num);
  font-size: 30px;
  line-height: 1;
}
.sr-sl-err {
  font-size: 14px;
  color: var(--sr-bad);
}
.sr-state-unknown .sr-sl-dot {
  background: var(--sr-ink-2);
}
</style>
