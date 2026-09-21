<script setup lang="ts">
/**
 * X6 Vue 组件节点:里面就是渲染器的 <SldSymbolBox>(ADR-005 D8,所见即所得)。
 * X6 节点不带 angle——节点的宽高已经是旋转后的包围盒,旋转 / 镜像交给 <SldSymbolBox :rot :flip> 自己画。
 * x6-vue-shape 通过 provide 注入 getNode;cell data 不是响应式的,监听 change:data 拷进 ref 驱动重绘。
 */
import { computed, inject, onBeforeUnmount, shallowRef } from 'vue'
import type { Node } from '@antv/x6'
import { SldSymbolBox, type SldNode } from '@grid/scada-renderer'

// x6-vue-shape 还会把 node / graph 当 props 传进来;这里用 inject,别让它们作为 attribute 落到 DOM 上
defineOptions({ inheritAttrs: false })

const getNode = inject<() => Node>('getNode')
if (!getNode) throw new Error('SldNodeView 必须作为 x6-vue-shape 节点使用')
const cell = getNode()

const read = (): SldNode | undefined => (cell.getData() as { node?: SldNode } | undefined)?.node
const node = shallowRef(read())
const onData = (): void => {
  node.value = read()
}
cell.on('change:data', onData)
onBeforeUnmount(() => cell.off('change:data', onData))

const title = computed(() => {
  const n = node.value
  if (!n) return ''
  return [n.name, n.entity?.name].filter(Boolean).join(' · ') || n.id
})
</script>

<template>
  <div v-if="node" class="sld-node-view" :class="{ 'sld-node-source': !!node.source }" :title="title">
    <SldSymbolBox :symbol="node.symbol" :rot="node.rot" :flip="!!node.flip" />
    <!-- 在线状态灯的占位(编辑器里没有实时值,按「在线」画;位置与运行时一致) -->
    <i v-if="node.online" class="sld-node-online" :data-at="node.online.at ?? 'tr'" />
  </div>
</template>

<style>
.sld-node-view {
  position: relative;
  width: 100%;
  height: 100%;
}
.sld-node-online {
  position: absolute;
  width: 8px;
  height: 8px;
  margin: -4px;
  border-radius: 50%;
  background: #2ff0bb;
  box-shadow: 0 0 0 3px rgba(47, 240, 187, 0.25);
  pointer-events: none;
}
.sld-node-online[data-at='tr'] {
  right: -3px;
  top: -3px;
}
.sld-node-online[data-at='tl'] {
  left: -3px;
  top: -3px;
}
.sld-node-online[data-at='br'] {
  right: -3px;
  bottom: -3px;
}
.sld-node-online[data-at='bl'] {
  left: -3px;
  bottom: -3px;
}
</style>
