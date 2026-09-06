<script setup lang="ts">
/** 告警滚动列表(← SlotCard alarmlist):alarms 槽位为当前活动告警全集;compact 用于模板顶部横幅。 */
import { computed } from 'vue'
import type { AlarmInfo } from '@grid/tb-client'
import CardFrame from '../_shared/CardFrame.vue'

const props = withDefaults(
  defineProps<{
    title?: string
    subtitle?: string
    maxRows?: number
    compact?: boolean
    values?: Record<string, unknown>
    errors?: Record<string, string>
    disabled?: boolean
  }>(),
  {
    title: '实时告警',
    subtitle: '',
    maxRows: 20,
    compact: false,
    values: () => ({}),
    errors: () => ({}),
    disabled: false,
  }
)

/** 全部活动告警(计数用) */
const active = computed<AlarmInfo[]>(() => {
  const a = props.values.alarms
  const list = Array.isArray(a) ? (a as AlarmInfo[]) : []
  return list.filter(x => x.status?.startsWith('ACTIVE')).sort((x, y) => y.startTs - x.startTs)
})
/** 显示的前 maxRows 条 */
const alarms = computed(() => active.value.slice(0, props.maxRows))

function since(ts: number): string {
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000))
  if (s < 60) return `${s} 秒前`
  if (s < 3600) return `${Math.floor(s / 60)} 分钟前`
  if (s < 86400) return `${Math.floor(s / 3600)} 小时前`
  return `${Math.floor(s / 86400)} 天前`
}
const sev = (a: AlarmInfo) => a.severity.toLowerCase()
</script>

<template>
  <!-- 横幅模式:单行滚动 -->
  <div v-if="compact" class="sr-alarm-banner" :class="{ 'sr-has': alarms.length, 'sr-error': errors.alarms }">
    <template v-if="errors.alarms"
      ><span class="sr-ab-dot bad"></span><span class="sr-ab-text">告警数据不可用</span></template
    >
    <template v-else-if="!alarms.length"
      ><span class="sr-ab-dot ok"></span><span class="sr-ab-text">当前无活动告警</span></template
    >
    <template v-else>
      <span class="sr-ab-dot" :class="sev(alarms[0]!)"></span>
      <span class="sr-ab-count">{{ active.length }}</span>
      <span class="sr-ab-text">
        <b>{{ alarms[0]!.type }}</b>
        <span v-if="alarms[0]!.originatorName" class="sr-ab-dev">{{ alarms[0]!.originatorName }}</span>
        <span class="sr-ab-since">{{ since(alarms[0]!.startTs) }}</span>
      </span>
    </template>
  </div>

  <CardFrame
    v-else
    :title="title"
    :subtitle="subtitle"
    side-label="活动告警"
    :side-value="String(active.length)"
    :side-color="active.length ? 'var(--sr-bad)' : 'var(--sr-ok)'"
    :error="errors.alarms"
  >
    <div class="sr-alarm-list">
      <div v-if="!alarms.length" class="sr-empty-hint">✓ 当前无活动告警</div>
      <div v-for="a in alarms" :key="a.id" class="sr-al-row" :class="sev(a)">
        <span class="sr-al-dot"></span>
        <span class="sr-al-type">{{ a.type }}</span>
        <span class="sr-al-dev">{{ a.originatorName ?? a.originator.id.slice(0, 8) }}</span>
        <span class="sr-al-since">{{ since(a.startTs) }}</span>
      </div>
    </div>
  </CardFrame>
</template>

<style>
.sr-alarm-list {
  height: 100%;
  overflow: auto;
  display: flex;
  flex-direction: column;
  gap: 4px;
  position: relative;
}
.sr-al-row {
  display: grid;
  grid-template-columns: 10px 1fr auto auto;
  align-items: center;
  gap: 10px;
  padding: 6px 8px;
  border-radius: 4px;
  background: color-mix(in srgb, var(--sr-line-0) 60%, transparent);
  font-size: max(12px, calc(var(--sr-min-text, 10px) / var(--sr-scale, 1)));
}
.sr-al-dot,
.sr-ab-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--sr-warn);
  box-shadow: 0 0 6px var(--sr-warn);
}
.critical .sr-al-dot,
.major .sr-al-dot,
.sr-ab-dot.critical,
.sr-ab-dot.major,
.sr-ab-dot.bad {
  background: var(--sr-bad);
  box-shadow: 0 0 6px var(--sr-bad);
}
.sr-ab-dot.ok {
  background: var(--sr-ok);
  box-shadow: 0 0 6px var(--sr-ok);
}
.sr-al-type {
  color: var(--sr-ink-0);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.sr-al-dev,
.sr-al-since,
.sr-ab-dev,
.sr-ab-since {
  color: var(--sr-ink-2);
  font-family: var(--sr-font-num);
  font-size: max(11px, calc(var(--sr-min-text, 10px) / var(--sr-scale, 1)));
  white-space: nowrap;
}
.sr-alarm-banner {
  height: 100%;
  box-sizing: border-box;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 0 16px;
  border: 1px solid var(--sr-line-0);
  border-radius: var(--sr-radius);
  background: var(--sr-bg-1);
  font-size: max(13px, calc(var(--sr-min-text, 10px) / var(--sr-scale, 1)));
  color: var(--sr-ink-1);
}
.sr-alarm-banner.sr-has {
  border-color: color-mix(in srgb, var(--sr-warn) 60%, transparent);
}
.sr-ab-count {
  font-family: var(--sr-font-num);
  font-size: 16px;
  color: var(--sr-bad);
}
.sr-ab-text b {
  color: var(--sr-ink-0);
  margin-right: 10px;
}
.sr-ab-dev {
  margin-right: 10px;
}
</style>
