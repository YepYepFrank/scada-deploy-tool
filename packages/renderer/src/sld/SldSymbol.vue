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
import { symbolPoint, symbolTransform } from './model/geometry'
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
  }>(),
  { state: 'open', rot: 0, flip: false }
)

const def = computed(() => getSldSymbol(props.symbol))
const shown = computed(() => def.value ?? unknownSldSymbol)
const stateHtml = computed(() => def.value?.stateBody?.[props.state] ?? '')
// 图元文字:位置跟着镜像 / 旋转,字形保持正向(不进 transform 的 <g>)
const texts = computed(() =>
  (def.value?.texts ?? []).map(t => ({
    ...symbolPoint(def.value!, props.rot, props.flip, t.x, t.y),
    text: t.text,
    size: t.size ?? 12,
  }))
)
// 占位框不跟着转:「?」保持正着
const transform = computed(() => (def.value ? symbolTransform(def.value, props.rot, props.flip) : undefined))
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
      <g class="sr-sld-symbol-body" v-html="shown.body" />
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
