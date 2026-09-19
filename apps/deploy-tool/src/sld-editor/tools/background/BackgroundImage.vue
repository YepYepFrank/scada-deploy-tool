<script setup lang="ts">
/** 画布下层(layers z = 'under'):骨架已让图层与画布同步缩放平移,这里按画布坐标摆图即可 */
import { computed, inject } from 'vue'
import { SLD_EDITOR_CTX } from '../../ext'
import { bgState } from './state'

const ctx = inject(SLD_EDITOR_CTX)
if (!ctx) throw new Error('BackgroundImage 必须放在 <SldEditor> 里')
const state = bgState(ctx)

const bg = computed(() => ctx.content.value.doc.background)
const style = computed(() => {
  const b = bg.value
  if (!b) return {}
  return {
    left: `${b.x ?? 0}px`,
    top: `${b.y ?? 0}px`,
    width: `${b.w ?? ctx.content.value.doc.canvas.w}px`,
    height: b.h !== undefined ? `${b.h}px` : 'auto',
    opacity: String(b.opacity),
  }
})
</script>

<template>
  <img v-if="bg && state.visible" class="sld-bg-img" :src="bg.src" :style="style" alt="" draggable="false" />
</template>

<style>
.sld-bg-img {
  position: absolute;
  max-width: none;
  pointer-events: none;
  user-select: none;
}
</style>
