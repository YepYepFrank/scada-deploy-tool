<script setup lang="ts">
/**
 * 预览里的「上下文模拟」条(渲染器 0.9.0 BindingContext)。
 * 页面里有绑定跟随页面上下文时才出现:工程人员在这里扮演宿主——挑当前设备 / 站点、填当前测点、改时间范围,
 * 看卡片跟着换;也能选「(不选)」看缺上下文时的样子。初值取各绑定的样例(fallback),一打开预览就有数。
 * 只改内存里的模拟上下文,不写进页面配置。
 */
import { computed } from 'vue'
import type { BindingContext, PageConfig } from '@grid/scada-renderer'
import type { EntityRef } from '@grid/tb-client'
import type { MetaNode } from '../meta/MetaNode'
import { dual } from '../naming'

const props = defineProps<{
  /** 页面引用到的上下文键(contextKeysOf) */
  keys: string[]
  tree: MetaNode | null
  modelValue: BindingContext
  config: PageConfig
}>()
const emit = defineEmits<{ 'update:modelValue': [ctx: BindingContext] }>()

const WINDOWS = ['15m', '1h', '2h', '6h', '12h', '24h', '3d', '7d', '30d', '90d']
const LABEL: Record<string, string> = {
  selectedDevice: '当前设备',
  selectedSite: '当前站点',
  selectedMeasurePoint: '当前测点',
  timeRange: '时间范围',
}
const labelOf = (k: string) => LABEL[k] ?? k

/** 树上全部实体(设备 + 资产),给下拉用 */
const entities = computed<{ ref: EntityRef; text: string }[]>(() => {
  const out: { ref: EntityRef; text: string }[] = []
  const walk = (n: MetaNode | null) => {
    if (!n) return
    if (n.entity) out.push({ ref: n.entity, text: `${n.entity.type === 'ASSET' ? '◆' : '▫'} ${dual(n.label, n.name)}` })
    n.children.forEach(walk)
  }
  walk(props.tree)
  return out
})

/** 这个键在页面里被当成什么用:实体 / 测点 / 时间范围(custom.* 要看它出现在绑定的哪个位置) */
function kindOf(key: string): 'entity' | 'key' | 'window' {
  if (key === 'selectedMeasurePoint') return 'key'
  if (key === 'timeRange') return 'window'
  if (key === 'selectedDevice' || key === 'selectedSite') return 'entity'
  const is = (x: unknown) => !!x && typeof x === 'object' && (x as { source?: string; key?: string }).key === key
  for (const w of props.config.widgets)
    for (const v of Object.values(w.bindings))
      for (const b of (Array.isArray(v) ? v : [v]) as unknown as Record<string, unknown>[]) {
        if (is(b.window)) return 'window'
        if (is(b.key) || (Array.isArray(b.keys) && b.keys.some(is))) return 'key'
      }
  return 'entity'
}
const rows = computed(() => props.keys.map(k => ({ key: k, kind: kindOf(k) })))

const get = (key: string): unknown =>
  key.startsWith('custom.')
    ? props.modelValue.custom?.[key.slice(7)]
    : (props.modelValue as Record<string, unknown>)[key]
function set(key: string, value: unknown) {
  const next: BindingContext = { ...props.modelValue }
  if (key.startsWith('custom.')) next.custom = { ...(next.custom ?? {}), [key.slice(7)]: value }
  else (next as Record<string, unknown>)[key] = value
  emit('update:modelValue', next)
}

const entityId = (key: string) => (get(key) as EntityRef | null | undefined)?.id ?? ''
function pickEntity(key: string, id: string) {
  set(key, id ? (entities.value.find(e => e.ref.id === id)?.ref ?? null) : null)
}

// 时间范围:字面量,或起止(datetime-local ⇄ 毫秒)
const isAbs = (key: string) => typeof get(key) === 'object' && get(key) !== null
const pad = (n: number) => String(n).padStart(2, '0')
const toLocal = (ms: number) => {
  const d = new Date(ms)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}
const literalOf = (key: string): string => (typeof get(key) === 'string' ? (get(key) as string) : '')
const absOf = (key: string) => get(key) as { from: number; to: number }
function setRangeMode(key: string, raw: string) {
  if (raw === '') return set(key, null)
  if (raw !== '@abs') return set(key, raw)
  const now = Date.now()
  set(key, { from: now - 86_400_000, to: now })
}
function setAbs(key: string, side: 'from' | 'to', raw: string) {
  const ms = Date.parse(raw)
  if (Number.isFinite(ms)) set(key, { ...absOf(key), [side]: ms })
}
const ev = (e: Event) => (e.target as HTMLInputElement | HTMLSelectElement).value
</script>

<template>
  <div class="csb" data-role="ctx-sim">
    <span class="csb-title" title="这页有绑定跟随页面上下文。正式环境里这些值由宿主页面提供,这里只是模拟">
      上下文模拟
    </span>
    <template v-for="r in rows" :key="r.key">
      <label v-if="r.kind === 'entity'" class="csb-item"
        >{{ labelOf(r.key) }}
        <select :value="entityId(r.key)" :data-ctx="r.key" @change="pickEntity(r.key, ev($event))">
          <option value="">(不选)</option>
          <option v-for="e in entities" :key="e.ref.id" :value="e.ref.id">{{ e.text }}</option>
        </select></label
      >
      <label v-else-if="r.kind === 'key'" class="csb-item"
        >{{ labelOf(r.key) }}
        <input
          :value="typeof get(r.key) === 'string' ? get(r.key) : ''"
          :data-ctx="r.key"
          placeholder="测点 key,如 P"
          @change="set(r.key, ev($event).trim() || null)"
      /></label>
      <span v-else class="csb-item"
        >{{ labelOf(r.key) }}
        <select
          :value="isAbs(r.key) ? '@abs' : literalOf(r.key)"
          :data-ctx="r.key"
          @change="setRangeMode(r.key, ev($event))"
        >
          <option value="">(不选)</option>
          <option v-for="w in WINDOWS" :key="w" :value="w">最近 {{ w }}</option>
          <option value="@abs">起止时间…</option>
        </select>
        <template v-if="isAbs(r.key)">
          <input
            type="datetime-local"
            :value="toLocal(absOf(r.key).from)"
            data-role="ctx-from"
            @change="setAbs(r.key, 'from', ev($event))"
          />
          –
          <input
            type="datetime-local"
            :value="toLocal(absOf(r.key).to)"
            data-role="ctx-to"
            @change="setAbs(r.key, 'to', ev($event))"
          />
        </template>
      </span>
    </template>
  </div>
</template>

<style>
.csb {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px 14px;
  padding: 6px 12px;
  font-size: 12px;
  border-bottom: 1px solid var(--ed-line, rgba(83, 196, 255, 0.2));
  background: rgba(25, 183, 255, 0.06);
}
.csb-title {
  font-weight: 600;
  color: var(--ed-accent, #19b7ff);
  cursor: help;
}
.csb-item {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.csb select,
.csb input {
  background: var(--ed-bg-1, #0b1a33);
  border: 1px solid var(--ed-line, rgba(83, 196, 255, 0.2));
  border-radius: 6px;
  padding: 3px 6px;
  color: inherit;
  font: inherit;
  max-width: 260px;
}
</style>
