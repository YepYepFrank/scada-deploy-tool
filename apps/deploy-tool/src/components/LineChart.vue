<script setup>
import { onMounted, onUnmounted, ref, watch } from 'vue'
import * as echarts from 'echarts'

const props = defineProps({
  // series: [{ name, color, data: [[ts, v], ...], area?, step?, bar?, y2? }]
  // y2: true 的序列画在右侧副轴(unit2 为副轴单位)
  series: { type: Array, required: true },
  unit: { type: String, default: '' },
  unit2: { type: String, default: '' },
})

const el = ref(null)
let chart = null

/* 轴/网格/悬浮框取主题令牌(未定义时退回 GRID·OPS 深灰值) */
const _css = getComputedStyle(document.documentElement)
const tok = (n, fb) => (_css.getPropertyValue(n) || '').trim() || fb
const AXIS_INK = tok('--chart-axis', '#6c7280')
const GRID_LINE = tok('--chart-grid', '#262931')
const TIP_BG = tok('--bg-2', '#1d1f26')
const TIP_LINE = tok('--line-1', '#32363f')
const LEGEND_INK = tok('--ink-1', '#a9adb8')

function mkSeries(s) {
  const base = {
    name: s.name,
    data: s.data,
    emphasis: { disabled: true },
    yAxisIndex: s.y2 ? 1 : 0,
  }
  if (s.bar) {
    return {
      ...base,
      type: 'bar',
      barWidth: 9,
      itemStyle: { color: s.color, borderRadius: [2, 2, 0, 0] },
    }
  }
  return {
    ...base,
    type: 'line',
    step: s.step ? 'end' : false,
    showSymbol: false,
    lineStyle: {
      width: 2,
      color: s.color,
      shadowColor: echarts.color.modifyAlpha(s.color, 0.45),
      shadowBlur: 9,
      shadowOffsetY: 3,
    },
    itemStyle: { color: s.color },
    areaStyle: s.area
      ? {
          color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
            { offset: 0, color: echarts.color.modifyAlpha(s.color, 0.22) },
            { offset: 1, color: echarts.color.modifyAlpha(s.color, 0.02) },
          ]),
        }
      : undefined,
  }
}

function build() {
  return {
    animation: false,
    grid: { left: 52, right: 16, top: 30, bottom: 28 },
    legend:
      props.series.length > 1
        ? {
            top: 2,
            right: 8,
            icon: 'roundRect',
            itemWidth: 10,
            itemHeight: 3,
            textStyle: { color: LEGEND_INK, fontSize: 11, fontFamily: 'IBM Plex Mono' },
          }
        : undefined,
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'cross', lineStyle: { color: '#4a4f5a' }, crossStyle: { color: '#4a4f5a' } },
      backgroundColor: TIP_BG,
      borderColor: TIP_LINE,
      textStyle: { color: '#eef0f4', fontSize: 12, fontFamily: 'IBM Plex Mono' },
      valueFormatter: (v) => (v == null ? '—' : `${v}${props.unit ? ' ' + props.unit : ''}`),
    },
    xAxis: {
      type: 'time',
      axisLine: { lineStyle: { color: GRID_LINE } },
      axisLabel: { color: AXIS_INK, fontSize: 10, fontFamily: 'IBM Plex Mono', hideOverlap: true },
      splitLine: { show: false },
    },
    yAxis: (() => {
      const left = {
        type: 'value',
        scale: true,
        axisLabel: { color: AXIS_INK, fontSize: 10, fontFamily: 'IBM Plex Mono' },
        splitLine: { lineStyle: { color: GRID_LINE } },
        name: props.unit,
        nameTextStyle: { color: AXIS_INK, fontSize: 10, fontFamily: 'IBM Plex Mono', align: 'right' },
      }
      if (!props.series.some((s) => s.y2)) return left
      return [left, {
        type: 'value',
        scale: true,
        axisLabel: { color: AXIS_INK, fontSize: 10, fontFamily: 'IBM Plex Mono' },
        splitLine: { show: false },
        name: props.unit2,
        nameTextStyle: { color: AXIS_INK, fontSize: 10, fontFamily: 'IBM Plex Mono', align: 'left' },
      }]
    })(),
    series: props.series.map(mkSeries),
  }
}

onMounted(() => {
  chart = echarts.init(el.value)
  chart.setOption(build())
  const ro = new ResizeObserver(() => chart && chart.resize())
  ro.observe(el.value)
  onUnmounted(() => {
    ro.disconnect()
    chart.dispose()
  })
})

watch(
  () => props.series.map((s) => s.data.length + ':' + (s.data.at(-1)?.[0] ?? 0)).join('|'),
  () => chart && chart.setOption({ series: props.series.map((s) => ({ data: s.data })) }),
)
</script>

<template>
  <div ref="el" class="chart-box"></div>
</template>
