<script setup lang="ts">
/** 模板选择:卡片列表,缩略图由槽位布局自动绘制(TemplateDefinition.thumbnail 可覆盖)。 */
import type { TemplateDefinition } from '@grid/scada-renderer'
import { aspectRatio, slotRects } from './template-geometry'

defineProps<{
  templates: TemplateDefinition[]
  modelValue: string
}>()
const emit = defineEmits<{ 'update:modelValue': [id: string] }>()

const VB_W = 160
const vbH = (t: TemplateDefinition) => Math.round(VB_W / aspectRatio(t))
</script>

<template>
  <div class="tp">
    <button
      v-for="t in templates"
      :key="t.id"
      type="button"
      class="tp-card"
      :class="{ active: t.id === modelValue }"
      :data-template="t.id"
      @click="emit('update:modelValue', t.id)"
    >
      <img v-if="t.thumbnail" :src="t.thumbnail" :alt="t.name" class="tp-thumb" />
      <svg v-else class="tp-thumb" :viewBox="`0 0 ${VB_W} ${vbH(t)}`" role="img" :aria-label="t.name">
        <rect x="0" y="0" :width="VB_W" :height="vbH(t)" rx="4" class="tp-bg" />
        <rect
          v-for="r in slotRects(t)"
          :key="r.name"
          :x="r.x * VB_W + 1"
          :y="r.y * vbH(t) + 1"
          :width="Math.max(2, r.w * VB_W - 2)"
          :height="Math.max(2, r.h * vbH(t) - 2)"
          rx="2"
          class="tp-slot"
          :class="{ fixed: r.fixed, required: r.required }"
        />
      </svg>
      <div class="tp-name">
        {{ t.name }} <code>{{ t.id }}</code>
      </div>
      <div class="tp-desc">
        {{ t.description }} · {{ t.kind === 'scaled' ? '整体缩放' : '响应式栅格' }} · {{ t.slots.length }} 槽位
      </div>
    </button>
  </div>
</template>

<style scoped>
.tp {
  display: grid;
  gap: 10px;
}
.tp-card {
  display: block;
  width: 100%;
  text-align: left;
  padding: 8px;
  border: 1px solid var(--ed-line, rgba(83, 196, 255, 0.2));
  border-radius: 8px;
  background: var(--ed-bg-1, #0b1a33);
  color: inherit;
  cursor: pointer;
  font: inherit;
}
.tp-card:hover {
  border-color: var(--ed-accent, #19b7ff);
}
.tp-card.active {
  border-color: var(--ed-accent, #19b7ff);
  box-shadow: 0 0 0 1px var(--ed-accent, #19b7ff) inset;
}
.tp-thumb {
  display: block;
  width: 100%;
  height: auto;
  border-radius: 4px;
}
.tp-bg {
  fill: #041634;
}
.tp-slot {
  fill: rgba(25, 183, 255, 0.18);
  stroke: rgba(83, 196, 255, 0.55);
  stroke-width: 0.8;
}
.tp-slot.fixed {
  fill: rgba(255, 176, 32, 0.22);
  stroke: rgba(255, 176, 32, 0.7);
}
.tp-slot.required {
  stroke-dasharray: 3 2;
}
.tp-name {
  margin-top: 6px;
  font-weight: 600;
}
.tp-name code {
  font-weight: 400;
  opacity: 0.7;
  margin-left: 4px;
}
.tp-desc {
  font-size: 12px;
  opacity: 0.65;
  margin-top: 2px;
}
</style>
