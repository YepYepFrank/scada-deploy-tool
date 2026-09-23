<script setup lang="ts">
/**
 * 一次接线图运行时组件(ADR-005 D7:纯 Vue + SVG,零新依赖)。
 *
 * 外壳:取数、开关三态、带电计算、告警归并、过期时钟、平移缩放与点击;画图交给 SldScene(内容层)。
 * 依赖链刻意收窄,免得 400 个测点里跳一个数就全图重算:
 *   状态测点的值 ─→ stateSig(字符串)─→ nodeStates ─→ switchSig(字符串)─→ energy
 * 中间用字符串是因为 computed 的值没变就不会通知下游:状态测点重推同一个值、`now` 每 10 秒跳一次,
 * 只要三态没变,energize 与 SldScene 都不会动。数值标签各自读自己的键(见 context.ts),不经过这里。
 *
 * design 态:组件拿不到 design 标志(ScadaPage / ScadaWidget 不往下传),靠祖先 `.sr-page.sr-design` 的 class 判断,
 * 并用 MutationObserver 跟着切换;design 态不起定时器、不判过期、不响应交互。
 */
import { computed, onBeforeUnmount, onMounted, provide, ref, watch } from 'vue'
import {
  SLD_ALARMS_SLOT,
  energize,
  isSldDoc,
  lookupSldSymbol,
  resolveOnlineState,
  resolveSwitchState,
  sldPointSlot,
  type SldDoc,
  type SldOnlineRef,
  type SldStateRef,
  type SldSwitchState,
  type SldSwitchStyle,
  type SldValueLook,
} from '../../sld'
import { SLD_CONTEXT_KEY } from './context'
import { sldCoords, type SldScreenMapper } from './coords'
import {
  DEFAULT_KV_COLORS,
  alarmLevelsByEntity,
  asPointValue,
  entityIdsFromBindings,
  entityKey,
  flattenAlarms,
  type SldKvColor,
} from './format'
import SldScene from './SldScene.vue'

const props = withDefaults(
  defineProps<{
    doc?: SldDoc
    /**
     * 数值测点的时间戳早于这么久就变灰;0 不判。
     * **开关位置不看它**(2026-09-23):开关只在变位时上报,T2_CB 一周没变过是常态,不能因此画成「未知」;
     * 开关的「通信异常(灰)」只看设备在线灯(active)是否离线、或测点从没收到过值。
     */
    staleSeconds?: number
    /** 开关画法(2026-09-23):state = 合闸红 / 分闸绿 / 通信异常灰(缺省);classic = 国标图形 + 带电着色 */
    switchStyle?: SldSwitchStyle
    /**
     * 数值标签的样式(2026-09-23):meter = 数码框(黑底七段数码管、右对齐,小数点对成一列,缺省);
     * plain = 纯文字。标签自己设了 look 的以标签为准
     */
    valueStyle?: SldValueLook
    /** 画图元名称(SldNode.name)与母线名称 */
    showNames?: boolean
    /** 带电着色;关掉后全部用主题强调色 */
    energizeColoring?: boolean
    /** 滚轮缩放 / 拖动平移 / 双击复位;关掉后仍可点击节点 */
    interactive?: boolean
    /** 电压等级配色 */
    kvColors?: SldKvColor[]
    /** 本组件的绑定(组件定义声明了 receivesBindings,宿主传入,只读):取节点实体的 id */
    bindings?: Record<string, unknown>
    values?: Record<string, unknown>
    errors?: Record<string, string>
    disabled?: boolean
  }>(),
  {
    doc: undefined,
    staleSeconds: 600,
    switchStyle: 'state',
    valueStyle: 'meter',
    showNames: true,
    energizeColoring: true,
    interactive: true,
    kvColors: () => DEFAULT_KV_COLORS,
    bindings: () => ({}),
    values: () => ({}),
    errors: () => ({}),
    disabled: false,
  }
)
const emit = defineEmits<{
  /** 由 <ScadaPage> / <ScadaWidget> / 放大层补上 widgetId、type 后抛给宿主 */
  (e: 'widget-event', ev: { name: string; detail?: unknown }): void
}>()

/* ───────────── 图 ───────────── */

const doc = computed(() => (isSldDoc(props.doc) ? props.doc : undefined))
const empty = computed(
  () => !doc.value || (!doc.value.nodes.length && !doc.value.buses.length && !doc.value.labels.length)
)
const canvas = computed(() => {
  const c = doc.value?.canvas
  const ok = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && n > 0
  return { w: ok(c?.w) ? c.w : 1600, h: ok(c?.h) ? c.h : 900 }
})

/* ───────────── design 态 / 时钟 ───────────── */

const root = ref<HTMLElement | null>(null)
const design = ref(false)
const mounted = ref(false)
let pageObserver: MutationObserver | null = null

const now = ref(Date.now())
let timer: ReturnType<typeof setInterval> | null = null
const TICK_MS = 10_000
function stopTimer() {
  if (timer !== null) clearInterval(timer)
  timer = null
}
/** 过期阈值;design 态的值是假值,不判 */
const staleMs = computed(() => (!design.value && props.staleSeconds > 0 ? props.staleSeconds * 1000 : undefined))
const wantTimer = computed(() => mounted.value && !props.disabled && staleMs.value !== undefined)
watch(wantTimer, on => {
  stopTimer()
  if (!on) return
  now.value = Date.now()
  timer = setInterval(() => (now.value = Date.now()), TICK_MS)
})

onMounted(() => {
  const page = root.value?.closest('.sr-page') ?? null
  const read = () => (design.value = !!page?.classList.contains('sr-design'))
  read()
  if (page && typeof MutationObserver !== 'undefined') {
    pageObserver = new MutationObserver(read)
    pageObserver.observe(page, { attributes: true, attributeFilter: ['class'] })
  }
  mounted.value = true // 放在读完 design 之后:design 态一次定时器都不起
})
onBeforeUnmount(() => {
  stopTimer()
  pageObserver?.disconnect()
  pageObserver = null
  endDrag()
})

provide(SLD_CONTEXT_KEY, { values: () => props.values, errors: () => props.errors, now, staleMs })

/* ───────────── 开关三态 → 带电 ───────────── */

interface Stateful {
  id: string
  ref?: SldStateRef
  /** 设备在线灯:离线时开关算「通信异常」 */
  online?: SldOnlineRef
  /** conduct = 'switch':参与带电计算 */
  isSwitch: boolean
}
/** 要取三态的节点:开关,以及有 stateBody 的其他图元(接地刀、状态灯);只依赖 doc */
const stateful = computed<Stateful[]>(() =>
  (doc.value?.nodes ?? []).flatMap(n => {
    const def = lookupSldSymbol(n.symbol)
    const isSwitch = def?.conduct === 'switch'
    return isSwitch || def?.stateBody ? [{ id: n.id, ref: n.state, online: n.online, isSwitch }] : []
  })
)
function resolve(s: Stateful): SldSwitchState {
  // 没配 state:开关视为常合(ADR-005 契约修订);接地刀 / 状态灯按分位画
  if (!s.ref) return s.isSwitch ? 'closed' : 'open'
  // 通信异常(2026-09-23 现场约定):设备在线灯明确是「离线」→ 按没数据处理(灰;配了 fallback 按 fallback)。
  // 在线灯没数据(unknown)不算离线——那只说明没配 / 没收到 active,不能据此把开关抹灰
  if (s.online && resolveOnlineState(asPointValue(props.values[sldPointSlot(s.online.pt)])) === 'offline')
    return s.ref.fallback ?? 'unknown'
  // 不判过期:开关只在变位时上报,值旧是常态
  return resolveSwitchState(s.ref, asPointValue(props.values[sldPointSlot(s.ref.pt)]))
}
const stateSig = computed(() => stateful.value.map(resolve).join(','))
const nodeStates = computed<Record<string, SldSwitchState>>(() => {
  const parts = stateSig.value.split(',') as SldSwitchState[]
  return Object.fromEntries(stateful.value.map((s, i) => [s.id, parts[i] ?? 'unknown']))
})
const switches = computed(() => stateful.value.filter(s => s.isSwitch))
const switchSig = computed(() => switches.value.map(s => nodeStates.value[s.id]).join(','))

const hasSource = computed(() => !!doc.value?.nodes.some(n => n.source))
/** 带电结果;null = 不着色。只依赖 doc 与开关三态(switchSig),数值标签变化不会重算 */
const energy = computed(() => {
  const d = doc.value
  // 图里没有电源点时整张图都会是失电灰,没法看 → 视为关掉,角落给提示
  if (!d || !props.energizeColoring || !hasSource.value) return null
  const parts = switchSig.value.split(',') as SldSwitchState[]
  return energize(d, lookupSldSymbol, Object.fromEntries(switches.value.map((s, i) => [s.id, parts[i] ?? 'unknown'])))
})

/* ───────────── 告警 ───────────── */

/** 「类型|名称」→ 实体 id(来自绑定,发布器已按名解析);告警按 id 匹配、node-click 带 id 都靠它 */
const entityIds = computed(() => entityIdsFromBindings(props.bindings))
const keyById = computed(() => new Map([...entityIds.value].map(([k, id]) => [id, k] as const)))
const alarms = computed(() => alarmLevelsByEntity(flattenAlarms(props.values[SLD_ALARMS_SLOT]), keyById.value))

const hints = computed(() => {
  const out: string[] = []
  if (props.energizeColoring && !hasSource.value) out.push('图中未标电源点,未做带电着色')
  if (props.errors[SLD_ALARMS_SLOT]) out.push('告警数据不可用')
  return out
})

/* ───────────── 平移 / 缩放 / 点击 ───────────── */

interface View {
  x: number
  y: number
  w: number
  h: number
}
const svg = ref<SVGSVGElement | null>(null)
/** null = 适应容器(viewBox = 整张画布);每个实例各有一份,放大层里的那份与原位的互不影响 */
const view = ref<View | null>(null)
const viewBox = computed(() => {
  const v = view.value ?? { x: 0, y: 0, ...canvas.value }
  return `${v.x} ${v.y} ${v.w} ${v.h}`
})
watch(canvas, () => (view.value = null))

const canZoom = computed(() => props.interactive && !design.value)
const MAX_ZOOM = 16
const MIN_ZOOM = 0.5
/** 视口中心不许离开画布,免得把图拖丢 */
function clampView(v: View): View {
  const { w, h } = canvas.value
  const cx = Math.min(Math.max(v.x + v.w / 2, 0), w)
  const cy = Math.min(Math.max(v.y + v.h / 2, 0), h)
  return { x: cx - v.w / 2, y: cy - v.h / 2, w: v.w, h: v.h }
}

function onWheel(e: WheelEvent) {
  if (!canZoom.value || !svg.value) return
  const map = sldCoords.mapper(svg.value)
  if (!map) return
  e.preventDefault()
  const cur = view.value ?? { x: 0, y: 0, ...canvas.value }
  const delta = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY
  const factor = Math.exp(-delta * 0.0015)
  const w = Math.min(Math.max(cur.w / factor, canvas.value.w / MAX_ZOOM), canvas.value.w / MIN_ZOOM)
  const k = cur.w / w
  if (k === 1) return
  // 指针下的那个图上点缩放前后不动
  const p = map(e.clientX, e.clientY)
  view.value = clampView({ x: p.x - (p.x - cur.x) / k, y: p.y - (p.y - cur.y) / k, w, h: cur.h / k })
}

const DRAG_THRESHOLD = 4
interface Press {
  pointerId: number
  clientX: number
  clientY: number
  nodeId?: string
  /** 按下那一刻的换算函数与视口:拖动全程用它(拖的过程中 viewBox 在变,重取会抖) */
  map: SldScreenMapper | null
  start: View
  moved: boolean
}
let press: Press | null = null
const dragging = ref(false)

function onPointerDown(e: PointerEvent) {
  if (design.value || e.button !== 0 || !svg.value) return
  const hit = e.target instanceof Element ? e.target.closest('[data-node-id]') : null
  press = {
    pointerId: e.pointerId,
    clientX: e.clientX,
    clientY: e.clientY,
    nodeId: hit?.getAttribute('data-node-id') ?? undefined,
    map: canZoom.value ? sldCoords.mapper(svg.value) : null,
    start: view.value ?? { x: 0, y: 0, ...canvas.value },
    moved: false,
  }
}
function onPointerMove(e: PointerEvent) {
  if (!press || e.pointerId !== press.pointerId) return
  if (!press.moved) {
    if (Math.hypot(e.clientX - press.clientX, e.clientY - press.clientY) < DRAG_THRESHOLD) return
    press.moved = true // 动过了:松手不算点击(哪怕 interactive 关着、图并没有跟着动)
    if (press.map) {
      dragging.value = true
      try {
        svg.value?.setPointerCapture?.(e.pointerId)
      } catch {
        /* 合成事件 / 指针已释放:不影响拖动 */
      }
    }
  }
  if (!press.map) return
  const a = press.map(press.clientX, press.clientY)
  const b = press.map(e.clientX, e.clientY)
  view.value = clampView({ ...press.start, x: press.start.x - (b.x - a.x), y: press.start.y - (b.y - a.y) })
}
function endDrag() {
  press = null
  dragging.value = false
}
function onPointerUp(e: PointerEvent) {
  if (!press || e.pointerId !== press.pointerId) return
  const { moved, nodeId } = press
  endDrag()
  if (moved || !nodeId) return
  const node = doc.value?.nodes.find(n => n.id === nodeId)
  if (!node) return
  // 图里只存名字(ADR-005 D4);id 从本组件的绑定里按「类型 + 名称」取,取不到就不带
  const id = node.entity ? entityIds.value.get(entityKey(node.entity.type, node.entity.name)) : undefined
  emit('widget-event', {
    name: 'node-click',
    detail: {
      nodeId: node.id,
      ...(node.name ? { name: node.name } : {}),
      ...(node.entity ? { entity: { type: node.entity.type, name: node.entity.name, ...(id ? { id } : {}) } } : {}),
    },
  })
}
function onDblClick() {
  if (canZoom.value) view.value = null
}
</script>

<template>
  <div
    ref="root"
    class="sr-sld"
    :class="{ 'sr-sld-zoomable': canZoom, 'sr-sld-dragging': dragging, 'sr-sld-static': design }"
  >
    <div v-if="empty" class="sr-empty-hint">未绘制接线图</div>
    <template v-else>
      <svg
        ref="svg"
        class="sr-sld-svg"
        :viewBox="viewBox"
        preserveAspectRatio="xMidYMid meet"
        @wheel="onWheel"
        @pointerdown="onPointerDown"
        @pointermove="onPointerMove"
        @pointerup="onPointerUp"
        @pointercancel="endDrag"
        @dblclick="onDblClick"
      >
        <SldScene
          :doc="doc!"
          :node-states="nodeStates"
          :energy="energy"
          :kv-colors="kvColors"
          :alarms="alarms"
          :show-names="showNames"
          :clickable="!design"
          :switch-style="switchStyle"
          :value-style="valueStyle"
        />
      </svg>
      <div v-if="hints.length" class="sr-sld-hints">
        <div v-for="h in hints" :key="h">{{ h }}</div>
      </div>
    </template>
  </div>
</template>

<style>
/* 接线图也是一块面板:此前它没有底、直接浮在页面上,页面有了装饰层之后显得「没放稳」(2026-09-20) */
.sr-sld {
  position: relative;
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  box-sizing: border-box;
  border: 1px solid var(--sr-panel-edge, transparent);
  border-radius: var(--sr-radius, 6px);
  background: linear-gradient(180deg, var(--sr-panel-top, transparent), var(--sr-panel-bot, transparent));
  box-shadow: var(--sr-panel-shadow, none);
  color: var(--sr-accent, #19b7ff);
}
.sr-sld::before {
  content: '';
  position: absolute;
  left: 0;
  right: 0;
  top: 0;
  height: 1px;
  pointer-events: none;
  background: linear-gradient(90deg, transparent 6%, var(--sr-panel-hairline, transparent), transparent 94%);
}
.sr-sld-svg {
  display: block;
  width: 100%;
  height: 100%;
  user-select: none;
  -webkit-user-select: none;
}
.sr-sld-zoomable .sr-sld-svg {
  cursor: grab;
  touch-action: none;
}
.sr-sld-dragging .sr-sld-svg {
  cursor: grabbing;
}
.sr-sld-hints {
  position: absolute;
  left: 8px;
  bottom: 6px;
  font-size: max(var(--sr-min-text, 10px), 11px);
  line-height: 1.5;
  color: var(--sr-ink-2, #8fbce8);
  opacity: 0.85;
  pointer-events: none;
}

/* 分组框 */
.sr-sld-frame rect {
  fill: none;
  stroke: var(--sr-ink-2, #8fbce8);
  stroke-width: 1;
  stroke-dasharray: 4 4;
  opacity: 0.6;
}
.sr-sld-frame text {
  fill: var(--sr-ink-1, #cdeeff);
  stroke: none;
}

/* 母线 / 连线:细线;颜色走 currentColor,由带电着色给 color */
.sr-sld-bus {
  stroke: currentColor;
  stroke-width: 4;
  stroke-linecap: square;
}
.sr-sld-wire {
  fill: none;
  stroke: currentColor;
  stroke-width: 1.5;
  stroke-linejoin: round;
}

/* 带电着色:live 的颜色在元素的 style 里(按电压等级);未知等级不设,继承强调色 */
.sr-sld-e-uncertain {
  opacity: 0.6;
  stroke-dasharray: 5 4;
}
.sr-sld-e-dead {
  color: var(--sr-ink-2, #8fbce8);
  opacity: 0.45;
}
/* 图元上(2026-09-23):变暗 / 变虚落到图形本身,开关的状态色块不跟着变——
   合闸就是红、分闸就是绿,跟上游有没有电无关(现场约定)。母线 / 连线仍按上面两条 */
.sr-sld-node-symbol.sr-sld-e-uncertain,
.sr-sld-node-symbol.sr-sld-e-dead {
  opacity: 1;
  stroke-dasharray: none;
}
.sr-sld-node-symbol.sr-sld-e-uncertain .sr-sld-symbol-body,
.sr-sld-node-symbol.sr-sld-e-uncertain .sr-sld-symbol-state:not(.sr-sld-sw),
.sr-sld-node-symbol.sr-sld-e-uncertain .sr-sld-symbol-text {
  opacity: 0.6;
  stroke-dasharray: 5 4;
}
.sr-sld-node-symbol.sr-sld-e-dead .sr-sld-symbol-body,
.sr-sld-node-symbol.sr-sld-e-dead .sr-sld-symbol-state:not(.sr-sld-sw),
.sr-sld-node-symbol.sr-sld-e-dead .sr-sld-symbol-text {
  opacity: 0.45;
}

/* 数码框(2026-09-23):黑底细边框,七段数码管;没亮的段淡淡垫一层,像真表头。
   颜色可在 .sr-page 或任意祖先上覆盖 --sr-sld-meter-bg / --sr-sld-meter-line / --sr-sld-meter-ink */
.sr-sld-meter-box {
  fill: var(--sr-sld-meter-bg, #01040b);
  stroke: var(--sr-sld-meter-line, rgba(143, 188, 232, 0.4));
  stroke-width: 1;
  stroke-dasharray: none;
}
.sr-sld-meter-ghost,
.sr-sld-meter-digits {
  fill: var(--sr-sld-meter-ink, #f2f8ff);
  stroke: none;
}
.sr-sld-meter-ghost {
  opacity: 0.07;
}
.sr-sld-meter-text {
  fill: var(--sr-sld-meter-ink, #f2f8ff);
  font-family: var(--sr-font-body, sans-serif);
}
.sr-sld-meter.sr-sld-label-empty .sr-sld-meter-digits,
.sr-sld-meter.sr-sld-stale .sr-sld-meter-digits,
.sr-sld-meter.sr-sld-stale .sr-sld-meter-text {
  fill: var(--sr-ink-2, #8fbce8);
  opacity: 0.6;
}
.sr-sld-meter.sr-sld-label-error .sr-sld-meter-digits,
.sr-sld-meter.sr-sld-label-error .sr-sld-meter-text {
  fill: var(--sr-bad, #ff5f7a);
}

/* 文字:深色描边垫底,压在线上也看得清 */
.sr-sld-label,
.sr-sld-node-name,
.sr-sld-bus-name {
  fill: var(--sr-ink-1, #cdeeff);
  stroke: var(--sr-sld-halo, rgba(2, 8, 23, 0.75));
  stroke-width: 3;
  stroke-dasharray: none;
  stroke-linejoin: round;
  paint-order: stroke;
  font-family: var(--sr-font-body, sans-serif);
}
.sr-sld-symbol-text {
  stroke-dasharray: none;
}
.sr-sld-label-num {
  fill: var(--sr-ink-0, #ecf9ff);
  font-family: var(--sr-font-num, sans-serif);
  font-variant-numeric: tabular-nums;
}
.sr-sld-label-empty .sr-sld-label-num,
.sr-sld-stale .sr-sld-label-num {
  fill: var(--sr-ink-2, #8fbce8);
  opacity: 0.6;
}
.sr-sld-label-error .sr-sld-label-num {
  fill: var(--sr-bad, #ff5f7a);
}
.sr-sld-node-name {
  fill: var(--sr-ink-1, #cdeeff);
}
.sr-sld-bus-name {
  fill: var(--sr-ink-2, #8fbce8);
}

/* 可点击节点:透明命中区(图元是细线,不垫一块很难点中),hover 提亮 */
.sr-sld-hit {
  fill: var(--sr-accent, #19b7ff);
  fill-opacity: 0;
  stroke: none;
  pointer-events: all;
}
.sr-sld-node-clickable {
  cursor: pointer;
}
.sr-sld-node-clickable:hover .sr-sld-hit {
  fill-opacity: 0.16;
}
.sr-sld-node-clickable:hover .sr-sld-node-name {
  fill: var(--sr-ink-0, #ecf9ff);
}

/* 告警闪烁:光圈闪,图元本身保持带电着色;最高严重级别决定颜色 */
.sr-sld-alarm-halo {
  fill: currentColor;
  fill-opacity: 0.18;
  stroke: currentColor;
  stroke-width: 1.5;
  pointer-events: none;
  animation: sr-sld-blink 1.2s ease-in-out infinite;
}
.sr-sld-alarm-bad > .sr-sld-alarm-halo {
  color: var(--sr-bad, #ff5f7a);
}
.sr-sld-alarm-warn > .sr-sld-alarm-halo {
  color: var(--sr-warn, #ffd166);
}
/* 在线灯:在线绿点、光晕呼吸;离线红点常亮(光晕不动);未知灰点。呼吸用 transform + opacity,不触发布局 */
.sr-sld-online {
  pointer-events: none;
}
.sr-sld-online-core {
  fill: currentColor;
  stroke: var(--sr-sld-halo, rgba(2, 8, 23, 0.75));
  stroke-width: 1;
}
.sr-sld-online-halo {
  fill: currentColor;
  stroke: none;
  opacity: 0.28;
  transform-box: fill-box;
  transform-origin: center;
}
.sr-sld-online-online {
  color: var(--sr-ok, #2ff0bb);
}
.sr-sld-online-online .sr-sld-online-halo {
  animation: sr-sld-breathe 2.4s ease-in-out infinite;
}
.sr-sld-online-offline {
  color: var(--sr-bad, #ff5f7a);
}
.sr-sld-online-unknown {
  color: var(--sr-ink-2, #8fbce8);
}
.sr-sld-online-unknown .sr-sld-online-halo {
  opacity: 0;
}
.sr-sld-status-online .sr-sld-status-word {
  fill: var(--sr-ok, #2ff0bb);
}
.sr-sld-status-offline .sr-sld-status-word {
  fill: var(--sr-bad, #ff5f7a);
}
.sr-sld-status-unknown .sr-sld-status-word {
  fill: var(--sr-ink-2, #8fbce8);
}
@keyframes sr-sld-breathe {
  0%,
  100% {
    opacity: 0.12;
    transform: scale(0.6);
  }
  50% {
    opacity: 0.42;
    transform: scale(1);
  }
}
@keyframes sr-sld-blink {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.12;
  }
}
@media (prefers-reduced-motion: reduce) {
  .sr-sld-alarm-halo,
  .sr-sld-online-online .sr-sld-online-halo {
    animation: none;
  }
}
</style>
