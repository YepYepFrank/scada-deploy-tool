<script setup lang="ts">
/** 组件选择弹层:列出注册表组件,按槽位 accepts 过滤;固定槽位只列固定类型。 */
import { computed } from 'vue'
import type { TemplateSlotDefinition, WidgetDefinition } from '@grid/scada-renderer'

const props = defineProps<{
  slotDef: TemplateSlotDefinition
  widgets: WidgetDefinition[]
  /** 该槽位当前组件类型(有则可移除) */
  current?: string
}>()
const emit = defineEmits<{ pick: [def: WidgetDefinition]; remove: []; close: [] }>()

const CATEGORY: Record<string, string> = {
  value: '数值',
  chart: '图表',
  alarm: '告警',
  media: '媒体',
  diagram: '图形',
  text: '文本',
}

const options = computed(() =>
  props.widgets.filter(w => {
    if (props.slotDef.fixed) return w.type === props.slotDef.fixed.type
    return !props.slotDef.accepts || props.slotDef.accepts.includes(w.type)
  })
)
</script>

<template>
  <div class="wp-mask" @click.self="emit('close')">
    <div class="wp" role="dialog" :aria-label="`为槽位 ${slotDef.title ?? slotDef.name} 选择组件`">
      <div class="wp-head">
        <b>{{ slotDef.title ?? slotDef.name }}</b> <code>{{ slotDef.name }}</code>
        <span v-if="slotDef.fixed" class="wp-tag">固定组件</span>
        <span v-else-if="slotDef.accepts" class="wp-tag">可放 {{ options.length }} 种</span>
        <span v-else class="wp-tag">任意组件</span>
        <button type="button" class="wp-close" @click="emit('close')">×</button>
      </div>
      <div class="wp-list">
        <button
          v-for="w in options"
          :key="w.type"
          type="button"
          class="wp-item"
          :class="{ active: w.type === current }"
          :data-widget-type="w.type"
          @click="emit('pick', w)"
        >
          <span class="wp-cat">{{ CATEGORY[w.category] ?? w.category }}</span>
          <span class="wp-name">{{ w.name }}</span>
          <code>{{ w.type }}</code>
          <span class="wp-desc">{{ w.description }}</span>
        </button>
        <div v-if="!options.length" class="wp-empty">这个槽位没有可用组件</div>
      </div>
      <div v-if="current && !slotDef.fixed" class="wp-foot">
        <button type="button" class="wp-remove" @click="emit('remove')">移除当前组件({{ current }})</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.wp-mask {
  position: fixed;
  inset: 0;
  background: rgba(2, 8, 23, 0.6);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 50;
}
.wp {
  width: min(560px, 92vw);
  max-height: 80vh;
  display: flex;
  flex-direction: column;
  background: var(--ed-bg-1, #0b1a33);
  border: 1px solid var(--ed-line, rgba(83, 196, 255, 0.3));
  border-radius: 10px;
  color: inherit;
}
.wp-head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 14px;
  border-bottom: 1px solid var(--ed-line, rgba(83, 196, 255, 0.2));
}
.wp-head code {
  opacity: 0.7;
}
.wp-tag {
  font-size: 12px;
  opacity: 0.7;
  margin-left: auto;
}
.wp-close {
  background: none;
  border: none;
  color: inherit;
  font-size: 18px;
  cursor: pointer;
}
.wp-list {
  overflow: auto;
  padding: 8px;
  display: grid;
  gap: 6px;
}
.wp-item {
  display: grid;
  grid-template-columns: 44px 1fr auto;
  grid-template-areas: 'cat name type' 'cat desc desc';
  gap: 2px 8px;
  align-items: center;
  text-align: left;
  padding: 8px 10px;
  border: 1px solid transparent;
  border-radius: 6px;
  background: rgba(255, 255, 255, 0.03);
  color: inherit;
  font: inherit;
  cursor: pointer;
}
.wp-item:hover,
.wp-item.active {
  border-color: var(--ed-accent, #19b7ff);
}
.wp-cat {
  grid-area: cat;
  font-size: 11px;
  opacity: 0.7;
  border: 1px solid rgba(255, 255, 255, 0.15);
  border-radius: 4px;
  text-align: center;
  padding: 2px 0;
}
.wp-name {
  grid-area: name;
  font-weight: 600;
}
.wp-item code {
  grid-area: type;
  opacity: 0.7;
  font-size: 12px;
}
.wp-desc {
  grid-area: desc;
  font-size: 12px;
  opacity: 0.65;
}
.wp-empty {
  padding: 16px;
  opacity: 0.7;
}
.wp-foot {
  padding: 10px 14px;
  border-top: 1px solid var(--ed-line, rgba(83, 196, 255, 0.2));
}
.wp-remove {
  background: none;
  border: 1px solid rgba(255, 96, 96, 0.5);
  color: #ff8a8a;
  border-radius: 6px;
  padding: 6px 10px;
  cursor: pointer;
  font: inherit;
}
</style>
