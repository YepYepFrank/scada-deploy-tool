<script setup lang="ts">
/**
 * 给非 SVG 容器用的图元盒子:外层 <svg>(viewBox = 旋转后的包围盒,宽高撑满父元素、等比居中),里面放 <SldSymbol>。
 * 部署工具里的 X6 Vue 节点、图元面板缩略图用它;颜色照旧继承父元素的 color。
 * overflow: visible 是为了压在包围盒边上的 2px 线宽不被裁掉一半。
 * (模板里 <svg> 前面不要放注释:开发态注释也算一个根节点,组件就成了多根,class / style 透传会失效。)
 */
import { computed } from 'vue'
import type { SldRotation, SldSwitchState } from './model/types'
import { symbolBoxSize } from './model/geometry'
import { getSldSymbol } from './symbols/registry'
import { unknownSldSymbol } from './symbols/placeholder'
import SldSymbol from './SldSymbol.vue'

const props = withDefaults(
  defineProps<{
    symbol: string
    state?: SldSwitchState
    rot?: SldRotation
    flip?: boolean
  }>(),
  { state: 'open', rot: 0, flip: false }
)

const viewBox = computed(() => {
  const def = getSldSymbol(props.symbol)
  // 未知图元的占位框不旋转(与 <SldSymbol> 一致)
  const { w, h } = def ? symbolBoxSize(def, props.rot) : unknownSldSymbol
  return `0 0 ${w} ${h}`
})
</script>

<template>
  <svg
    class="sr-sld-symbol-box"
    :viewBox="viewBox"
    width="100%"
    height="100%"
    preserveAspectRatio="xMidYMid meet"
    style="display: block; overflow: visible"
  >
    <SldSymbol :symbol="symbol" :state="state" :rot="rot" :flip="flip" />
  </svg>
</template>
