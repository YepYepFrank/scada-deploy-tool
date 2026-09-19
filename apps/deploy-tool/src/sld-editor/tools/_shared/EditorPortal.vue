<script setup lang="ts">
/**
 * 工具的浮层(对话框 / 下拉菜单 / 底图浮层)经 `layers` 扩展点挂进编辑器,但图层 `.sld-ed-layer` 带 CSS transform
 * 且 pointer-events: none——浮层不能留在里面。这里用一个隐藏的探针找到所在的编辑器根 `.sld-ed`,
 * 把内容 Teleport 过去:仍在同一个 Vue app 里(inject 照常)、继承 --ed-* / --sld-* 变量、fixed 定位不受 transform 影响。
 */
import { onMounted, ref } from 'vue'

const probe = ref<HTMLElement>()
const target = ref<HTMLElement | null>(null)
onMounted(() => {
  target.value = (probe.value?.closest('.sld-ed') as HTMLElement | null) ?? document.body
})
</script>

<template>
  <span ref="probe" hidden />
  <Teleport v-if="target" :to="target">
    <slot />
  </Teleport>
</template>
