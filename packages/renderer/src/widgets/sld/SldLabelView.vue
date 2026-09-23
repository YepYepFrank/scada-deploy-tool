<script setup lang="ts">
/**
 * 一个标签(文字 / 数值)。数值标签直接从注入的上下文读自己那一个 `pt.*` 键——别的测点变化不会让它重画。
 * 左对齐、垂直居中(与图元 labelSlots 的约定一致);文字不随任何图元旋转。
 * 前缀与单位用标签色(相色),数值用主题前景色;数据过期 → 数值变灰并挂 <title>「数据时间 …」。
 * 配了 `colW`(2026-09-22)就按三列画:前缀左对齐、数值右对齐到 x + colW、单位跟其后——
 * 一组标签设同一个 colW,数字就排成一列(「Uab 388.7 V」与「P 0.4 kW」对得齐)。
 * 数码框(2026-09-23,`look: 'meter'`,组件缺省):前缀在框左、单位在框右,框里七段数码管数字右对齐,
 * 位数相同的数值小数点落在一条竖线上;数码管是 path 读不出字,整组挂 aria-label「Uab 388.7 V」。
 */
import { computed, inject } from 'vue'
import { resolveOnlineState, sldPointSlot, type SldLabel, type SldValueLook } from '../../sld'
import SldOnlineDot from './SldOnlineDot.vue'
import { SLD_CONTEXT_KEY } from './context'
import { asPointValue, formatSldValue, formatTs, isStale, labelColor } from './format'
import { meterLayout, sevenSegPaths } from './meter'

const props = withDefaults(
  defineProps<{
    label: SldLabel
    /** 标签自己没设 look 时用哪种(SldWidget 的 valueStyle 传下来;单独用这个组件时缺省纯文字) */
    valueStyle?: SldValueLook
    /** 数码框自动对齐的列宽(SldScene 按「x 相同、上下相邻」算的);标签自己配了 colW 以标签为准 */
    autoColW?: number
  }>(),
  { valueStyle: 'plain', autoColW: undefined }
)
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
/** 三列对齐:数值右边界相对标签 x 的偏移;不配(或 <= 0)则退回「前缀 数值 单位」直接拼接 */
const colW = computed(() => {
  const w = props.label.kind === 'value' ? props.label.colW : undefined
  return typeof w === 'number' && Number.isFinite(w) && w > 0 ? w : 0
})
/** 单位与数值之间留的空(与字号成比例,字大了也不会贴住) */
const unitGap = computed(() => Math.max(3, Math.round(size.value * 0.3)))
/** 数码框:只对数值标签;几何与数码管 path 都是纯函数算的 */
const meter = computed(() => {
  const l = props.label
  if (l.kind !== 'value' || (l.look ?? props.valueStyle) !== 'meter' || !shown.value) return null
  const lay = meterLayout({
    x: l.x,
    y: l.y,
    size: size.value,
    title: l.title,
    colW: l.colW || props.autoColW,
    cells: l.cells,
    text: shown.value.text,
  })
  const paths = lay.cells ? sevenSegPaths(lay.cells, lay.slots, lay.right, l.y, size.value) : null
  return { ...lay, paths }
})
const reading = computed(() => {
  const l = props.label
  if (l.kind !== 'value' || !shown.value) return ''
  return [l.title, shown.value.text, shown.value.unit].filter(Boolean).join(' ')
})
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
  <g
    v-else-if="meter && label.kind === 'value'"
    class="sr-sld-meter"
    :class="{ 'sr-sld-stale': stale, 'sr-sld-label-error': !!error, 'sr-sld-label-empty': shown?.empty }"
    :data-id="label.id"
    :data-value="shown!.text"
    role="img"
    :aria-label="reading"
  >
    <title v-if="tip">{{ tip }}</title>
    <text
      v-if="label.title"
      class="sr-sld-label sr-sld-label-title"
      :x="label.x"
      :y="label.y"
      :font-size="size"
      :font-weight="label.bold ? 700 : undefined"
      dominant-baseline="middle"
      :style="color ? { fill: color } : undefined"
      >{{ label.title }}</text
    >
    <rect
      class="sr-sld-meter-box"
      :x="meter.box.x"
      :y="meter.box.y"
      :width="meter.box.w"
      :height="meter.box.h"
      rx="1.5"
    />
    <template v-if="meter.paths">
      <path class="sr-sld-meter-ghost" :d="meter.paths.ghost" />
      <path class="sr-sld-meter-digits" :d="meter.paths.lit" />
    </template>
    <text
      v-else
      class="sr-sld-meter-text"
      :x="meter.right"
      :y="label.y"
      :font-size="size"
      text-anchor="end"
      dominant-baseline="middle"
      >{{ shown!.text }}</text
    >
    <text
      v-if="shown!.unit"
      class="sr-sld-label sr-sld-label-unit"
      :x="meter.unitX"
      :y="label.y"
      :font-size="size"
      :font-weight="label.bold ? 700 : undefined"
      dominant-baseline="middle"
      :style="color ? { fill: color } : undefined"
      >{{ shown!.unit }}</text
    >
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
    <template v-else-if="colW">
      <tspan v-if="label.title" class="sr-sld-label-title">{{ label.title }}</tspan>
      <tspan class="sr-sld-label-num" :x="label.x + colW" text-anchor="end">{{ shown!.text }}</tspan>
      <tspan v-if="shown!.unit" class="sr-sld-label-unit" :x="label.x + colW + unitGap" text-anchor="start">{{
        shown!.unit
      }}</tspan>
    </template>
    <template v-else>
      <tspan v-if="label.title" class="sr-sld-label-title">{{ label.title + ' ' }}</tspan>
      <tspan class="sr-sld-label-num">{{ shown!.text }}</tspan>
      <tspan v-if="shown!.unit" class="sr-sld-label-unit">{{ ' ' + shown!.unit }}</tspan>
    </template>
  </text>
</template>
