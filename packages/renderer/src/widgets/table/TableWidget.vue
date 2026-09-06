<script setup lang="ts">
/**
 * 表格:rows 槽位为多序列数组(每项一列)。
 * - mode 'latest':每个序列一行——标签 / 当前值 / 单位 / 更新时间(多个 key 的最新值一览)
 * - mode 'timeline':按时间戳合并成行,每个序列一列(kz 逐日报表、历史明细)
 */
import { computed } from 'vue'
import CardFrame from '../_shared/CardFrame.vue'
import { fmt } from '../_shared/echarts'
import type { SeriesValue } from '../../binding-resolver'

interface ColumnProp {
  label?: string
  unit?: string
  decimals?: number
}
const props = withDefaults(
  defineProps<{
    title?: string
    subtitle?: string
    mode?: 'latest' | 'timeline'
    columns?: ColumnProp[]
    maxRows?: number
    timeFormat?: 'time' | 'datetime' | 'date'
    values?: Record<string, unknown>
    errors?: Record<string, string>
    disabled?: boolean
  }>(),
  {
    title: '',
    subtitle: '',
    mode: 'latest',
    columns: () => [],
    maxRows: 50,
    timeFormat: 'datetime',
    values: () => ({}),
    errors: () => ({}),
    disabled: false,
  }
)

const series = computed<SeriesValue[]>(() => {
  const s = props.values.rows
  return Array.isArray(s) ? (s as SeriesValue[]) : []
})
const col = (i: number, s: SeriesValue): Required<ColumnProp> => ({
  label: props.columns[i]?.label || s.name,
  unit: props.columns[i]?.unit ?? '',
  decimals: props.columns[i]?.decimals ?? 1,
})
const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : null
}
const cell = (v: unknown, decimals: number): string => {
  const n = num(v)
  return n !== null ? fmt(n, decimals) : v === null || v === undefined || v === '' ? '——' : String(v)
}
const pad = (n: number) => String(n).padStart(2, '0')
function fmtTs(ts: number): string {
  const d = new Date(ts)
  const date = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
  const time = `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
  return props.timeFormat === 'date' ? date : props.timeFormat === 'time' ? time : `${date} ${time}`
}

/** latest 模式行 */
const latestRows = computed(() =>
  series.value.map((s, i) => {
    const c = col(i, s)
    const last =
      s.value !== undefined ? { ts: s.points[s.points.length - 1]?.ts, value: s.value } : s.points[s.points.length - 1]
    return {
      label: c.label,
      value: cell(last?.value, c.decimals),
      unit: c.unit,
      ts: last?.ts ? fmtTs(last.ts) : '——',
      sub: s.entity?.name ?? '',
    }
  })
)
/** timeline 模式:按 ts 合并 */
const timeline = computed(() => {
  const cols = series.value.map((s, i) => col(i, s))
  const byTs = new Map<number, (unknown | undefined)[]>()
  series.value.forEach((s, i) => {
    for (const p of s.points) {
      const row = byTs.get(p.ts) ?? byTs.set(p.ts, new Array(series.value.length).fill(undefined)).get(p.ts)!
      row[i] = p.value
    }
  })
  const rows = [...byTs.entries()]
    .sort((a, b) => b[0] - a[0])
    .slice(0, props.maxRows)
    .map(([ts, vals]) => ({ ts: fmtTs(ts), cells: vals.map((v, i) => cell(v, cols[i]!.decimals)) }))
  return { cols, rows }
})
const empty = computed(() => !series.value.length || (props.mode === 'timeline' ? !timeline.value.rows.length : false))
</script>

<template>
  <CardFrame :title="title" :subtitle="subtitle" :error="errors.rows">
    <div class="sr-table-wrap">
      <div v-if="empty && !errors.rows" class="sr-empty-hint">暂无数据</div>
      <table v-else-if="mode === 'latest'" class="sr-table">
        <thead>
          <tr>
            <th>指标</th>
            <th class="num">当前值</th>
            <th>单位</th>
            <th>更新时间</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(r, i) in latestRows" :key="i">
            <td :title="r.sub">{{ r.label }}</td>
            <td class="num">{{ r.value }}</td>
            <td class="dim">{{ r.unit }}</td>
            <td class="dim">{{ r.ts }}</td>
          </tr>
        </tbody>
      </table>
      <table v-else class="sr-table">
        <thead>
          <tr>
            <th>时间</th>
            <th v-for="(c, i) in timeline.cols" :key="i" class="num">{{ c.label }}{{ c.unit ? `(${c.unit})` : '' }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="r in timeline.rows" :key="r.ts">
            <td class="dim">{{ r.ts }}</td>
            <td v-for="(v, i) in r.cells" :key="i" class="num">{{ v }}</td>
          </tr>
        </tbody>
      </table>
    </div>
  </CardFrame>
</template>

<style>
.sr-table-wrap {
  height: 100%;
  overflow: auto;
  position: relative;
}
.sr-table {
  width: 100%;
  border-collapse: collapse;
  font-size: max(12px, calc(var(--sr-min-text, 10px) / var(--sr-scale, 1)));
}
.sr-table th,
.sr-table td {
  padding: 5px 8px;
  text-align: left;
  border-bottom: 1px solid var(--sr-line-0);
  white-space: nowrap;
}
.sr-table th {
  position: sticky;
  top: 0;
  background: var(--sr-bg-1);
  color: var(--sr-ink-2);
  font-weight: 400;
  letter-spacing: 0.08em;
  font-size: max(11px, calc(var(--sr-min-text, 10px) / var(--sr-scale, 1)));
}
.sr-table .num {
  text-align: right;
  font-family: var(--sr-font-num);
  color: var(--sr-ink-0);
}
.sr-table .dim {
  color: var(--sr-ink-2);
}
</style>
