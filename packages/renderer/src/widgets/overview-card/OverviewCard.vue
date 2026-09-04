<script setup lang="ts">
/** 多指标概览卡(← SlotCard overview):items 槽位为多项标量数组,每项一行:色点 · 标签 · 值 单位。 */
import { computed } from 'vue'
import CardFrame from '../_shared/CardFrame.vue'
import { colorAt, fmt } from '../_shared/echarts'
import type { SeriesValue } from '../../binding-resolver'

interface ItemProp {
  label?: string
  unit?: string
  decimals?: number
}
const props = withDefaults(
  defineProps<{
    title?: string
    subtitle?: string
    items?: ItemProp[]
    compact?: boolean
    values?: Record<string, unknown>
    errors?: Record<string, string>
    disabled?: boolean
  }>(),
  { title: '', subtitle: '', items: () => [], compact: false, values: () => ({}), errors: () => ({}), disabled: false }
)

const rows = computed(() => {
  const raw = props.values.items
  const list: SeriesValue[] = Array.isArray(raw) ? (raw as SeriesValue[]) : []
  return list.map((it, i) => {
    const cfg = props.items[i] ?? {}
    const v = it.value !== undefined ? it.value : it.points?.length ? it.points[it.points.length - 1]!.value : null
    const n = typeof v === 'number' ? v : v == null ? null : Number(v)
    return {
      color: colorAt(i),
      label: cfg.label || it.name,
      value: n !== null && Number.isFinite(n) ? fmt(n, cfg.decimals ?? 1) : v == null ? '——' : String(v),
      unit: cfg.unit ?? '',
      sub: it.entity?.name ?? '',
    }
  })
})
</script>

<template>
  <CardFrame :title="title" :subtitle="subtitle || `${rows.length} 项`" :error="errors.items">
    <div class="sr-ov" :class="{ 'sr-ov-compact': compact }">
      <div v-if="!rows.length" class="sr-empty-hint">未配置指标</div>
      <div v-for="(r, i) in rows" :key="i" class="sr-ov-row">
        <span class="sr-ov-ind" :style="{ background: r.color }"></span>
        <span class="sr-ov-label" :title="r.sub">{{ r.label }}</span>
        <span class="sr-ov-val"
          >{{ r.value }}<em>{{ r.unit }}</em></span
        >
      </div>
    </div>
  </CardFrame>
</template>

<style>
.sr-ov {
  height: 100%;
  display: flex;
  flex-direction: column;
  justify-content: space-evenly;
  gap: 4px;
  padding: 2px 6px;
}
.sr-ov-row {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 13px;
}
.sr-ov-compact .sr-ov-row {
  font-size: 12px;
}
.sr-ov-ind {
  width: 8px;
  height: 8px;
  border-radius: 2px;
  flex: none;
}
.sr-ov-label {
  flex: 1;
  color: var(--sr-ink-1);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.sr-ov-val {
  font-family: var(--sr-font-num);
  font-size: 18px;
  color: var(--sr-ink-0);
}
.sr-ov-val em {
  font-style: normal;
  font-size: 11px;
  color: var(--sr-ink-2);
  margin-left: 4px;
}
</style>
