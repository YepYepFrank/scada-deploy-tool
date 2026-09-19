<script setup lang="ts">
/**
 * 挂在工具栏按钮下方的小浮层(下拉菜单 / 底图浮层)。按钮由骨架渲染,带 `data-tool="<工具 id>"`,据此定位;
 * 找不到按钮(测试里、或工具栏折行后被挤没了)时贴在视口右上角。点浮层和按钮以外的地方关闭,Esc 关闭。
 */
import { onBeforeUnmount, onMounted, ref } from 'vue'

const props = defineProps<{ anchor: string; label: string }>()
const emit = defineEmits<{ close: [] }>()

const el = ref<HTMLElement>()
const pos = ref<{ top: string; left?: string; right?: string }>({ top: '48px', right: '16px' })

function anchorEl(): HTMLElement | null {
  const root = el.value?.closest('.sld-ed') ?? document
  return root.querySelector<HTMLElement>(`[data-tool="${props.anchor}"]`)
}

function place(): void {
  const btn = anchorEl()
  if (!btn) return
  const r = btn.getBoundingClientRect()
  const width = el.value?.offsetWidth ?? 0
  const left = Math.max(8, Math.min(r.left, window.innerWidth - width - 8))
  pos.value = { top: `${r.bottom + 4}px`, left: `${left}px` }
}

function onDocDown(e: PointerEvent): void {
  const t = e.target as Node | null
  if (!t || el.value?.contains(t) || anchorEl()?.contains(t)) return
  emit('close')
}
function onKey(e: KeyboardEvent): void {
  if (e.key !== 'Escape') return
  e.stopPropagation()
  emit('close')
}

onMounted(() => {
  place()
  document.addEventListener('pointerdown', onDocDown, true)
  window.addEventListener('resize', place)
})
onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', onDocDown, true)
  window.removeEventListener('resize', place)
})
</script>

<template>
  <div ref="el" class="sld-tp" role="dialog" :aria-label="label" :style="pos" tabindex="-1" @keydown="onKey">
    <slot />
  </div>
</template>

<style>
.sld-tp {
  position: fixed;
  z-index: 900;
  min-width: 160px;
  padding: 8px;
  color: #dbeaff;
  font-size: 12px;
  background: var(--ed-bg-1, #0b1a33);
  border: 1px solid var(--ed-line, rgba(83, 196, 255, 0.2));
  border-radius: 6px;
  box-shadow: 0 8px 28px rgba(0, 0, 0, 0.45);
  outline: none;
}
.sld-tp-grid {
  display: grid;
  grid-template-columns: repeat(3, auto);
  gap: 4px;
}
.sld-tp-btn {
  padding: 4px 8px;
  color: inherit;
  font: inherit;
  font-size: 12px;
  white-space: nowrap;
  background: transparent;
  border: 1px solid var(--ed-line, rgba(83, 196, 255, 0.2));
  border-radius: 4px;
  cursor: pointer;
}
.sld-tp-btn:hover:not(:disabled) {
  border-color: var(--ed-accent, #19b7ff);
}
.sld-tp-btn:disabled {
  opacity: 0.35;
  cursor: default;
}
.sld-tp-hint {
  margin: 6px 2px 0;
  opacity: 0.55;
}
</style>
