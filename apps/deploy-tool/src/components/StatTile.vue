<script setup>
import { computed, ref, watch } from 'vue'

const props = defineProps({
  label: String,
  en: String,
  value: [Number, String],
  unit: String,
  color: String,
  decimals: { type: Number, default: 1 },
  delay: { type: Number, default: 0 },
  sub: { type: String, default: '' },
})

const shown = computed(() => {
  if (props.value == null) return '——'
  if (typeof props.value === 'string') return props.value
  return props.value.toFixed(props.decimals)
})

// glow pulse whenever a fresh value lands
const flash = ref(false)
let t = null
watch(
  () => props.value,
  () => {
    flash.value = true
    clearTimeout(t)
    t = setTimeout(() => (flash.value = false), 320)
  }
)
</script>

<template>
  <div class="stat" :style="{ '--stat-color': color, animationDelay: delay + 'ms' }">
    <div class="stat-label">
      <span>{{ label }}</span>
      <span>{{ en }}</span>
    </div>
    <div class="stat-value" :class="{ flash }">
      {{ shown }}<span class="stat-unit">{{ unit }}</span>
    </div>
    <div class="stat-sub">{{ sub || ' ' }}</div>
  </div>
</template>
