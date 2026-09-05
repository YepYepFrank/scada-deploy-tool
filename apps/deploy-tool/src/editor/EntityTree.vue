<script setup lang="ts">
/** 实体树:站点 → 网关 → 设备 / 资产;关键字过滤;虚拟滚动(只渲染可见行,231 台设备也顺滑)。 */
import { computed, ref } from 'vue'
import type { EntityRef } from '@grid/tb-client'
import { flattenTree, type MetaNode } from '../meta/MetaNode'

const props = withDefaults(
  defineProps<{
    root: MetaNode
    /** 只允许选这些类型;缺省 DEVICE + ASSET */
    allow?: Array<'DEVICE' | 'ASSET'>
    selectedId?: string | null
    height?: number
    rowHeight?: number
  }>(),
  { allow: () => ['DEVICE', 'ASSET'], selectedId: null, height: 360, rowHeight: 26 }
)
const emit = defineEmits<{ select: [entity: EntityRef, node: MetaNode] }>()

const query = ref('')
const expanded = ref(new Set<string>(['site', ...props.root.children.map(c => c.id)]))
const rows = computed(() => flattenTree(props.root, expanded.value, query.value))

// ---------- 虚拟滚动 ----------
const scrollTop = ref(0)
const viewport = ref<HTMLElement | null>(null)
const overscan = 6
const range = computed(() => {
  const start = Math.max(0, Math.floor(scrollTop.value / props.rowHeight) - overscan)
  const count = Math.ceil(props.height / props.rowHeight) + overscan * 2
  return { start, end: Math.min(rows.value.length, start + count) }
})
const visible = computed(() => rows.value.slice(range.value.start, range.value.end))
const onScroll = () => (scrollTop.value = viewport.value?.scrollTop ?? 0)

function toggle(id: string) {
  const s = new Set(expanded.value)
  if (s.has(id)) s.delete(id)
  else s.add(id)
  expanded.value = s
}
function click(row: { node: MetaNode }) {
  const n = row.node
  if (n.entity && props.allow.includes(n.entity.type)) emit('select', n.entity, n)
  else if (n.children.length) toggle(n.id)
}
const ICON: Record<string, string> = { site: '🏭', gateway: '📡', device: '▫', asset: '◆', group: '▸' }
</script>

<template>
  <div class="et">
    <input v-model="query" class="et-q" type="search" placeholder="过滤设备 / 资产名…" />
    <div ref="viewport" class="et-viewport" :style="{ height: height + 'px' }" @scroll="onScroll">
      <div :style="{ height: rows.length * rowHeight + 'px', position: 'relative' }">
        <div
          v-for="(r, i) in visible"
          :key="r.node.id"
          class="et-row"
          :class="{
            selectable: !!r.node.entity && allow.includes(r.node.entity.type),
            selected: r.node.id === selectedId,
            [`kind-${r.node.kind}`]: true,
          }"
          :style="{
            position: 'absolute',
            top: (range.start + i) * rowHeight + 'px',
            height: rowHeight + 'px',
            paddingLeft: 8 + r.depth * 16 + 'px',
          }"
          :data-id="r.node.id"
          @click="click(r)"
        >
          <span v-if="r.hasChildren" class="et-fold" @click.stop="toggle(r.node.id)">{{ r.expanded ? '▾' : '▸' }}</span>
          <span v-else class="et-fold et-leaf"></span>
          <span class="et-icon">{{ ICON[r.node.kind] }}</span>
          <span class="et-name">{{ r.node.name }}</span>
          <span v-if="r.node.label && r.node.label !== r.node.name" class="et-label">{{ r.node.label }}</span>
          <span v-if="r.node.profile && r.node.kind !== 'group'" class="et-profile">{{ r.node.profile }}</span>
          <span v-if="r.hasChildren" class="et-count">{{ r.node.children.length }}</span>
        </div>
      </div>
    </div>
    <div class="et-foot">{{ rows.length }} 行 · 只渲染 {{ visible.length }} 行</div>
  </div>
</template>

<style scoped>
.et {
  display: grid;
  gap: 6px;
}
.et-q {
  width: 100%;
  box-sizing: border-box;
  background: var(--ed-bg-1, #0b1a33);
  border: 1px solid var(--ed-line, rgba(83, 196, 255, 0.2));
  border-radius: 6px;
  padding: 5px 8px;
  color: inherit;
  font: inherit;
}
.et-viewport {
  overflow: auto;
  border: 1px solid var(--ed-line, rgba(83, 196, 255, 0.2));
  border-radius: 6px;
  background: rgba(0, 0, 0, 0.2);
}
.et-row {
  left: 0;
  right: 0;
  display: flex;
  align-items: center;
  gap: 6px;
  box-sizing: border-box;
  white-space: nowrap;
  font-size: 12px;
  cursor: default;
}
.et-row.selectable {
  cursor: pointer;
}
.et-row.selectable:hover {
  background: rgba(25, 183, 255, 0.1);
}
.et-row.selected {
  background: rgba(25, 183, 255, 0.22);
}
.et-fold {
  width: 12px;
  text-align: center;
  cursor: pointer;
  opacity: 0.7;
}
.et-leaf {
  cursor: default;
}
.et-icon {
  opacity: 0.8;
}
.et-name {
  overflow: hidden;
  text-overflow: ellipsis;
}
.et-label,
.et-profile,
.et-count {
  opacity: 0.55;
  font-size: 11px;
}
.et-count {
  margin-left: auto;
  padding-right: 8px;
}
.kind-gateway .et-name,
.kind-site .et-name,
.kind-group .et-name {
  font-weight: 600;
}
.et-foot {
  font-size: 11px;
  opacity: 0.55;
}
</style>
