<script setup lang="ts">
/** 曲线 / 面积 / 柱状(← LineChart + SlotCard line/bar/multi):series 槽位为多序列数组,一项一条线。 */
import { computed, ref, watch } from 'vue'
import CardFrame from '../_shared/CardFrame.vue'
import { alpha, colorAt, echarts, fmt, lastNumber, toPairs, useEChart, type ChartTokens } from '../_shared/echarts'
import type { SeriesValue } from '../../binding-resolver'

const props = withDefaults(
  defineProps<{
    title?: string
    subtitle?: string
    unit?: string
    chartStyle?: 'line' | 'area' | 'bar'
    smooth?: boolean
    showLegend?: boolean
    decimals?: number
    values?: Record<string, unknown>
    errors?: Record<string, string>
    disabled?: boolean
  }>(),
  {
    title: '',
    subtitle: '',
    unit: '',
    chartStyle: 'line',
    smooth: false,
    showLegend: true,
    decimals: 1,
    values: () => ({}),
    errors: () => ({}),
    disabled: false,
  }
)

const series = computed<SeriesValue[]>(() => {
  const s = props.values.series
  return Array.isArray(s) ? (s as SeriesValue[]) : s ? [s as SeriesValue] : []
})
const hasData = computed(() => series.value.some(s => s.points.length))
const current = computed(() => lastNumber(series.value[0]?.points))
const el = ref<HTMLElement | null>(null)

function build(t: ChartTokens) {
  const font = t.fontNum
  return {
    animation: false,
    grid: { left: 52, right: 16, top: 30, bottom: 28 },
    legend:
      props.showLegend && series.value.length > 1
        ? {
            top: 2,
            right: 8,
            icon: 'roundRect',
            itemWidth: 10,
            itemHeight: 3,
            textStyle: { color: t.ink1, fontSize: 11, fontFamily: font },
          }
        : undefined,
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'cross', lineStyle: { color: t.tipLine }, crossStyle: { color: t.tipLine } },
      backgroundColor: t.tipBg,
      borderColor: t.tipLine,
      textStyle: { color: t.ink, fontSize: 12, fontFamily: font },
      valueFormatter: (v: unknown) => (v == null ? '—' : `${v}${props.unit ? ' ' + props.unit : ''}`),
    },
    xAxis: {
      type: 'time',
      axisLine: { lineStyle: { color: t.grid } },
      axisLabel: { color: t.axis, fontSize: 10, fontFamily: font, hideOverlap: true },
      splitLine: { show: false },
    },
    yAxis: {
      type: 'value',
      scale: true,
      axisLabel: { color: t.axis, fontSize: 10, fontFamily: font },
      splitLine: { lineStyle: { color: t.grid } },
      name: props.unit,
      nameTextStyle: { color: t.axis, fontSize: 10, fontFamily: font, align: 'right' },
    },
    series: series.value.map((s, i) => {
      const color = colorAt(i)
      const base = { name: s.name, data: toPairs(s.points), emphasis: { disabled: true } }
      if (props.chartStyle === 'bar')
        return { ...base, type: 'bar', barWidth: 9, itemStyle: { color, borderRadius: [2, 2, 0, 0] } }
      return {
        ...base,
        type: 'line',
        smooth: props.smooth,
        showSymbol: false,
        lineStyle: { width: 2, color, shadowColor: alpha(color, 0.45), shadowBlur: 9, shadowOffsetY: 3 },
        itemStyle: { color },
        areaStyle:
          props.chartStyle === 'area'
            ? {
                color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
                  { offset: 0, color: alpha(color, 0.22) },
                  { offset: 1, color: alpha(color, 0.02) },
                ]),
              }
            : undefined,
      }
    }),
  }
}
const { update } = useEChart(el, build)
watch(
  () =>
    series.value.map(s => `${s.name}:${s.points.length}:${s.points[s.points.length - 1]?.ts ?? 0}`).join('|') +
    props.chartStyle +
    props.smooth,
  () => update(true)
)
</script>

<template>
  <CardFrame
    :title="title"
    :subtitle="subtitle || (series.length > 1 ? `${series.length} 序列` : (series[0]?.entity?.name ?? ''))"
    side-label="当前"
    :side-value="current === null ? '——' : `${fmt(current, decimals)} ${unit}`"
    :error="errors.series"
  >
    <div ref="el" class="sr-chart-box"></div>
    <div v-if="!hasData && !errors.series" class="sr-empty-hint">暂无数据</div>
  </CardFrame>
</template>
