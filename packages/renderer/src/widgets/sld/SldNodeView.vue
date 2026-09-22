<script setup lang="ts">
/**
 * 一个节点:图元 + 名称 + 告警光圈 + 点击命中区。props 除 node 外全是原始值,
 * 所以别的节点变位 / 别的测点跳数都不会让它重画(Vue 按 props 浅比较跳过)。
 * 颜色:给 <g> 设 color,图元片段只用 currentColor(ADR-005 约定 3)。
 */
import { computed } from 'vue'
import {
  SldSymbol,
  getSldSymbol,
  isFreeSizeSymbol,
  nodeBoxSize,
  nodeScale,
  portDirection,
  type SldNode,
  type SldSwitchState,
} from '../../sld'
import SldOnlineDot from './SldOnlineDot.vue'
import type { SldAlarmLevel } from './format'

const props = withDefaults(
  defineProps<{
    node: SldNode
    state?: SldSwitchState
    /** 带电着色的颜色;不给 = 继承(主题强调色,或失电灰由 energyClass 的样式给) */
    color?: string
    /** '' / sr-sld-e-live / sr-sld-e-uncertain / sr-sld-e-dead */
    energyClass?: string
    alarm?: SldAlarmLevel | ''
    showName?: boolean
    clickable?: boolean
  }>(),
  { state: 'closed', color: undefined, energyClass: '', alarm: '', showName: true, clickable: false }
)

const def = computed(() => getSldSymbol(props.node.symbol))
const scale = computed(() => nodeScale(props.node))
/** 自由宽高(设备框)才透传 size,其余图元走 scale */
const freeSize = computed(() => (isFreeSizeSymbol(def.value) ? props.node.size : undefined))
/** 旋转 + 放大 / 自由宽高之后的包围盒尺寸;未知图元画 40×40 占位框 */
const box = computed(() => (def.value ? nodeBoxSize(props.node, def.value) : { w: 40, h: 40 }))
/**
 * 图元描边色(2026-09-22):节点自己设了 color 就以它为准,盖过电压等级色。
 * **失电时颜色仍在,只是跟着 .sr-sld-e-dead 一起变暗**(opacity 0.45)——不像母线那样整根变灰:
 * 设备框、互感器这些器件多半根本不在带电回路里(conduct: 'none' 恒判失电),真按失电抹掉颜色就等于不让改。
 * 母线是导体,「失电 = 灰」是安全信号,那边的规矩不变(见 SldBusView)。
 */
const paint = computed(() => props.node.color ?? props.color)
/** 在线灯挂在包围盒的哪个角(缺省右上),往外让出一点,不压图元的线 */
const onlineAt = computed(() => {
  const at = props.node.online?.at ?? 'tr'
  const { w, h } = box.value
  return { x: at === 'tl' || at === 'bl' ? -3 : w + 3, y: at === 'tl' || at === 'tr' ? -3 : h + 3 }
})

/**
 * 名称落点:默认图元下方居中;下方有端口出线(名字会压在线上)时依次改放右 / 左 / 上,四面都有线还是放下方。
 * 文字不随图元旋转。
 */
const namePos = computed(() => {
  const { w, h } = box.value
  const taken = new Set(
    def.value ? def.value.ports.map(p => portDirection(props.node, def.value!, p.id)).filter(Boolean) : []
  )
  if (!taken.has('s') || taken.size === 4) return { x: w / 2, y: h + 10, anchor: 'middle' }
  if (!taken.has('e')) return { x: w + 6, y: h / 2, anchor: 'start' }
  if (!taken.has('w')) return { x: -6, y: h / 2, anchor: 'end' }
  return { x: w / 2, y: -10, anchor: 'middle' }
})
</script>

<template>
  <g
    class="sr-sld-node"
    :class="[alarm ? `sr-sld-alarm sr-sld-alarm-${alarm}` : '', { 'sr-sld-node-clickable': clickable }]"
    :data-id="node.id"
    :data-node-id="clickable ? node.id : undefined"
    :transform="`translate(${node.x} ${node.y})`"
  >
    <rect v-if="alarm" class="sr-sld-alarm-halo" :x="-6" :y="-6" :width="box.w + 12" :height="box.h + 12" rx="4" />
    <rect v-if="clickable" class="sr-sld-hit" :x="-2" :y="-2" :width="box.w + 4" :height="box.h + 4" rx="3" />
    <!-- 带电着色只作用在图元上:名称不跟着变灰 / 变虚 -->
    <g class="sr-sld-node-symbol" :class="energyClass" :style="paint ? { color: paint } : undefined">
      <SldSymbol
        :symbol="node.symbol"
        :state="state"
        :rot="node.rot"
        :flip="node.flip"
        :scale="scale"
        :size="freeSize"
      />
    </g>
    <!-- 在线灯不吃带电着色:设备离线和线路失电是两回事 -->
    <SldOnlineDot v-if="node.online" :pt="node.online.pt" :x="onlineAt.x" :y="onlineAt.y" />
    <text
      v-if="showName && node.name"
      class="sr-sld-node-name"
      :x="namePos.x"
      :y="namePos.y"
      :text-anchor="namePos.anchor"
      dominant-baseline="middle"
      font-size="11"
    >
      {{ node.name }}
    </text>
  </g>
</template>
