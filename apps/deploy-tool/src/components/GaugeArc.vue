<script setup>
// 半圆仪表盘:值相对量程(max)的占比,风格对齐生产大屏的利用率盘
import { onMounted, onUnmounted, ref, watch } from 'vue'
import * as echarts from 'echarts'

const props = defineProps({
  value: { type: [Number, String], default: null },
  max: { type: Number, default: 100 },
  unit: { type: String, default: '' },
  color: { type: String, default: '#3987e5' },
})

const el = ref(null)
let chart = null
const num = () => (typeof props.value === 'number' ? props.value : Number(props.value))

function build() {
  const v = num()
  const ok = Number.isFinite(v)
  return {
    animation: false,
    series: [{
      type: 'gauge',
      startAngle: 200,
      endAngle: -20,
      min: 0,
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
            { offset: 0, color: echarts.color.modifyAlpha(props.color, 0.55) },
            { offset: 1, color: props.color },
          ]),
          shadowColor: echarts.color.modifyAlpha(props.color, 0.5),
          shadowBlur: 10,
        },
      },
      axisLine: { lineStyle: { width: 10, color: [[1, 'rgba(108,114,128,0.22)']] } },
      axisTick: { show: false },
      splitLine: { show: false },
      axisLabel: { show: false },
      detail: {
        offsetCenter: [0, '-12%'],
        formatter: () => (ok ? `${v.toFixed(1)}${props.unit ? '\n' + props.unit : ''}` : '——'),
        color: '#eef0f4',
        fontSize: 20,
        fontFamily: 'IBM Plex Mono',
        lineHeight: 22,
      },
      data: [{ value: ok ? v : 0 }],
    }],
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
watch(() => [props.value, props.max], () => chart && chart.setOption(build()))
</script>

<template>
  <div ref="el" class="gauge-box"></div>
</template>

<style scoped>
.gauge-box { width: 100%; height: 100%; min-height: 110px; }
</style>
