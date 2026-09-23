<script setup lang="ts">
/**
 * 第 3 步的「数据源」面板(2026-09-23):点任何取数的格子,屏幕右侧滑出来,点选后填回去。
 * 结构按硬件组织:顶部是站点,左栏「网关 → 设备」树,右栏是所选设备的测点(中文名 / 遥测遥信 / 单位 / 最近值)。
 * 三种用法:
 *  - point:选一个测点,产出 `设备||测点`;可带「常数」项(四则运算);
 *  - device:只选设备,左栏就是整个面板,点设备即选中;
 *  - key:设备模板 / 全站汇聚这种「各设备的同名测点」,只列 key 与覆盖台数,不分设备。
 * 只负责「挑」,值的含义由调用方决定;搜索框跨网关搜设备和测点,↑↓ 回车可选,Esc 关闭。
 */
import { computed, nextTick, ref, watch } from 'vue'
import {
  CONST_VALUE,
  allSourceDevices,
  filterGroups,
  findSourceDevice,
  groupOfDevice,
  joinPointValue,
  searchPoints,
  splitPointValue,
  type KeyOption,
  type SourceDevice,
  type SourceGroup,
} from './source-picker'

const props = withDefaults(
  defineProps<{
    open: boolean
    title: string
    siteLabel?: string
    mode?: 'point' | 'device' | 'key'
    groups?: SourceGroup[]
    keys?: KeyOption[]
    /** key 模式的范围说明,如「模板匹配的 8 台设备」 */
    keyScope?: string
    /** 当前值(高亮用):point 为 `设备||测点`,device 为设备名,key 为测点 key */
    value?: string
    /** point 模式:顶部多一个「常数」项 */
    allowConst?: boolean
    /** 打开时优先停在哪台设备(如四则运算上一项的设备) */
    ctxDevice?: string
    /** 最近用过的设备名(新的在前) */
    recent?: string[]
    /** 没有可选设备时的说明(常用方案:没有具备所需测点的设备) */
    emptyText?: string
  }>(),
  {
    siteLabel: '',
    mode: 'point',
    groups: () => [],
    keys: () => [],
    keyScope: '',
    value: '',
    allowConst: false,
    ctxDevice: '',
    recent: () => [],
    emptyText: '',
  }
)
const emit = defineEmits<{ pick: [value: string]; close: [] }>()

const q = ref('')
const sel = ref('')
/** 搜索时:false = 跨设备列结果;点了左侧某台设备 = 只看它 */
const scoped = ref(false)
const openGroups = ref(new Set<string>())
const active = ref(0)
const searchEl = ref<HTMLInputElement | null>(null)

const devices = computed(() => allSourceDevices(props.groups))
const recentDevices = computed(() =>
  props.recent.map(n => devices.value.find(d => d.name === n)).filter((d): d is SourceDevice => !!d).slice(0, 6)
)

watch(
  () => props.open,
  async o => {
    if (!o) return
    q.value = ''
    scoped.value = false
    active.value = 0
    const cur = props.mode === 'point' ? splitPointValue(props.value)?.device : props.mode === 'device' ? props.value : ''
    const start =
      [cur, props.ctxDevice, ...props.recent].find(n => n && findSourceDevice(props.groups, n)) ??
      devices.value[0]?.name ??
      ''
    sel.value = props.mode === 'point' ? start : ''
    const g = start ? groupOfDevice(props.groups, start) : undefined
    openGroups.value = new Set(props.groups.length === 1 ? [props.groups[0]!.id] : g ? [g] : [])
    await nextTick()
    searchEl.value?.focus()
  },
  { immediate: true }
)
watch(q, () => {
  scoped.value = false
  active.value = 0
})

const searching = computed(() => !!q.value.trim())
const shownGroups = computed(() => filterGroups(props.groups, q.value, props.mode === 'point'))
const groupOpen = (id: string) => searching.value || openGroups.value.has(id)
function toggleGroup(id: string): void {
  const s = new Set(openGroups.value)
  if (s.has(id)) s.delete(id)
  else s.add(id)
  openGroups.value = s
}

/* ───── 右栏:测点 ───── */
interface Row {
  value: string
  text: string
  sub?: string
  kind?: string
  unit?: string
  latest?: string
}
const selDevice = computed(() => (sel.value ? findSourceDevice(props.groups, sel.value) : undefined))
const rows = computed<Row[]>(() => {
  const t = q.value.trim().toLowerCase()
  if (props.mode === 'key')
    return props.keys
      .filter(k => !t || k.text.toLowerCase().includes(t))
      .map(k => ({ value: k.key, text: k.text, sub: k.note }))
  if (props.mode !== 'point') return []
  const pointRow = (d: SourceDevice, p: SourceDevice['points'][number], withDevice: boolean): Row => ({
    value: joinPointValue(d.name, p.key),
    text: p.text,
    ...(withDevice ? { sub: d.label } : {}),
    kind: p.kind,
    unit: p.unit,
    latest: p.latest,
  })
  if (searching.value && !scoped.value) return searchPoints(props.groups, q.value).map(h => pointRow(h.device, h.point, true))
  const d = selDevice.value
  if (!d) return []
  const pts = t && !d.label.toLowerCase().includes(t) ? d.points.filter(p => p.text.toLowerCase().includes(t)) : d.points
  return pts.map(p => pointRow(d, p, false))
})

function chooseDevice(d: SourceDevice): void {
  if (props.mode === 'device') return emit('pick', d.name)
  sel.value = d.name
  if (searching.value) scoped.value = true
  active.value = 0
  const g = groupOfDevice(props.groups, d.name)
  if (g && !openGroups.value.has(g)) toggleGroup(g)
}
function pick(v: string): void {
  emit('pick', v)
}

/* ───── 键盘 ───── */
const pickable = computed<string[]>(() =>
  props.mode === 'device'
    ? shownGroups.value.flatMap(g => [...(g.self ? [g.self] : []), ...g.devices]).map(d => d.name)
    : rows.value.map(r => r.value)
)
function onKey(e: KeyboardEvent): void {
  if (e.key === 'Escape') {
    e.stopPropagation()
    emit('close')
  } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault()
    const n = pickable.value.length
    if (n) active.value = (active.value + (e.key === 'ArrowDown' ? 1 : n - 1)) % n
  } else if (e.key === 'Enter') {
    const v = pickable.value[active.value]
    if (v) {
      e.preventDefault()
      emit('pick', v)
    }
  }
}
const isActive = (v: string) => pickable.value[active.value] === v
const isCurrent = (v: string) => !!props.value && v === props.value
const empty = computed(() => !props.groups.length && props.mode !== 'key')
</script>

<template>
  <!-- 固定时长:不依赖 transitionend(页面不绘制时它不来,面板会卡在半路) -->
  <Transition name="dsd" :duration="{ enter: 180, leave: 180 }">
    <aside v-if="open" class="dsd" :class="`dsd-${mode}`" data-role="source-drawer" @keydown="onKey">
      <header class="dsd-head">
        <div class="dsd-title">
          <b>{{ title }}</b>
          <span v-if="siteLabel" class="dsd-site">站点 · {{ siteLabel }}</span>
        </div>
        <button type="button" class="dsd-x" data-role="source-close" title="关闭(Esc)" @click="emit('close')">✕</button>
      </header>

      <input
        ref="searchEl"
        v-model="q"
        class="dsd-q"
        data-role="source-search"
        :placeholder="mode === 'device' ? '搜设备:中文名 / 英文名' : mode === 'key' ? '搜测点:中文名 / key' : '搜设备或测点:中文名 / key'"
      />

      <div v-if="mode !== 'key' && recentDevices.length && !searching" class="dsd-recent">
        <span class="dsd-muted">最近用过</span>
        <button
          v-for="d in recentDevices"
          :key="d.name"
          type="button"
          class="dsd-chip"
          :class="{ on: d.name === sel }"
          data-role="source-recent"
          @click="chooseDevice(d)"
        >
          {{ d.label }}
        </button>
      </div>

      <button
        v-if="mode === 'point' && allowConst"
        type="button"
        class="dsd-const"
        :class="{ on: value === CONST_VALUE }"
        data-role="source-const"
        @click="pick(CONST_VALUE)"
      >
        【常数】<span class="dsd-muted">选了之后在格子旁边填数值</span>
      </button>

      <p v-if="empty" class="dsd-empty" data-role="source-empty">{{ emptyText || '第 2 步还没有认领任何测点' }}</p>

      <!-- key 模式:各设备的同名测点 -->
      <template v-else-if="mode === 'key'">
        <p v-if="keyScope" class="dsd-muted dsd-scope">{{ keyScope }}</p>
        <div class="dsd-cols dsd-cols-key">
          <span>测点</span><span class="r">覆盖</span>
        </div>
        <ul class="dsd-list dsd-rows">
          <li v-for="r in rows" :key="r.value">
            <button
              type="button"
              class="dsd-row dsd-row-key"
              :class="{ act: isActive(r.value), cur: isCurrent(r.value) }"
              data-role="source-key"
              :data-value="r.value"
              @click="pick(r.value)"
            >
              <span class="dsd-name">{{ r.text }}</span>
              <span class="dsd-muted r">{{ r.sub }}</span>
            </button>
          </li>
          <li v-if="!rows.length" class="dsd-empty">{{ searching ? `没有匹配「${q}」的测点` : '没有可选的测点' }}</li>
        </ul>
      </template>

      <div v-else class="dsd-body">
        <!-- 左栏:网关 → 设备 -->
        <nav class="dsd-tree" data-role="source-tree">
          <div v-for="g in shownGroups" :key="g.id" class="dsd-group">
            <button type="button" class="dsd-gw" data-role="source-gw" :data-id="g.id" @click="toggleGroup(g.id)">
              <span class="dsd-fold">{{ groupOpen(g.id) ? '▾' : '▸' }}</span>
              <span class="dsd-name">{{ g.label }}</span>
              <span class="dsd-muted">{{ g.devices.length + (g.self ? 1 : 0) }}</span>
            </button>
            <template v-if="groupOpen(g.id)">
              <button
                v-for="d in g.self ? [g.self, ...g.devices] : g.devices"
                :key="d.name"
                type="button"
                class="dsd-dev"
                :class="{
                  on: mode === 'point' && d.name === sel,
                  act: mode === 'device' && isActive(d.name),
                  cur: mode === 'device' && isCurrent(d.name),
                }"
                data-role="source-device"
                :data-name="d.name"
                :title="d.label"
                @click="chooseDevice(d)"
              >
                <span class="dsd-name">{{ d === g.self ? '(网关本体)' : d.label }}</span>
                <span class="dsd-muted">{{ d.note ?? d.points.length }}</span>
              </button>
            </template>
          </div>
          <p v-if="!shownGroups.length" class="dsd-empty">没有匹配「{{ q }}」的设备</p>
        </nav>

        <!-- 右栏:测点 -->
        <section v-if="mode === 'point'" class="dsd-points">
          <p class="dsd-muted dsd-scope">
            {{
              searching && !scoped
                ? `搜索结果 ${rows.length} 条${rows.length >= 200 ? '(只列前 200 条,再多打几个字)' : ''}`
                : selDevice
                  ? selDevice.label
                  : '在左边选一台设备'
            }}
          </p>
          <div class="dsd-cols">
            <span>测点</span><span>类型</span><span>单位</span><span class="r">最近值</span>
          </div>
          <ul class="dsd-list dsd-rows">
            <li v-for="r in rows" :key="r.value">
              <button
                type="button"
                class="dsd-row"
                :class="{ act: isActive(r.value), cur: isCurrent(r.value) }"
                data-role="source-point"
                :data-value="r.value"
                :title="r.sub ? `${r.sub} · ${r.text}` : r.text"
                @click="pick(r.value)"
              >
                <span class="dsd-name"
                  >{{ r.text }}<small v-if="r.sub" class="dsd-muted"> · {{ r.sub }}</small></span
                >
                <span class="dsd-muted">{{ r.kind }}</span>
                <span class="dsd-muted">{{ r.unit }}</span>
                <span class="r">{{ r.latest }}</span>
              </button>
            </li>
            <li v-if="!rows.length && (selDevice || searching)" class="dsd-empty">
              {{ searching ? `没有匹配「${q}」的测点` : '这台设备没有认领测点' }}
            </li>
          </ul>
        </section>
      </div>
    </aside>
  </Transition>
</template>

<style>
.dsd {
  position: fixed;
  top: 0;
  right: 0;
  bottom: 0;
  z-index: 120;
  display: flex;
  flex-direction: column;
  gap: 8px;
  width: min(600px, 50vw);
  min-width: 360px;
  padding: 14px 16px;
  color: var(--ink-0);
  background: var(--bg-1);
  border-left: 1px solid var(--line-1);
  box-shadow: -18px 0 60px rgba(0, 0, 0, 0.5);
}
.dsd.dsd-device,
.dsd.dsd-key {
  width: min(420px, 40vw);
}
.dsd-enter-active,
.dsd-leave-active {
  transition: transform 0.18s ease-out;
}
.dsd-enter-from,
.dsd-leave-to {
  transform: translateX(100%);
}
.dsd-head {
  display: flex;
  align-items: flex-start;
  gap: 8px;
}
.dsd-title {
  flex: 1;
  display: grid;
  gap: 2px;
  min-width: 0;
}
.dsd-title b {
  font-size: 15px;
  font-weight: 600;
}
.dsd-site,
.dsd-muted {
  color: var(--ink-2);
  font-size: 12px;
}
.dsd-x {
  padding: 2px 8px;
  color: var(--ink-1);
  background: none;
  border: 1px solid var(--line-0);
  border-radius: var(--r);
  cursor: pointer;
}
.dsd-q {
  padding: 7px 10px;
  color: var(--ink-0);
  font: inherit;
  background: var(--bg-0);
  border: 1px solid var(--line-1);
  border-radius: var(--r);
  outline: none;
}
.dsd-q:focus {
  border-color: var(--accent);
}
.dsd-recent {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  align-items: center;
}
.dsd-chip {
  max-width: 100%;
  overflow: hidden;
  padding: 2px 10px;
  color: var(--ink-1);
  font: inherit;
  font-size: 12px;
  white-space: nowrap;
  text-overflow: ellipsis;
  background: none;
  border: 1px solid var(--line-1);
  border-radius: 12px;
  cursor: pointer;
}
.dsd-chip.on {
  color: var(--ink-0);
  border-color: var(--accent);
}
.dsd-const {
  display: flex;
  gap: 8px;
  align-items: baseline;
  padding: 6px 10px;
  color: var(--ink-0);
  font: inherit;
  text-align: left;
  background: var(--bg-0);
  border: 1px dashed var(--line-1);
  border-radius: var(--r);
  cursor: pointer;
}
.dsd-const.on {
  border-color: var(--accent);
}
.dsd-body {
  flex: 1;
  display: grid;
  grid-template-columns: minmax(150px, 38%) minmax(0, 1fr);
  gap: 10px;
  min-height: 0;
}
.dsd-device .dsd-body {
  grid-template-columns: minmax(0, 1fr);
}
.dsd-tree {
  min-height: 0;
  overflow-y: auto;
  padding-right: 6px;
  border-right: 1px solid var(--line-0);
}
.dsd-device .dsd-tree {
  border-right: 0;
}
.dsd-gw,
.dsd-dev,
.dsd-row {
  display: flex;
  gap: 6px;
  align-items: baseline;
  width: 100%;
  min-width: 0;
  padding: 5px 6px;
  color: var(--ink-1);
  font: inherit;
  font-size: 13px;
  text-align: left;
  background: none;
  border: 0;
  border-radius: 4px;
  cursor: pointer;
}
.dsd-gw {
  color: var(--ink-0);
  font-weight: 600;
}
.dsd-dev {
  padding-left: 22px;
}
.dsd-gw:hover,
.dsd-dev:hover,
.dsd-row:hover {
  background: rgba(25, 183, 255, 0.1);
}
.dsd-dev.on,
.dsd-row.cur,
.dsd-dev.cur {
  color: var(--ink-0);
  background: rgba(25, 183, 255, 0.2);
}
.dsd-row.act,
.dsd-dev.act {
  outline: 1px solid var(--accent);
}
.dsd-fold {
  width: 12px;
  flex: none;
}
.dsd-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.dsd-points {
  display: flex;
  flex-direction: column;
  min-height: 0;
  min-width: 0;
}
.dsd-scope {
  margin: 0 0 4px;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.dsd-cols,
.dsd-row:not(.dsd-row-key) {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 38px 44px 64px;
  gap: 6px;
}
.dsd-cols {
  padding: 0 6px 4px;
  color: var(--ink-2);
  font-size: 12px;
  border-bottom: 1px solid var(--line-0);
}
.dsd-cols-key {
  grid-template-columns: minmax(0, 1fr) 80px;
}
.dsd-row-key {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 80px;
}
.r {
  text-align: right;
}
.dsd-list {
  flex: 1;
  min-height: 0;
  margin: 0;
  padding: 0;
  overflow-y: auto;
  list-style: none;
}
.dsd-empty {
  margin: 8px 0;
  color: var(--ink-2);
  font-size: 12px;
}
/* 面板开着时配置弹窗往左让开,不被挡住 */
.modal-mask.with-drawer {
  padding-right: min(600px, 50vw);
}
.modal-mask.with-drawer.narrow-drawer {
  padding-right: min(420px, 40vw);
}
</style>
