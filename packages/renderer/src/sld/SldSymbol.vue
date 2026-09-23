<script setup lang="ts">
/**
 * 单个图元(ADR-005 D8:运行时 `sld` 组件与部署工具的 X6 节点共用,所见即所得)。
 * 渲染的是 <g>,不是 <svg>——放哪、多大由外层决定;非 SVG 容器里用 <SldSymbolBox>。
 * 镜像 / 旋转与 model/geometry 同一套规则(symbolTransform):旋转后包围盒左上角仍在局部原点,
 * 所以外层只要 translate(node.x, node.y),端口就和 portPosition 算出来的对得上。
 * 不处理颜色:片段只用 currentColor,由外层的 color 决定(带电 / 电压等级 / 告警着色在运行时组件里做)。
 * v-html 的片段来自图元注册表(代码里的常量),不是用户输入。模板根不是 <svg>,eslint-plugin-vue 认不出 <g> 是
 * SVG 元素、当成了组件,vue/no-v-text-v-html-on-component 在这里是误报,模板里就地关掉。
 */
import { computed } from 'vue'
import type { SldRotation, SldSwitchState, SldSwitchStyle } from './model/types'
import { isFreeSizeSymbol, symbolPoint, symbolTransform } from './model/geometry'
import { getSldSymbol } from './symbols/registry'
import { unknownSldSymbol } from './symbols/placeholder'
import { block } from './symbols/svg'

/** 状态色(2026-09-23):合闸红 / 分闸绿 / 通信异常灰;宿主可在祖先上覆盖这三个变量 */
const SWITCH_COLOR: Record<SldSwitchState, string> = {
  closed: 'var(--sr-sld-sw-closed, #ff3b3b)',
  open: 'var(--sr-sld-sw-open, #22c55e)',
  unknown: 'var(--sr-sld-sw-unknown, #8a94a6)',
}

const props = withDefaults(
  defineProps<{
    /** 图元 id(图元注册表里查;查不到画占位框) */
    symbol: string
    /** 开关状态;只对带 stateBody 的图元有意义。缺省按分位画(国标图形符号的画法,图元面板缩略图用) */
    state?: SldSwitchState
    rot?: SldRotation
    flip?: boolean
    /** 放大倍数(SldNode.scale):以旋转后包围盒左上角为原点整体等比放大,线宽与图元文字一起放大 */
    scale?: number
    /**
     * 自由宽高(SldNode.size,2026-09-22):只对 `freeBody` 图元(设备框)有效,给了就以它为准、忽略 scale。
     * 图形按这个宽高**重画**而不是拉伸,所以线宽不会被拉扁;端口 / 图元文字的位置仍按比例走。
     */
    size?: { w: number; h: number }
    /** 设备框线宽 / 虚线(SldNode.lineWidth / dashed,2026-09-23):只对 freeBody 图元有效 */
    lineWidth?: number
    dashed?: boolean
    /**
     * 开关画法(2026-09-23)。缺省 classic(图元面板、总览页按国标图形认图元);
     * 运行时组件与编辑器画布传 state:合闸红 / 分闸绿 / 通信异常灰。
     */
    switchStyle?: SldSwitchStyle
  }>(),
  {
    state: 'open',
    rot: 0,
    flip: false,
    scale: 1,
    size: undefined,
    lineWidth: undefined,
    dashed: false,
    switchStyle: 'classic',
  }
)

const def = computed(() => getSldSymbol(props.symbol))
const shown = computed(() => def.value ?? unknownSldSymbol)
/**
 * 自由宽高只对 freeBody 图元生效;其余一律等比。设备框只改了线宽 / 虚线、没改宽高时也走重画
 * (按倍数算出的宽高),这样线宽不会被 scale 一起放大。
 */
const free = computed(() => {
  const d = def.value
  if (!d || !isFreeSizeSymbol(d)) return undefined
  if (props.size) return props.size
  if (props.lineWidth || props.dashed) return { w: d.w * props.scale, h: d.h * props.scale }
  return undefined
})
const k = computed(() => {
  const d = def.value
  const f = free.value
  if (!d) return { x: 1, y: 1 }
  return f ? { x: f.w / d.w, y: f.h / d.h } : { x: props.scale, y: props.scale }
})
/** 自由宽高:按实际尺寸重画(线宽不被拉扁);其余图元照旧用固定片段 + scale 变换 */
/** 状态色模式:开关才生效(有 stateBody 的非开关图元——接地刀、状态灯——也按状态上色) */
const stateMode = computed(() => props.switchStyle === 'state' && !!def.value?.stateBody)
const blockMode = computed(() => stateMode.value && !!def.value?.stateBlock)
const body = computed(() => {
  if (free.value)
    return def.value!.freeBody!(free.value.w, free.value.h, { width: props.lineWidth, dashed: props.dashed })
  if (blockMode.value) return def.value!.stateBlock!.body
  return shown.value.body
})
const stateHtml = computed(() => {
  const b = blockMode.value ? def.value!.stateBlock! : undefined
  // 断路器类:三态都是实心方块,只靠颜色分(现场约定);刀闸类:保留原来的动触头形状
  if (b) return block(b.x, b.y, b.w, b.h)
  return def.value?.stateBody?.[props.state] ?? ''
})
const stateStyle = computed(() => (stateMode.value ? { color: SWITCH_COLOR[props.state] } : undefined))
// 图元文字:位置跟着缩放 / 镜像 / 旋转,字形保持正向(不进 transform 的 <g>);字号按较小的一边缩放
const texts = computed(() =>
  (def.value?.texts ?? []).map(t => ({
    ...symbolPoint(def.value!, props.rot, props.flip, t.x, t.y, k.value.x, k.value.y),
    text: t.text,
    size: (t.size ?? 12) * Math.min(k.value.x, k.value.y),
  }))
)
// 占位框不跟着转:「?」保持正着
const transform = computed(() =>
  def.value ? symbolTransform(def.value, props.rot, props.flip, k.value.x, k.value.y, !free.value) : undefined
)
</script>

<template>
  <g
    class="sr-sld-symbol"
    :class="{ 'sr-sld-symbol-unknown': !def }"
    :data-symbol="symbol"
    :data-state="def?.stateBody ? state : undefined"
  >
    <!-- eslint-disable vue/no-v-text-v-html-on-component -->
    <g class="sr-sld-symbol-shape" :transform="transform">
      <g class="sr-sld-symbol-body" v-html="body" />
      <g
        v-if="stateHtml"
        class="sr-sld-symbol-state"
        :class="stateMode ? ['sr-sld-sw', `sr-sld-sw-${state}`] : undefined"
        :style="stateStyle"
        v-html="stateHtml"
      />
    </g>
    <text
      v-for="(t, i) in texts"
      :key="i"
      class="sr-sld-symbol-text"
      :x="t.x"
      :y="t.y"
      :font-size="t.size"
      text-anchor="middle"
      dominant-baseline="central"
      fill="currentColor"
      stroke="none"
    >
      {{ t.text }}
    </text>
  </g>
</template>
