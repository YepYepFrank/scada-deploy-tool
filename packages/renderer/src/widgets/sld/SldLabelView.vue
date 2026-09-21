<script setup lang="ts">
/**
 * 一个标签(文字 / 数值)。数值标签直接从注入的上下文读自己那一个 `pt.*` 键——别的测点变化不会让它重画。
 * 左对齐、垂直居中(与图元 labelSlots 的约定一致);文字不随任何图元旋转。
 * 前缀与单位用标签色(相色),数值用主题前景色;数据过期 → 数值变灰并挂 <title>「数据时间 …」。
 */
import { computed, inject } from 'vue'
import { resolveOnlineState, sldPointSlot, type SldLabel } from '../../sld'
import SldOnlineDot from './SldOnlineDot.vue'
import { SLD_CONTEXT_KEY } from './context'
import { asPointValue, formatSldValue, formatTs, isStale, labelColor } from './format'

const props = defineProps<{ label: SldLabel }>()
const ctx = inject(SLD_CONTEXT_KEY, null)

const color = computed(() => labelColor(props.label.color))
const slot = computed(() => (props.label.kind === 'value' ? sldPointSlot(props.label.pt) : ''))
const point = computed(() => (slot.value ? asPointValue(ctx?.values()[slot.value]) : undefined))
const error = computed(() => (slot.value ? ctx?.errors()[slot.value] : undefined))
const shown = computed(() =>
  props.label.kind === 'value' ? formatSldValue(point.value?.v, props.label.format) : undefined
)
const stale = computed(
  () => !!ctx && !!point.value && !shown.value?.empty && isStale(point.value.ts, ctx.now.value, ctx.staleMs.value)
)
/** 状态标签(灯 + 文字):灯的半径跟字号走,文字让出灯的宽度 */
const size = computed(() => props.label.size ?? 12)
const dotR = computed(() => Math.max(3, Math.round(size.value * 0.36)))
const online = computed(() =>
  props.label.kind === 'status'
    ? resolveOnlineState(asPointValue(ctx?.values()[sldPointSlot(props.label.pt)]))
    : 'unknown'
)
const ONLINE_TEXT = { online: '在线', offline: '离线', unknown: '未知' } as const
const tip = computed(() =>
  error.value ? `数据不可用:${error.value}` : stale.value && point.value ? `数据时间 ${formatTs(point.value.ts)}` : ''
)
</script>

<template>
  <g v-if="label.kind === 'status'" class="sr-sld-status" :class="`sr-sld-status-${online}`" :data-id="label.id">
    <SldOnlineDot :pt="label.pt" :x="label.x + dotR" :y="label.y" :r="dotR" />
    <text
      class="sr-sld-label sr-sld-label-status"
      :x="label.x + dotR * 2 + 6"
      :y="label.y"
      :font-size="size"
      :font-weight="label.bold ? 700 : undefined"
      dominant-baseline="middle"
      :style="color ? { fill: color } : undefined"
    >
      <tspan v-if="label.title">{{ label.title + ' ' }}</tspan>
      <tspan class="sr-sld-status-word">{{ ONLINE_TEXT[online] }}</tspan>
    </text>
  </g>
  <text
    v-else
    class="sr-sld-label"
    :class="[
      `sr-sld-label-${label.kind}`,
      { 'sr-sld-stale': stale, 'sr-sld-label-error': !!error, 'sr-sld-label-empty': shown?.empty },
    ]"
    :data-id="label.id"
    :x="label.x"
    :y="label.y"
    :font-size="size"
    :font-weight="label.bold ? 700 : undefined"
    dominant-baseline="middle"
    :style="color ? { fill: color } : undefined"
  >
    <title v-if="tip">{{ tip }}</title>
    <template v-if="label.kind === 'text'">{{ label.text }}</template>
    <template v-else>
      <tspan v-if="label.title" class="sr-sld-label-title">{{ label.title + ' ' }}</tspan>
      <tspan class="sr-sld-label-num">{{ shown!.text }}</tspan>
      <tspan v-if="shown!.unit" class="sr-sld-label-unit">{{ ' ' + shown!.unit }}</tspan>
    </template>
  </text>
</template>
