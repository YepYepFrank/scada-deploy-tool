<script setup lang="ts">
/**
 * 第 3 步的「数据源」面板(2026-09-23):点任何取数的格子,屏幕右侧滑出来,点选后填回去。
 * 结构按硬件组织:顶部是站点,左栏「网关 → 设备」树,右栏是所选设备的测点(中文名 / 遥测遥信 / 单位 / 最近值)。
 * 三种用法:
 *  - point:选一个测点,产出 `设备||测点`;可带「常数」项(四则运算);
 *  - device:只选设备,左栏就是整个面板,点设备即选中;
 *  - key:设备模板 / 全站汇聚这种「各设备的同名测点」,只列 key 与覆盖台数,不分设备。
 * 只负责「挑」,值的含义由调用方决定;搜索框跨网关搜设备和测点,↑↓ 回车可选,Esc 关闭。
 * 多选(multiple,第二步):行前是勾选框,点行 / 回车切换勾选,底部列出已选、「确定(N)」一次交回(pickMany);
 *  - singleDevice:周期统计这种「一台设备的若干测点」,值是裸 key,换设备会清空已选,交回时带上设备名;
 *  - onlyKind = '遥信':开关变位只列遥信,可勾「也显示非遥信」;字典里没有类型时不筛。
 * 第 4 步(组态编辑的绑定)也用它:设备来自元数据树(含资产),测点按需读(loadPoints),值为 `实体id||key`。
 * 面板 Teleport 到 body:编辑器全屏层、接线图编辑器里有 transform / overflow 的祖先,fixed 定位会被困住。
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
  type PointsLoader,
  type SourceDevice,
  type SourceGroup,
  type SourcePoint,
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
    /** 多选 */
    multiple?: boolean
    /** 多选的初值 */
    selected?: string[]
    /** 多选且只能是一台设备的测点(值为裸 key);打开时停在 ctxDevice */
    singleDevice?: boolean
    /** 只列这一类测点(可临时放开) */
    onlyKind?: '' | '遥测' | '遥信'
    /** 设备上标了 lazy 的,打开时才读测点(第 4 步:从平台拉) */
    loadPoints?: PointsLoader
    /** 右栏列的是什么:测点 / 属性 */
    pointNoun?: string
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
    multiple: false,
    selected: () => [],
    singleDevice: false,
    onlyKind: '',
    loadPoints: undefined,
    pointNoun: '测点',
  }
)
const emit = defineEmits<{ pick: [value: string]; pickMany: [values: string[], device?: string]; close: [] }>()

const q = ref('')
const sel = ref('')
/** 搜索时:false = 跨设备列结果;点了左侧某台设备 = 只看它 */
const scoped = ref(false)
const openGroups = ref(new Set<string>())
const active = ref(0)
const searchEl = ref<HTMLInputElement | null>(null)
/** 多选:已勾的(保持勾选顺序) */
const checked = ref<string[]>([])
/** onlyKind 时临时放开 */
const showAllKinds = ref(false)

/* ───── 按需读取的测点(第 4 步):设备 name(实体 id)→ 测点 ───── */
const loaded = ref(new Map<string, SourcePoint[]>())
const loading = ref(new Set<string>())
const failed = ref(new Set<string>())
const withLoaded = (d: SourceDevice): SourceDevice => (d.lazy ? { ...d, points: loaded.value.get(d.name) ?? [] } : d)
/** 面板里实际用的分组:按需读的设备换上已读到的测点 */
const G = computed<SourceGroup[]>(() =>
  props.loadPoints
    ? props.groups.map(g => ({
        ...g,
        ...(g.self ? { self: withLoaded(g.self) } : {}),
        devices: g.devices.map(withLoaded),
      }))
    : props.groups
)
const lazyMode = computed(() => !!props.loadPoints)
async function ensurePoints(name: string): Promise<void> {
  const d = findSourceDevice(props.groups, name)
  if (!d?.lazy || !props.loadPoints || loaded.value.has(name) || loading.value.has(name)) return
  loading.value = new Set(loading.value).add(name)
  try {
    const pts = await props.loadPoints(d)
    loaded.value = new Map(loaded.value).set(name, pts)
  } catch {
    failed.value = new Set(failed.value).add(name)
  } finally {
    const next = new Set(loading.value)
    next.delete(name)
    loading.value = next
  }
}
const isLoaded = (name: string) => loaded.value.has(name)

const devices = computed(() => allSourceDevices(G.value))
const recentDevices = computed(() =>
  props.recent
    .map(n => devices.value.find(d => d.name === n))
    .filter((d): d is SourceDevice => !!d)
    .slice(0, 6)
)

watch(
  () => props.open,
  async o => {
    if (!o) return
    q.value = ''
    scoped.value = false
    active.value = 0
    checked.value = [...props.selected]
    showAllKinds.value = false
    // 每次打开重新读(属性的 scope、绑定的 mode 可能变了;MetaClient 自己有缓存)
    loaded.value = new Map()
    failed.value = new Set()
    const cur =
      props.mode === 'point' ? splitPointValue(props.value)?.device : props.mode === 'device' ? props.value : ''
    const start =
      [cur, props.ctxDevice, ...props.recent].find(n => n && findSourceDevice(G.value, n)) ??
      devices.value[0]?.name ??
      ''
    sel.value = props.mode === 'point' ? (props.singleDevice && props.ctxDevice ? props.ctxDevice : start) : ''
    const g = start ? groupOfDevice(G.value, start) : undefined
    openGroups.value = new Set(G.value.length === 1 ? [G.value[0]!.id] : g ? [g] : [])
    if (sel.value) void ensurePoints(sel.value)
    await nextTick()
    searchEl.value?.focus()
  },
  { immediate: true }
)
watch(sel, n => {
  if (n) void ensurePoints(n)
})
watch(q, () => {
  scoped.value = false
  active.value = 0
})

const searching = computed(() => !!q.value.trim())
const shownGroups = computed(() => filterGroups(G.value, q.value, props.mode === 'point'))
const groupOpen = (id: string) => searching.value || openGroups.value.has(id)
function toggleGroup(id: string): void {
  const s = new Set(openGroups.value)
  if (s.has(id)) s.delete(id)
  else s.add(id)
  openGroups.value = s
}

/* ───── 类型筛选 ───── */
const kindKnown = computed(() =>
  props.mode === 'key'
    ? props.keys.some(k => !!k.kind)
    : allSourceDevices(G.value).some(d => d.points.some(p => !!p.kind))
)
const kindOn = computed(() => !!props.onlyKind && kindKnown.value && !showAllKinds.value)
const kindOk = (kind: string | undefined) => !kindOn.value || kind === props.onlyKind

/* ───── 右栏:测点 ───── */
interface Row {
  value: string
  text: string
  sub?: string
  kind?: string
  unit?: string
  latest?: string
  badge?: string
}
const selDevice = computed(() => (sel.value ? findSourceDevice(G.value, sel.value) : undefined))
const rows = computed<Row[]>(() => {
  const t = q.value.trim().toLowerCase()
  if (props.mode === 'key')
    return props.keys
      .filter(k => kindOk(k.kind) && (!t || k.text.toLowerCase().includes(t)))
      .map(k => ({ value: k.key, text: k.text, sub: k.note, kind: k.kind }))
  if (props.mode !== 'point') return []
  const pointRow = (d: SourceDevice, p: SourceDevice['points'][number], withDevice: boolean): Row => ({
    value: props.singleDevice ? p.key : joinPointValue(d.name, p.key),
    text: p.text,
    ...(withDevice ? { sub: d.label } : {}),
    kind: p.kind,
    unit: p.unit,
    latest: p.latest,
    ...(p.badge ? { badge: p.badge } : {}),
  })
  // 只能一台设备时不跨设备搜,只在当前设备里筛
  if (searching.value && !scoped.value && !props.singleDevice)
    return searchPoints(G.value, q.value)
      .filter(h => kindOk(h.point.kind))
      .map(h => pointRow(h.device, h.point, true))
  const d = selDevice.value
  if (!d) return []
  const pts =
    t && !d.label.toLowerCase().includes(t) ? d.points.filter(p => p.text.toLowerCase().includes(t)) : d.points
  return pts.filter(p => kindOk(p.kind)).map(p => pointRow(d, p, false))
})

/** 被类型筛选藏起来的测点数(给「也显示非遥信(N)」用) */
const hiddenByKind = computed(() => {
  if (!props.onlyKind || !kindKnown.value) return 0
  if (props.mode === 'key') return props.keys.filter(k => k.kind !== props.onlyKind).length
  const ds = props.singleDevice ? (selDevice.value ? [selDevice.value] : []) : allSourceDevices(G.value)
  return ds.reduce((n, d) => n + d.points.filter(p => p.kind !== props.onlyKind).length, 0)
})

function chooseDevice(d: SourceDevice): void {
  if (props.mode === 'device') return emit('pick', d.name)
  // 一台设备的多选:换设备就清空(裸 key 不带设备,留着会张冠李戴)
  if (props.multiple && props.singleDevice && d.name !== sel.value) checked.value = []
  sel.value = d.name
  if (searching.value) scoped.value = true
  active.value = 0
  const g = groupOfDevice(G.value, d.name)
  if (g && !openGroups.value.has(g)) toggleGroup(g)
}
function pick(v: string): void {
  if (props.multiple) return toggle(v)
  emit('pick', v)
}

/* ───── 多选 ───── */
const isChecked = (v: string) => checked.value.includes(v)
function toggle(v: string): void {
  checked.value = isChecked(v) ? checked.value.filter(x => x !== v) : [...checked.value, v]
}
/** 当前列出来的是不是全勾了 */
const allShownChecked = computed(() => rows.value.length > 0 && rows.value.every(r => isChecked(r.value)))
function toggleShown(): void {
  const vals = rows.value.map(r => r.value)
  checked.value = allShownChecked.value
    ? checked.value.filter(v => !vals.includes(v))
    : [...checked.value, ...vals.filter(v => !isChecked(v))]
}
/** 已选的显示文字(找不到的原样显示) */
function checkedText(v: string): string {
  if (props.mode === 'key') return props.keys.find(k => k.key === v)?.text ?? v
  if (props.singleDevice) return selDevice.value?.points.find(p => p.key === v)?.text ?? v
  const p = splitPointValue(v)
  const d = p ? findSourceDevice(G.value, p.device) : undefined
  const pt = d?.points.find(x => x.key === p!.key)
  return d && pt ? `${d.label} · ${pt.text}` : v
}
function confirm(): void {
  emit('pickMany', [...checked.value], props.singleDevice ? sel.value || undefined : undefined)
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
    // 多选:Ctrl + 回车 = 确定
    if (props.multiple && (e.ctrlKey || e.metaKey)) {
      e.preventDefault()
      return confirm()
    }
    const v = pickable.value[active.value]
    if (v) {
      e.preventDefault()
      if (props.mode === 'device') emit('pick', v)
      else pick(v)
    }
  }
}
const isActive = (v: string) => pickable.value[active.value] === v
const isCurrent = (v: string) => !!props.value && v === props.value
const empty = computed(() => !G.value.length && props.mode !== 'key')
</script>

<template>
  <Teleport to="body">
    <!-- 固定时长:不依赖 transitionend(页面不绘制时它不来,面板会卡在半路) -->
    <Transition name="dsd" :duration="{ enter: 180, leave: 180 }">
      <aside v-if="open" class="dsd" :class="`dsd-${mode}`" data-role="source-drawer" @keydown="onKey">
        <header class="dsd-head">
          <div class="dsd-title">
            <b>{{ title }}</b>
            <span v-if="siteLabel" class="dsd-site">站点 · {{ siteLabel }}</span>
          </div>
          <button type="button" class="dsd-x" data-role="source-close" title="关闭(Esc)" @click="emit('close')">
            ✕
          </button>
        </header>

        <input
          ref="searchEl"
          v-model="q"
          class="dsd-q"
          data-role="source-search"
          :placeholder="
            mode === 'device'
              ? '搜设备:中文名 / 英文名'
              : mode === 'key'
                ? `搜${pointNoun}:中文名 / key`
                : `搜设备或${pointNoun}:中文名 / key`
          "
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

        <div v-if="multiple && onlyKind && kindKnown" class="dsd-kind">
          <span class="dsd-muted">{{ kindOn ? `只列${onlyKind}` : '显示全部测点' }}</span>
          <label v-if="hiddenByKind || showAllKinds" class="dsd-check">
            <input v-model="showAllKinds" type="checkbox" data-role="source-show-all-kinds" />也显示非{{ onlyKind }}({{
              hiddenByKind
            }})
          </label>
        </div>

        <p v-if="empty" class="dsd-empty" data-role="source-empty">{{ emptyText || '第 2 步还没有认领任何测点' }}</p>

        <!-- key 模式:各设备的同名测点 -->
        <template v-else-if="mode === 'key'">
          <p v-if="keyScope" class="dsd-muted dsd-scope">{{ keyScope }}</p>
          <div class="dsd-cols dsd-cols-key">
            <span
              >{{ pointNoun
              }}<button
                v-if="multiple && rows.length"
                type="button"
                class="dsd-link"
                data-role="source-toggle-shown"
                @click="toggleShown"
              >
                {{ allShownChecked ? '取消全选' : searching ? '全选筛选结果' : '全选' }}
              </button></span
            ><span class="r">覆盖</span>
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
                <span class="dsd-name"
                  ><input
                    v-if="multiple"
                    type="checkbox"
                    class="dsd-tick"
                    :checked="isChecked(r.value)"
                    tabindex="-1"
                  />{{ r.text }}</span
                >
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
                  :style="d.depth ? { paddingLeft: `${22 + d.depth * 14}px` } : undefined"
                  @click="chooseDevice(d)"
                >
                  <span class="dsd-name">{{ d === g.self && !g.id.startsWith('one:') ? '(网关本体)' : d.label }}</span>
                  <span class="dsd-muted">{{ d.note ?? (d.lazy && !isLoaded(d.name) ? '' : d.points.length) }}</span>
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
                  ? `搜索结果 ${rows.length} 条${rows.length >= 200 ? '(只列前 200 条,再多打几个字)' : ''}${
                      lazyMode ? `(只含打开过的设备的${pointNoun})` : ''
                    }`
                  : selDevice
                    ? selDevice.label
                    : '在左边选一台设备'
              }}
            </p>
            <div class="dsd-cols">
              <span
                >{{ pointNoun
                }}<button
                  v-if="multiple && rows.length"
                  type="button"
                  class="dsd-link"
                  data-role="source-toggle-shown"
                  @click="toggleShown"
                >
                  {{
                    allShownChecked ? '取消全选' : searching && !scoped && !singleDevice ? '全选搜索结果' : '全选本设备'
                  }}
                </button></span
              ><span>类型</span><span>单位</span><span class="r">最近值</span>
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
                    ><input
                      v-if="multiple"
                      type="checkbox"
                      class="dsd-tick"
                      :checked="isChecked(r.value)"
                      tabindex="-1"
                    />{{ r.text }}<small v-if="r.sub" class="dsd-muted"> · {{ r.sub }}</small></span
                  >
                  <span class="dsd-muted">{{ r.kind }}</span>
                  <span class="dsd-muted">{{ r.unit }}</span>
                  <span v-if="r.badge" class="r dsd-badge">{{ r.badge }}</span>
                  <span v-else class="r">{{ r.latest }}</span>
                </button>
              </li>
              <li v-if="selDevice && loading.has(selDevice.name) && !(searching && !scoped)" class="dsd-empty">
                读取{{ pointNoun }}…
              </li>
              <li v-else-if="selDevice && failed.has(selDevice.name) && !(searching && !scoped)" class="dsd-empty">
                读不到这台设备的{{ pointNoun }}
              </li>
              <li v-else-if="!rows.length && (selDevice || searching)" class="dsd-empty">
                {{
                  searching
                    ? `没有匹配「${q}」的${pointNoun}`
                    : lazyMode
                      ? `这台设备没有${pointNoun}`
                      : '这台设备没有认领测点'
                }}
              </li>
            </ul>
          </section>
        </div>
        <footer v-if="multiple" class="dsd-foot" data-role="source-foot">
          <div v-if="checked.length" class="dsd-picked">
            <span
              v-for="v in checked"
              :key="v"
              class="dsd-chip on"
              data-role="source-picked"
              :title="checkedText(v)"
              @click="toggle(v)"
              >{{ checkedText(v) }} ×</span
            >
          </div>
          <div class="dsd-foot-bar">
            <span class="dsd-muted">已选 {{ checked.length }} 个{{ singleDevice ? ' · 换设备会清空' : '' }}</span>
            <span class="dsd-grow" />
            <button v-if="checked.length" type="button" class="dsd-x" data-role="source-clear" @click="checked = []">
              清空
            </button>
            <button type="button" class="dsd-x" @click="emit('close')">取消</button>
            <button type="button" class="dsd-ok" data-role="source-confirm" @click="confirm">
              确定({{ checked.length }})
            </button>
          </div>
        </footer>
      </aside>
    </Transition>
  </Teleport>
</template>

<style>
.dsd {
  position: fixed;
  top: 0;
  right: 0;
  bottom: 0;
  /* 盖过编辑器全屏层(1000)与接线图编辑器(1100 / 1200) */
  z-index: 2000;
  display: flex;
  flex-direction: column;
  gap: 8px;
  width: min(600px, 50vw);
  min-width: 360px;
  padding: 14px 16px;
  color: var(--ink-0, #ecf9ff);
  background: var(--bg-1, #061c40);
  border-left: 1px solid var(--line-1, rgba(83, 196, 255, 0.32));
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
  color: var(--ink-2, #8fbce8);
  font-size: 12px;
}
.dsd-x {
  padding: 2px 8px;
  color: var(--ink-1, #cdeeff);
  background: none;
  border: 1px solid var(--line-0, rgba(83, 196, 255, 0.16));
  border-radius: var(--r, 6px);
  cursor: pointer;
}
.dsd-q {
  padding: 7px 10px;
  color: var(--ink-0, #ecf9ff);
  font: inherit;
  background: var(--bg-0, #041634);
  border: 1px solid var(--line-1, rgba(83, 196, 255, 0.32));
  border-radius: var(--r, 6px);
  outline: none;
}
.dsd-q:focus {
  border-color: var(--accent, #19b7ff);
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
  color: var(--ink-1, #cdeeff);
  font: inherit;
  font-size: 12px;
  white-space: nowrap;
  text-overflow: ellipsis;
  background: none;
  border: 1px solid var(--line-1, rgba(83, 196, 255, 0.32));
  border-radius: 12px;
  cursor: pointer;
}
.dsd-chip.on {
  color: var(--ink-0, #ecf9ff);
  border-color: var(--accent, #19b7ff);
}
.dsd-const {
  display: flex;
  gap: 8px;
  align-items: baseline;
  padding: 6px 10px;
  color: var(--ink-0, #ecf9ff);
  font: inherit;
  text-align: left;
  background: var(--bg-0, #041634);
  border: 1px dashed var(--line-1, rgba(83, 196, 255, 0.32));
  border-radius: var(--r, 6px);
  cursor: pointer;
}
.dsd-const.on {
  border-color: var(--accent, #19b7ff);
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
  border-right: 1px solid var(--line-0, rgba(83, 196, 255, 0.16));
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
  color: var(--ink-1, #cdeeff);
  font: inherit;
  font-size: 13px;
  text-align: left;
  background: none;
  border: 0;
  border-radius: 4px;
  cursor: pointer;
}
.dsd-gw {
  color: var(--ink-0, #ecf9ff);
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
  color: var(--ink-0, #ecf9ff);
  background: rgba(25, 183, 255, 0.2);
}
.dsd-row.act,
.dsd-dev.act {
  outline: 1px solid var(--accent, #19b7ff);
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
  color: var(--ink-2, #8fbce8);
  font-size: 12px;
  border-bottom: 1px solid var(--line-0, rgba(83, 196, 255, 0.16));
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
  color: var(--ink-2, #8fbce8);
  font-size: 12px;
}
.dsd-badge {
  color: #ffd27a;
  font-size: 11px;
}
.dsd-kind {
  display: flex;
  gap: 10px;
  align-items: center;
}
.dsd-check {
  display: inline-flex;
  gap: 4px;
  align-items: center;
  color: var(--ink-1, #cdeeff);
  font-size: 12px;
  cursor: pointer;
}
.dsd-link {
  margin-left: 8px;
  padding: 0;
  color: var(--accent, #19b7ff);
  font: inherit;
  font-size: 12px;
  background: none;
  border: 0;
  cursor: pointer;
}
.dsd-tick {
  margin: 0 6px 0 0;
  vertical-align: -2px;
  pointer-events: none;
}
.dsd-foot {
  display: grid;
  gap: 6px;
  padding-top: 8px;
  border-top: 1px solid var(--line-0, rgba(83, 196, 255, 0.16));
}
.dsd-picked {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  max-height: 84px;
  overflow-y: auto;
}
.dsd-picked .dsd-chip {
  max-width: 220px;
}
.dsd-foot-bar {
  display: flex;
  gap: 8px;
  align-items: center;
}
.dsd-grow {
  flex: 1;
}
.dsd-ok {
  padding: 4px 14px;
  color: var(--bg-0, #041634);
  font: inherit;
  font-weight: 600;
  background: var(--accent, #19b7ff);
  border: 1px solid var(--accent, #19b7ff);
  border-radius: var(--r, 6px);
  cursor: pointer;
}
/* 面板开着时配置弹窗往左让开,不被挡住 */
.modal-mask.with-drawer {
  padding-right: min(600px, 50vw);
}
.modal-mask.with-drawer.narrow-drawer {
  padding-right: min(420px, 40vw);
}
</style>
