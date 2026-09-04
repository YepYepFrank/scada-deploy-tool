/**
 * ECharts 按需加载 + 主题令牌 + 图表生命周期 composable。图表类组件只从这里拿 echarts,便于测试里整体 mock。
 * 轴 / 网格 / 提示框颜色从组件所在元素的 --sr-* 变量读取(宿主可整体换肤)。
 */
import * as echarts from 'echarts/core'
import { LineChart, BarChart, GaugeChart } from 'echarts/charts'
import { GridComponent, TooltipComponent, LegendComponent } from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'
import { onBeforeUnmount, onMounted, ref, type Ref } from 'vue'
import type { EChartsOption } from 'echarts'

type ECharts = ReturnType<typeof echarts.init>
/** 组件用普通对象描述 option,setOption 时再断言;避免 ECharts 严格字面量类型把每个组件都写成类型体操 */
export type LooseOption = Record<string, unknown>

echarts.use([LineChart, BarChart, GaugeChart, GridComponent, TooltipComponent, LegendComponent, CanvasRenderer])

export { echarts }
export type { EChartsOption }

/** 序列调色板(与现有大屏 PALETTE 一致) */
export const PALETTE = ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#9085e9']
export const colorAt = (i: number): string => PALETTE[i % PALETTE.length]!

export interface ChartTokens {
  axis: string
  grid: string
  tipBg: string
  tipLine: string
  ink: string
  ink1: string
  fontNum: string
}

const FALLBACK: ChartTokens = {
  axis: '#8fbce8',
  grid: 'rgba(83, 196, 255, 0.16)',
  tipBg: '#0b2a58',
  tipLine: 'rgba(83, 196, 255, 0.32)',
  ink: '#ecf9ff',
  ink1: '#cdeeff',
  fontNum: "'Barlow SemiBold', 'Microsoft YaHei', sans-serif",
}

/** 从元素读取 --sr-* 令牌;未定义时退回默认主题值 */
export function readTokens(el: Element | null): ChartTokens {
  if (!el || typeof getComputedStyle !== 'function') return FALLBACK
  const cs = getComputedStyle(el)
  const tok = (n: string, fb: string) => (cs.getPropertyValue(n) || '').trim() || fb
  return {
    axis: tok('--sr-chart-axis', FALLBACK.axis),
    grid: tok('--sr-chart-grid', FALLBACK.grid),
    tipBg: tok('--sr-bg-2', FALLBACK.tipBg),
    tipLine: tok('--sr-line-1', FALLBACK.tipLine),
    ink: tok('--sr-ink-0', FALLBACK.ink),
    ink1: tok('--sr-ink-1', FALLBACK.ink1),
    fontNum: tok('--sr-font-num', FALLBACK.fontNum),
  }
}

export function alpha(color: string, a: number): string {
  try {
    return echarts.color.modifyAlpha(color, a)
  } catch {
    return color
  }
}

/**
 * 图表生命周期:挂载 init、ResizeObserver 自动 resize、卸载 dispose。
 * build() 返回完整 option;调用方在数据变化时调用 update()。
 */
export function useEChart(el: Ref<HTMLElement | null>, build: (t: ChartTokens) => LooseOption) {
  let chart: ECharts | null = null
  let ro: ResizeObserver | null = null
  let tokens: ChartTokens = FALLBACK

  function update(notMerge = false) {
    if (!chart) return
    chart.setOption(build(tokens) as EChartsOption, { notMerge, lazyUpdate: true })
  }

  onMounted(() => {
    if (!el.value) return
    tokens = readTokens(el.value)
    chart = echarts.init(el.value)
    update(true)
    if (typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(() => chart?.resize())
      ro.observe(el.value)
    }
  })
  onBeforeUnmount(() => {
    ro?.disconnect()
    chart?.dispose()
    chart = null
  })

  return { update, chart: () => chart }
}

/** 时间序列点 → ECharts [ts, value] */
export const toPairs = (points: { ts: number; value: unknown }[]): [number, number | null][] =>
  points.map(p => [p.ts, typeof p.value === 'number' ? p.value : p.value == null ? null : Number(p.value)])

export const lastNumber = (points: { value: unknown }[] | undefined): number | null => {
  if (!points?.length) return null
  const v = points[points.length - 1]!.value
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : null
}

export const fmt = (v: number | null | undefined, decimals = 1): string =>
  v === null || v === undefined || !Number.isFinite(v) ? '——' : v.toFixed(decimals)

/** 组件是否已挂 ref(测试里 happy-dom 无 canvas,由 mock 接管) */
export const noop = (): void => undefined

export type MaybeRef = Ref<HTMLElement | null>
export const useEl = (): MaybeRef => ref<HTMLElement | null>(null)
