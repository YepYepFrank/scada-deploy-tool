<script setup lang="ts">
/**
 * 组件选择弹层:列出注册表组件,按槽位 accepts 过滤;固定槽位只列固定类型。
 * 传 library(站点卡片库里已配好的卡)时,上方多一组「从卡片库放入」:整张卡(属性 + 绑定)复制进槽位(2026-09-14)。
 */
import { computed, onBeforeUnmount, onMounted } from 'vue'
import type { TemplateSlotDefinition, WidgetConfig, WidgetDefinition } from '@grid/scada-renderer'

const props = defineProps<{
  slotDef: TemplateSlotDefinition
  widgets: WidgetDefinition[]
  /** 该槽位当前组件类型(有则可移除) */
  current?: string
  /** 卡片库里的卡(可复用);不传或为空则不显示该组 */
  library?: WidgetConfig[]
}>()
const emit = defineEmits<{ pick: [def: WidgetDefinition]; pickCard: [card: WidgetConfig]; remove: []; close: [] }>()

/** 卡片库里能放进这个槽位的卡(按槽位 accepts / fixed 过滤) */
const cards = computed(() =>
  (props.library ?? []).filter(c => {
    if (props.slotDef.fixed) return c.type === props.slotDef.fixed.type
    return !props.slotDef.accepts || props.slotDef.accepts.includes(c.type)
  })
)
const cardTitle = (c: WidgetConfig) => (typeof c.props?.title === 'string' && c.props.title) || '(无标题)'
const defName = (type: string) => props.widgets.find(w => w.type === type)?.name ?? type

const CATEGORY: Record<string, string> = {
  value: '数值',
  chart: '图表',
  alarm: '告警',
  media: '媒体',
  diagram: '图形',
  text: '文本',
}

/** Esc 关闭(与点遮罩 / × 等价)。编辑器的全局 Esc 先看到 pickerOpen 仍为 true,所以不会同时退出全屏 */
function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    e.preventDefault()
    emit('close')
  }
}
onMounted(() => window.addEventListener('keydown', onKey))
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))

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
      <div v-if="cards.length" class="wp-lib" data-role="wp-library">
        <div class="wp-lib-head">从卡片库放入 <span class="dim">整张卡(属性 + 绑定)复制进来,复制后各改各的</span></div>
        <button
          v-for="c in cards"
          :key="c.id"
          type="button"
          class="wp-item wp-card"
          :data-card-id="c.id"
          @click="emit('pickCard', c)"
        >
          <span class="wp-cat">{{ defName(c.type) }}</span>
          <span class="wp-name">{{ cardTitle(c) }}</span>
          <code>{{ c.id }}</code>
          <span class="wp-desc">{{ Object.keys(c.bindings ?? {}).length }} 个绑定</span>
        </button>
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
.wp-lib {
  padding: 8px 8px 0;
  display: grid;
  gap: 6px;
  border-bottom: 1px dashed var(--ed-line, rgba(83, 196, 255, 0.2));
  padding-bottom: 8px;
}
.wp-lib-head {
  font-size: 12px;
  font-weight: 600;
  padding: 2px 4px;
}
.wp-lib-head .dim {
  font-weight: 400;
  opacity: 0.65;
  margin-left: 6px;
}
.wp-card {
  border-color: rgba(111, 227, 160, 0.35);
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
