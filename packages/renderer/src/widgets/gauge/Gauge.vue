<script setup lang="ts">
/** 半圆仪表盘(← GaugeArc):值相对量程 [min, max] 的占比;风格对齐生产大屏。 */
import { computed, ref, watch } from 'vue'
import CardFrame from '../_shared/CardFrame.vue'
import { alpha, echarts, fmt, useEChart, type ChartTokens } from '../_shared/echarts'

const props = withDefaults(
  defineProps<{
    title?: string
    subtitle?: string
    unit?: string
    min?: number
    max?: number
    color?: string
    decimals?: number
    values?: Record<string, unknown>
    errors?: Record<string, string>
    disabled?: boolean
  }>(),
  {
    title: '',
    subtitle: '',
    unit: '',
    min: 0,
    max: 100,
    color: '#3987e5',
    decimals: 1,
    values: () => ({}),
    errors: () => ({}),
    disabled: false,
  }
)

const num = computed<number | null>(() => {
  const v = props.values.value
  if (v === null || v === undefined) return null
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : null
})
const el = ref<HTMLElement | null>(null)

function build(t: ChartTokens) {
  const v = num.value
  return {
    animation: false,
    series: [
      {
        type: 'gauge',
        startAngle: 200,
        endAngle: -20,
        min: props.min,
        max: props.max || 100,
        center: ['50%', '62%'],
        radius: '95%',
        pointer: { show: false },
        progress: {
          show: true,
          width: 10,
          roundCap: true,
          itemStyle: {
            color: new echarts.graphic.LinearGradient(0, 0, 1, 0, [
              { offset: 0, color: alpha(props.color, 0.55) },
              { offset: 1, color: props.color },
            ]),
            shadowColor: alpha(props.color, 0.5),
            shadowBlur: 10,
          },
        },
        axisLine: { lineStyle: { width: 10, color: [[1, 'rgba(108,114,128,0.22)']] } },
        axisTick: { show: false },
        splitLine: { show: false },
        axisLabel: { show: false },
        detail: {
          offsetCenter: [0, '-12%'],
          formatter: () => (v === null ? '——' : `${fmt(v, props.decimals)}${props.unit ? '\n' + props.unit : ''}`),
          color: t.ink,
          fontSize: 20,
          fontFamily: t.fontNum,
          lineHeight: 22,
        },
        data: [{ value: v ?? props.min }],
      },
    ],
  }
}
const { update } = useEChart(el, build)
watch([num, () => props.min, () => props.max, () => props.color], () => update())
</script>

<template>
  <CardFrame
    :title="title"
    :subtitle="subtitle"
    side-label="当前"
    :side-value="num === null ? '——' : `${fmt(num, decimals)} ${unit}`"
    :error="errors.value"
  >
    <div ref="el" class="sr-chart-box sr-gauge"></div>
    <div class="sr-gauge-sub">量程 {{ min }} – {{ max }}{{ unit ? ' ' + unit : '' }}</div>
  </CardFrame>
</template>

<style>
.sr-gauge-sub {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 6px;
  text-align: center;
  font-size: max(10px, calc(var(--sr-min-text, 10px) / var(--sr-scale, 1)));
  letter-spacing: 0.1em;
  color: var(--sr-ink-2);
  pointer-events: none;
}
</style>
