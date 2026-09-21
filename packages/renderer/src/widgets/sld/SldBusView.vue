<script setup lang="ts">
/** 一条母线。单独成组件只为一件事:缺省层次的母线画在「线」层,被抬高(z > 0)的画在「图元」层,两处用同一份模板。 */
import type { SldBus } from '../../sld'

defineProps<{ bus: SldBus; paintClass?: string; paintStyle?: Record<string, string> }>()
</script>

<template>
  <line
    class="sr-sld-bus"
    :class="paintClass"
    :style="paintStyle"
    :data-id="bus.id"
    :x1="bus.x1"
    :y1="bus.y1"
    :x2="bus.x2"
    :y2="bus.y2"
  />
</template>
