<script setup lang="ts">
/**
 * 一次接线图运行时组件(ADR-005 D7:纯 Vue + SVG,零新依赖)。
 * T5.0 骨架:把图静态画出来(母线、连线、图元、文字 / 数值标签),开关按测点值取分合;
 * 带电着色、过期变灰、告警闪烁、平移缩放、node-click 由 T5.3 在此基础上加。
 */
import { computed } from 'vue'
import {
  isSldDoc,
  lookupSldSymbol,
  resolveSwitchState,
  sldPointSlot,
  wirePoints,
  SldSymbol,
  type SldDoc,
  type SldLabel,
  type SldPointValue,
  type SldSwitchState,
} from '../../sld'

const props = withDefaults(
  defineProps<{
    doc?: SldDoc
    staleSeconds?: number
    values?: Record<string, unknown>
    errors?: Record<string, string>
    disabled?: boolean
  }>(),
  { doc: undefined, staleSeconds: 600, values: () => ({}), errors: () => ({}), disabled: false }
)

const doc = computed(() => (isSldDoc(props.doc) ? props.doc : undefined))
const empty = computed(() => !doc.value || (!doc.value.nodes.length && !doc.value.buses.length))

const pointOf = (pt: string): SldPointValue | undefined => {
  const v = props.values[sldPointSlot(pt)]
  return v && typeof v === 'object' && 'ts' in v ? (v as SldPointValue) : undefined
}
const stateOf = (nodeId: string): SldSwitchState => {
  const n = doc.value?.nodes.find(x => x.id === nodeId)
  if (!n?.state) return 'closed'
  const staleMs = props.staleSeconds > 0 ? props.staleSeconds * 1000 : undefined
  return resolveSwitchState(n.state, pointOf(n.state.pt), { staleMs })
}
const wirePaths = computed(() =>
  (doc.value?.wires ?? []).flatMap(w => {
    const pts = wirePoints(doc.value!, w, lookupSldSymbol)
    return pts && pts.length > 1 ? [{ id: w.id, d: pts.map(p => `${p.x},${p.y}`).join(' ') }] : []
  })
)
function labelText(l: SldLabel): string {
  if (l.kind === 'text') return l.text
  const p = pointOf(l.pt)
  const raw = p?.v
  let body = '--'
  if (typeof raw === 'number' && Number.isFinite(raw))
    body = (raw * (l.format?.scale ?? 1)).toFixed(l.format?.digits ?? 1)
  else if (raw !== null && raw !== undefined && typeof raw !== 'object') body = String(raw)
  return `${l.title ? l.title + ' ' : ''}${body}${l.format?.unit ? ' ' + l.format.unit : ''}`
}
</script>

<template>
  <div class="sr-sld">
    <div v-if="empty" class="sr-empty-hint">未绘制接线图</div>
    <svg
      v-else
      class="sr-sld-svg"
      :viewBox="`0 0 ${doc!.canvas.w} ${doc!.canvas.h}`"
      preserveAspectRatio="xMidYMid meet"
    >
      <line
        v-for="b in doc!.buses"
        :key="b.id"
        class="sr-sld-bus"
        :data-id="b.id"
        :x1="b.x1"
        :y1="b.y1"
        :x2="b.x2"
        :y2="b.y2"
      />
      <polyline v-for="w in wirePaths" :key="w.id" class="sr-sld-wire" :data-id="w.id" :points="w.d" />
      <g
        v-for="n in doc!.nodes"
        :key="n.id"
        class="sr-sld-node"
        :data-id="n.id"
        :transform="`translate(${n.x} ${n.y})`"
      >
        <SldSymbol :symbol="n.symbol" :state="stateOf(n.id)" :rot="n.rot" :flip="n.flip" />
      </g>
      <text
        v-for="l in doc!.labels"
        :key="l.id"
        class="sr-sld-label"
        :class="`sr-sld-label-${l.kind}`"
        :data-id="l.id"
        :x="l.x"
        :y="l.y"
        :font-size="l.size ?? 12"
        dominant-baseline="middle"
      >
        {{ labelText(l) }}
      </text>
    </svg>
  </div>
</template>

<style>
.sr-sld {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--sr-accent, #19b7ff);
}
.sr-sld-svg {
  width: 100%;
  height: 100%;
}
.sr-sld-bus {
  stroke: currentColor;
  stroke-width: 6;
  stroke-linecap: square;
}
.sr-sld-wire {
  fill: none;
  stroke: currentColor;
  stroke-width: 2;
}
.sr-sld-label {
  fill: var(--sr-ink-1, #c9d8ee);
  stroke: none;
}
.sr-sld-label-value {
  fill: var(--sr-ink-0, #ecf9ff);
  font-variant-numeric: tabular-nums;
}
</style>
