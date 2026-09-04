<script setup lang="ts">
/** 双轴组合图(← SlotCard combo):primary 面积线画左轴,secondary 画右轴。 */
import { computed, ref, watch } from 'vue'
import CardFrame from '../_shared/CardFrame.vue'
import { alpha, colorAt, echarts, fmt, lastNumber, toPairs, useEChart, type ChartTokens } from '../_shared/echarts'
import type { SeriesValue } from '../../binding-resolver'

const props = withDefaults(
  defineProps<{
    title?: string
    subtitle?: string
    unitL?: string
    unitR?: string
    decimals?: number
    values?: Record<string, unknown>
    errors?: Record<string, string>
    disabled?: boolean
  }>(),
  {
    title: '',
    subtitle: '',
    unitL: '',
    unitR: '',
    decimals: 1,
    values: () => ({}),
    errors: () => ({}),
    disabled: false,
  }
)

const one = (v: unknown): SeriesValue | null =>
  Array.isArray(v) ? ((v[0] as SeriesValue) ?? null) : ((v as SeriesValue) ?? null)
const primary = computed(() => one(props.values.primary))
const secondary = computed(() => one(props.values.secondary))
const hasData = computed(() => !!(primary.value?.points.length || secondary.value?.points.length))
const current = computed(() => lastNumber(primary.value?.points))
const el = ref<HTMLElement | null>(null)

function build(t: ChartTokens) {
  const font = t.fontNum
  const axisStyle = { color: t.axis, fontSize: 10, fontFamily: font }
  const mk = (s: SeriesValue | null, i: number, y2: boolean) => {
    if (!s) return null
    const color = colorAt(i)
    return {
      name: s.name,
      data: toPairs(s.points),
      type: 'line',
      yAxisIndex: y2 ? 1 : 0,
      showSymbol: false,
      emphasis: { disabled: true },
      lineStyle: { width: 2, color, shadowColor: alpha(color, 0.45), shadowBlur: 9, shadowOffsetY: 3 },
      itemStyle: { color },
      areaStyle: y2
        ? undefined
        : {
            color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
              { offset: 0, color: alpha(color, 0.22) },
              { offset: 1, color: alpha(color, 0.02) },
            ]),
          },
    }
  }
  return {
    animation: false,
    grid: { left: 52, right: 52, top: 30, bottom: 28 },
    legend: {
      top: 2,
      right: 8,
      icon: 'roundRect',
      itemWidth: 10,
      itemHeight: 3,
      textStyle: { color: t.ink1, fontSize: 11, fontFamily: font },
    },
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'cross', lineStyle: { color: t.tipLine }, crossStyle: { color: t.tipLine } },
      backgroundColor: t.tipBg,
      borderColor: t.tipLine,
      textStyle: { color: t.ink, fontSize: 12, fontFamily: font },
    },
    xAxis: {
      type: 'time',
      axisLine: { lineStyle: { color: t.grid } },
      axisLabel: { ...axisStyle, hideOverlap: true },
      splitLine: { show: false },
    },
    yAxis: [
      {
        type: 'value',
        scale: true,
        axisLabel: axisStyle,
        splitLine: { lineStyle: { color: t.grid } },
        name: props.unitL,
        nameTextStyle: { ...axisStyle, align: 'right' },
      },
      {
        type: 'value',
        scale: true,
        axisLabel: axisStyle,
        splitLine: { show: false },
        name: props.unitR,
        nameTextStyle: { ...axisStyle, align: 'left' },
      },
    ],
    series: [mk(primary.value, 0, false), mk(secondary.value, 1, true)].filter(Boolean),
  }
}
const { update } = useEChart(el, build)
watch(
  () =>
    [primary.value, secondary.value]
      .map(s => `${s?.name}:${s?.points.length}:${s?.points[s.points.length - 1]?.ts ?? 0}`)
      .join('|'),
  () => update(true)
)
</script>

<template>
  <CardFrame
    :title="title"
    :subtitle="subtitle"
    side-label="当前"
    :side-value="current === null ? '——' : `${fmt(current, decimals)} ${unitL}`"
    :error="errors.primary || errors.secondary"
  >
    <div ref="el" class="sr-chart-box"></div>
    <div v-if="!hasData && !errors.primary && !errors.secondary" class="sr-empty-hint">暂无数据</div>
  </CardFrame>
</template>
