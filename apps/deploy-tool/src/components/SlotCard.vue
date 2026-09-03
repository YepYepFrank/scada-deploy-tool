<script setup>
// 组态槽位通用卡片:折线/柱状/多序列/双轴组合/多指标概览/仪表盘/告警滚动/地图/报表。
// 上下文(取数/元数据函数)由 SiteView 通过 provide('slotCtx') 注入。
import { computed, inject } from 'vue'
import LineChart from './LineChart.vue'
import GaugeArc from './GaugeArc.vue'
import VehicleMap from './VehicleMap.vue'

const props = defineProps({
  sl: { type: Object, required: true },
  color: { type: String, default: '#3987e5' },
  compact: { type: Boolean, default: false }, // 三栏侧栏的紧凑图高
})

const ctx = inject('slotCtx')
const { latest, series, meta, fmt, reportData, activeAlarms, isAlarming, palette, sinceText } = ctx

const s = computed(() => props.sl)
const m = (d, k) => meta(d, k)
const srcColor = (i) => palette[i % palette.length]

/* 多序列/双轴的序列集合 */
const chartSeries = computed(() => {
  const sl = s.value
  if (sl.card === 'multi') {
    const all = [{ device: sl.device, key: sl.key }, ...(sl.extra || [])]
    return all.map((x, i) => ({
      name: m(x.device, x.key).label || x.key,
      color: srcColor(i),
      data: series(x.device, x.key),
    }))
  }
  if (sl.card === 'combo') {
    const out = [{ name: m(sl.device, sl.key).label || sl.key, color: srcColor(0), data: series(sl.device, sl.key), area: true }]
    const r = (sl.extra || [])[0]
    if (r) out.push({ name: m(r.device, r.key).label || r.key, color: srcColor(1), data: series(r.device, r.key), y2: true })
    return out
  }
  return [{
    name: sl.title,
    color: props.color,
    data: series(sl.device, sl.key),
    area: sl.card === 'line',
    bar: sl.card === 'bar',
  }]
})
const comboUnit2 = computed(() => {
  const r = (s.value.extra || [])[0]
  return r ? m(r.device, r.key).unit : ''
})

/* 概览卡数据行 */
const overviewRows = computed(() => {
  const sl = s.value
  return [{ device: sl.device, key: sl.key }, ...(sl.extra || [])].map((x) => ({
    label: m(x.device, x.key).label || x.key,
    value: latest(x.device, x.key),
    unit: m(x.device, x.key).unit,
    sub: `${x.device} · ${x.key}`,
  }))
})

const alarms = computed(() => activeAlarms.value)
const rep = computed(() => reportData.value[s.value.device] || null)
const isChart = computed(() => ['line', 'bar', 'multi', 'combo'].includes(s.value.card))
</script>

<template>
  <div class="card" :class="{ alarming: sl.device && isAlarming(sl.device, sl.key) }">
    <div class="card-head">
      <span class="card-title">{{ sl.title }}<span class="en">{{
        sl.kind === 'report' ? (sl.deviceLabel || '自然日报表')
          : sl.card === 'alarmlist' ? '实时告警'
          : sl.card === 'multi' ? `${1 + (sl.extra?.length || 0)} 序列`
          : sl.device }}</span></span>
      <div v-if="sl.kind === 'report'" class="card-side">
        <div class="side-kv"><div class="k">{{ rep?.mode === 'month' ? '最近月净收益' : '最近日净收益' }}</div>
          <div class="v">{{ fmt(rep?.latestNet, 2) }} 元</div></div>
      </div>
      <div v-else-if="sl.card === 'alarmlist'" class="card-side">
        <div class="side-kv"><div class="k">活动告警</div>
          <div class="v" :style="{ color: alarms.length ? 'var(--bad)' : 'var(--ok)' }">{{ alarms.length }}</div></div>
      </div>
      <div v-else-if="isChart || sl.card === 'gauge'" class="card-side">
        <div class="side-kv"><div class="k">当前</div>
          <div class="v">{{ fmt(latest(sl.device, sl.key)) }} {{ meta(sl.device, sl.key).unit }}</div></div>
      </div>
    </div>

    <!-- 报表 -->
    <div v-if="sl.kind === 'report' && !(rep?.inc || []).length" class="card-body report-empty">
      <div class="re-icon">📊</div>
      <div class="re-text">该站点暂无收益归档数据</div>
      <div class="re-sub">报表由 kzserver 归档,站点需接入收益统计后才有数据</div>
    </div>
    <div v-else-if="sl.kind === 'report'" class="card-body">
      <div v-if="rep?.mode === 'month'" class="report-note">本月暂无逐日归档 · 已切换为本年逐月视图</div>
      <LineChart unit="元" :series="[
        { name: '放电收入', color: '#199e70', data: rep?.inc || [], bar: true },
        { name: '充电成本', color: '#d95926', data: rep?.cost || [], bar: true },
        { name: '净收益', color: '#3987e5', data: rep?.net || [] },
      ]" />
    </div>

    <!-- 告警滚动列表 -->
    <div v-else-if="sl.card === 'alarmlist'" class="card-body alarm-scroll" :class="{ compact }">
      <div v-if="!alarms.length" class="as-empty">✓ 当前无活动告警</div>
      <div v-else class="as-list" :class="{ roll: alarms.length > 5 }">
        <div v-for="(a, i) in alarms" :key="a.name + a.since" class="as-row" :class="a.severity.toLowerCase()">
          <span class="as-dot"></span>
          <span class="as-name">{{ a.name }}</span>
          <span class="as-msg">{{ a.message }}</span>
          <span class="as-meta">{{ a.device }} · {{ sinceText(a.since) }}</span>
        </div>
      </div>
    </div>

    <!-- 多指标概览卡 -->
    <div v-else-if="sl.card === 'overview'" class="card-body ov-body" :class="{ compact }">
      <div v-for="(r, i) in overviewRows" :key="i" class="ov-row">
        <span class="ov-ind" :style="{ background: srcColor(i) }"></span>
        <span class="ov-label">{{ r.label }}</span>
        <span class="ov-val">{{ fmt(r.value) }}<em>{{ r.unit }}</em></span>
      </div>
    </div>

    <!-- 仪表盘 -->
    <div v-else-if="sl.card === 'gauge'" class="card-body gauge-body" :class="{ compact }">
      <GaugeArc :value="latest(sl.device, sl.key)" :max="sl.max || 100"
                :unit="meta(sl.device, sl.key).unit" :color="color" />
      <div class="gauge-sub">{{ sl.device }} · {{ sl.key }} / 量程 {{ sl.max || 100 }}</div>
    </div>

    <!-- 地图 -->
    <VehicleMap v-else-if="sl.card === 'map'" :lat="latest(sl.device, 'latitude')" :lng="latest(sl.device, 'longitude')" />

    <!-- 折线/柱状/多序列/双轴 -->
    <div v-else class="card-body" :class="{ 'chart-compact': compact }">
      <LineChart :unit="meta(sl.device, sl.key).unit" :unit2="comboUnit2" :series="chartSeries" />
    </div>
  </div>
</template>
