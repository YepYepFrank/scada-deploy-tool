<script setup lang="ts">
/**
 * 槽位示意图:直接用渲染器 <ScadaPage design> 画当前配置(已配槽位 = 用 sampleData 渲染的真组件,空槽位 = 占位),
 * 在其上做事件委托:点到 .sr-slot 就选中该槽位。选中态通过给对应 DOM 加 class 表示。
 */
import { nextTick, ref, watch } from 'vue'
import { ScadaPage, type PageConfig, type TemplateDefinition } from '@grid/scada-renderer'
import { aspectRatio } from './template-geometry'

const props = defineProps<{
  config: PageConfig
  template: TemplateDefinition
  selected?: string | null
}>()
const emit = defineEmits<{ select: [slot: string] }>()

const board = ref<HTMLElement | null>(null)

function onClick(e: MouseEvent) {
  const el = (e.target as HTMLElement | null)?.closest<HTMLElement>('.sr-slot[data-slot]')
  const slot = el?.dataset.slot
  if (slot) emit('select', slot)
}

function paintSelection() {
  const root = board.value
  if (!root) return
  root.querySelectorAll('.sr-slot.ed-selected').forEach(el => el.classList.remove('ed-selected'))
  if (props.selected)
    root.querySelector(`.sr-slot[data-slot="${CSS.escape(props.selected)}"]`)?.classList.add('ed-selected')
}
watch(
  () => [props.selected, props.config, props.template.id],
  async () => {
    await nextTick()
    paintSelection()
  },
  { deep: true, immediate: true }
)
</script>

<template>
  <div
    ref="board"
    class="sb"
    :class="{ 'sb-grid': template.kind === 'grid' }"
    :style="template.kind === 'scaled' ? { aspectRatio: String(aspectRatio(template)) } : {}"
    @click="onClick"
  >
    <ScadaPage :config="config" design />
  </div>
</template>

<style>
/* 非 scoped:要作用到渲染器输出的 .sr-slot */
.sb {
  position: relative;
  width: 100%;
  background: #020817;
  border: 1px solid rgba(83, 196, 255, 0.2);
  border-radius: 8px;
  overflow: hidden;
  cursor: pointer;
}
.sb-grid {
  min-height: 480px;
  padding: 12px;
  box-sizing: border-box;
}
.sb .sr-slot {
  outline: 1px dashed transparent;
  outline-offset: -2px;
  transition: outline-color 0.12s;
}
.sb .sr-slot:hover {
  outline-color: rgba(25, 183, 255, 0.6);
}
.sb .sr-slot.ed-selected {
  outline: 2px solid #19b7ff;
  outline-offset: -2px;
  box-shadow: 0 0 0 4px rgba(25, 183, 255, 0.18) inset;
}
.sb .sr-slot-empty .sr-slot-placeholder {
  cursor: pointer;
}
</style>
