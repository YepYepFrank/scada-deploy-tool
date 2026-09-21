<script setup lang="ts">
/**
 * 图的内容层:分组框 < 母线 / 连线 < 图元 < 标签。模板根是 <g>,由外壳放进 <svg>。
 * 与外壳分开是为了**平移 / 缩放(只改外壳的 viewBox)不碰这里**;这里只在图本身、开关状态、带电结果、告警变化时重渲染,
 * 而且节点 / 标签是小组件、props 是原始值,重渲染也只是逐个浅比较后跳过。
 * 几何(连线折线)只依赖 doc:每条连线调一次 wirePoints,值变化不重算。
 */
import { computed } from 'vue'
import {
  lookupSldSymbol,
  wirePoints,
  type SldBus,
  type SldDoc,
  type SldEnergizeResult,
  type SldEnergy,
  type SldSwitchState,
} from '../../sld'
import { entityKey, kvColor, type SldAlarmLevel, type SldKvColor } from './format'
import SldNodeView from './SldNodeView.vue'
import SldLabelView from './SldLabelView.vue'

const props = defineProps<{
  doc: SldDoc
  /** 有 stateBody / 是开关的节点的三态;不在表里的节点不传 state(<SldSymbol> 对没有 stateBody 的图元不看它) */
  nodeStates: Record<string, SldSwitchState>
  /** 带电计算结果;null = 不着色(关了,或图里没有电源点)→ 全部用主题强调色 */
  energy: SldEnergizeResult | null
  kvColors: readonly SldKvColor[]
  /** 「实体类型 + 名称」→ 告警级别 */
  alarms: Map<string, SldAlarmLevel>
  showNames: boolean
  clickable: boolean
}>()

const wirePaths = computed(() =>
  props.doc.wires.flatMap(w => {
    const pts = wirePoints(props.doc, w, lookupSldSymbol)
    return pts && pts.length > 1 ? [{ id: w.id, d: pts.map(p => `${p.x},${p.y}`).join(' ') }] : []
  })
)

interface Paint {
  cls: string
  color?: string
}
const NO_PAINT: Paint = { cls: '' }
function paintOf(e: SldEnergy | undefined): Paint {
  if (!props.energy) return NO_PAINT
  if (e?.live) return { cls: 'sr-sld-e-live', color: kvColor(e.kv, props.kvColors) }
  // 不确定:与带电同色,样式上变虚 / 半透明(宁可提示不确定,不可把没数据画成带电,ADR-005 D11)
  if (e?.uncertain) return { cls: 'sr-sld-e-uncertain', color: kvColor(e.kv, props.kvColors) }
  return { cls: 'sr-sld-e-dead' }
}
const paintMap = (m: Record<string, SldEnergy> | undefined): Record<string, Paint> =>
  Object.fromEntries(Object.entries(m ?? {}).map(([id, e]) => [id, paintOf(e)]))
/** 没有端口的图元(状态灯这类非电气图形)不在拓扑里,不参与带电着色:否则永远是「失电灰」 */
const unwired = computed(
  () => new Set(props.doc.nodes.filter(n => lookupSldSymbol(n.symbol)?.ports.length === 0).map(n => n.id))
)
const nodePaint = computed(() => {
  const out = paintMap(props.energy?.nodes)
  for (const id of unwired.value) delete out[id]
  return out
})
const busPaint = computed(() => paintMap(props.energy?.buses))
const wirePaint = computed(() => paintMap(props.energy?.wires))

/** 节点的告警级别:按节点实体的「类型 + 名称」匹配告警的 originator */
const nodeAlarm = computed(() => {
  const out: Record<string, SldAlarmLevel> = {}
  if (!props.alarms.size) return out
  for (const n of props.doc.nodes) {
    const level = n.entity?.name ? props.alarms.get(entityKey(n.entity.type, n.entity.name)) : undefined
    if (level) out[n.id] = level
  }
  return out
})

/**
 * 母线的内联样式:自定义线宽;自定义颜色盖过电压等级色——但失电照样变灰(不然带电着色就白做了),
 * 所以失电(sr-sld-e-dead)时不写 color,让样式表里的灰接管。
 */
function busStyle(b: SldBus): Record<string, string> | undefined {
  const paint = busPaint.value[b.id]
  const color = paint?.cls === 'sr-sld-e-dead' ? undefined : (b.color ?? paint?.color)
  const out: Record<string, string> = {}
  if (color) out.color = color
  if (b.width && b.width > 0) out.strokeWidth = String(b.width)
  return Object.keys(out).length ? out : undefined
}

const horizontal = (b: { x1: number; y1: number; x2: number; y2: number }): boolean =>
  Math.abs(b.x2 - b.x1) >= Math.abs(b.y2 - b.y1)
</script>

<template>
  <g class="sr-sld-scene">
    <g class="sr-sld-layer-frames">
      <g v-for="f in doc.frames ?? []" :key="f.id" class="sr-sld-frame" :data-id="f.id">
        <rect :x="f.x" :y="f.y" :width="f.w" :height="f.h" />
        <text v-if="f.title" :x="f.x + 8" :y="f.y + 14" font-size="12" dominant-baseline="middle">{{ f.title }}</text>
      </g>
    </g>
    <g class="sr-sld-layer-lines">
      <line
        v-for="b in doc.buses"
        :key="b.id"
        class="sr-sld-bus"
        :class="busPaint[b.id]?.cls"
        :style="busStyle(b)"
        :data-id="b.id"
        :x1="b.x1"
        :y1="b.y1"
        :x2="b.x2"
        :y2="b.y2"
      />
      <polyline
        v-for="w in wirePaths"
        :key="w.id"
        class="sr-sld-wire"
        :class="wirePaint[w.id]?.cls"
        :style="wirePaint[w.id]?.color ? { color: wirePaint[w.id]!.color } : undefined"
        :data-id="w.id"
        :points="w.d"
      />
      <template v-if="showNames">
        <template v-for="b in doc.buses" :key="b.id">
          <text
            v-if="b.name"
            class="sr-sld-bus-name"
            :x="horizontal(b) ? b.x1 : b.x1 + 6 + (b.width ?? 4) / 2"
            :y="horizontal(b) ? b.y1 - 10 - (b.width ?? 4) / 2 : b.y1 - 8"
            font-size="12"
            dominant-baseline="middle"
          >
            {{ b.name }}
          </text>
        </template>
      </template>
    </g>
    <g class="sr-sld-layer-nodes">
      <SldNodeView
        v-for="n in doc.nodes"
        :key="n.id"
        :node="n"
        :state="nodeStates[n.id]"
        :color="nodePaint[n.id]?.color"
        :energy-class="nodePaint[n.id]?.cls ?? ''"
        :alarm="nodeAlarm[n.id] ?? ''"
        :show-name="showNames"
        :clickable="clickable && !!(n.entity || n.name)"
      />
    </g>
    <g class="sr-sld-layer-labels">
      <SldLabelView v-for="l in doc.labels" :key="l.id" :label="l" />
    </g>
  </g>
</template>
