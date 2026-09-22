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
import type { SldRotation, SldSwitchState } from './model/types'
import { isFreeSizeSymbol, symbolPoint, symbolTransform } from './model/geometry'
import { getSldSymbol } from './symbols/registry'
import { unknownSldSymbol } from './symbols/placeholder'

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
  }>(),
  { state: 'open', rot: 0, flip: false, scale: 1, size: undefined }
)

const def = computed(() => getSldSymbol(props.symbol))
const shown = computed(() => def.value ?? unknownSldSymbol)
/** 自由宽高只对 freeBody 图元生效;其余一律等比 */
const free = computed(() => (isFreeSizeSymbol(def.value) && props.size ? props.size : undefined))
const k = computed(() => {
  const d = def.value
  const f = free.value
  if (!d) return { x: 1, y: 1 }
  return f ? { x: f.w / d.w, y: f.h / d.h } : { x: props.scale, y: props.scale }
})
/** 自由宽高:按实际尺寸重画(线宽不被拉扁);其余图元照旧用固定片段 + scale 变换 */
const body = computed(() => (free.value ? def.value!.freeBody!(free.value.w, free.value.h) : shown.value.body))
const stateHtml = computed(() => def.value?.stateBody?.[props.state] ?? '')
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
      <g v-if="stateHtml" class="sr-sld-symbol-state" v-html="stateHtml" />
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
