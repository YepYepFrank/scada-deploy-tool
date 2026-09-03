<script setup>
// 分组折叠式下拉选择器:关闭态显示当前选中项;打开后 关键字过滤 + 按组折叠(点组头展开)。
// pinned 组默认展开(用于置顶「本站声明的运算」),其余组默认折叠;过滤时命中组强制展开。
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'

const props = defineProps({
  modelValue: { type: String, default: '' },
  groups: { type: Array, default: () => [] },   // [{ label, items: [{value, label}], pinned? }]
  topItems: { type: Array, default: () => [] }, // 不分组的固定项(如【常数】)
  placeholder: { type: String, default: '请选择…' },
})
const emit = defineEmits(['update:modelValue', 'change'])

const open = ref(false)
const q = ref('')
const root = ref(null)
const panelEl = ref(null)
const qInput = ref(null)
const openMap = ref({}) // 组名 → 用户手动展开/收起(覆盖默认)
/* 面板用 fixed 定位悬浮在视口上:在限高可滚动的弹窗里打开时,
   不会把弹窗内容撑高导致弹窗自身出现滚动条——只有列表内部滚动。 */
const panelStyle = ref({})
function place() {
  if (!root.value) return
  const r = root.value.getBoundingClientRect()
  const below = window.innerHeight - r.bottom
  const openUp = below < 280 && r.top > below
  const maxH = Math.max(200, (openUp ? r.top : below) - 16)
  panelStyle.value = {
    position: 'fixed',
    left: r.left + 'px',
    width: r.width + 'px',
    maxHeight: maxH + 'px',
    ...(openUp
      ? { bottom: window.innerHeight - r.top + 4 + 'px', top: 'auto' }
      : { top: r.bottom + 4 + 'px', bottom: 'auto' }),
  }
}
function onWinMove() { if (open.value) place() }

const selLabel = computed(() => {
  for (const t of props.topItems) if (t.value === props.modelValue) return t.label
  for (const g of props.groups)
    for (const it of g.items) if (it.value === props.modelValue) return `${g.label} · ${it.label}`
  return ''
})
const filtered = computed(() => {
  const f = q.value.trim().toLowerCase()
  if (!f) return props.groups
  return props.groups
    .map((g) => ({ ...g, items: g.items.filter((it) =>
      it.label.toLowerCase().includes(f) || g.label.toLowerCase().includes(f)) }))
    .filter((g) => g.items.length)
})
const isExpanded = (g) =>
  q.value.trim() ? true : (g.label in openMap.value ? openMap.value[g.label] : !!g.pinned)
const toggleG = (g) => { openMap.value[g.label] = !isExpanded(g) }
function pick(it) {
  emit('update:modelValue', it.value)
  emit('change', it.value)
  open.value = false
  q.value = ''
}
async function toggle() {
  open.value = !open.value
  if (open.value) { q.value = ''; place(); await nextTick(); place(); qInput.value?.focus() }
}
function onDocDown(e) {
  if (open.value && root.value
      && !root.value.contains(e.target)
      && !(panelEl.value && panelEl.value.contains(e.target))) open.value = false
}
onMounted(() => {
  document.addEventListener('mousedown', onDocDown, true)
  window.addEventListener('scroll', onWinMove, true)
  window.addEventListener('resize', onWinMove)
})
onBeforeUnmount(() => {
  document.removeEventListener('mousedown', onDocDown, true)
  window.removeEventListener('scroll', onWinMove, true)
  window.removeEventListener('resize', onWinMove)
})
</script>

<template>
  <div class="kp" ref="root">
    <button type="button" class="kp-btn" :title="selLabel || ''" @click="toggle">
      <span class="kp-sel" :class="{ ph: !selLabel }">{{ selLabel || placeholder }}</span>
      <span class="kp-caret">{{ open ? '▴' : '▾' }}</span>
    </button>
    <Teleport to="body">
    <div v-if="open" ref="panelEl" class="kp-panel" :style="panelStyle">
      <input ref="qInput" v-model="q" class="kp-q" type="text"
             placeholder="🔍 关键字过滤(设备名 / 测点名 / 中文名)…" />
      <div class="kp-list">
        <div v-for="t in topItems" :key="t.value" class="kp-item top" :title="t.label"
             :class="{ on: t.value === modelValue }" @mousedown.prevent="pick(t)">{{ t.label }}</div>
        <template v-for="g in filtered" :key="g.label">
          <div class="kp-group" :class="{ pinned: g.pinned }" @mousedown.prevent="toggleG(g)">
            <span class="kp-fold">{{ isExpanded(g) ? '▼' : '▶' }}</span>
            <span class="kp-gname">{{ g.label }}</span>
            <span class="kp-cnt">{{ g.items.length }}</span>
          </div>
          <template v-if="isExpanded(g)">
            <div v-for="it in g.items" :key="it.value" class="kp-item" :title="`${g.label} · ${it.label}`"
                 :class="{ on: it.value === modelValue }" @mousedown.prevent="pick(it)">{{ it.label }}</div>
          </template>
        </template>
        <div v-if="!filtered.length && !topItems.length" class="kp-empty">无匹配项</div>
      </div>
    </div>
    </Teleport>
  </div>
</template>

<style scoped>
.kp { position: relative; min-width: 240px; flex: 1; }
.kp-btn {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 8px;
  background: var(--bg-0);
  border: 1px solid var(--line-1);
  border-radius: 4px;
  padding: 8px 12px;
  color: var(--ink-0);
  font: inherit;
  font-size: 13px;
  cursor: pointer;
  text-align: left;
}
.kp-btn:hover { border-color: var(--accent); }
.kp-sel { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.kp-sel.ph { color: var(--ink-2); }
.kp-caret { color: var(--ink-2); font-size: 11px; }
.kp-panel {
  /* 定位与尺寸由 place() 以 fixed 内联样式给出;Teleport 到 body,需盖过弹窗遮罩 */
  z-index: 220;
  display: flex;
  flex-direction: column;
  background: var(--bg-1, var(--bg-0));
  border: 1px solid var(--line-1);
  border-radius: 6px;
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.5);
  padding: 8px;
}
.kp-q { width: 100%; margin-bottom: 6px; flex-shrink: 0; }
.kp-list { flex: 1; min-height: 0; overflow-y: auto; }
.kp-group {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 8px;
  cursor: pointer;
  user-select: none;
  color: var(--ink-1);
  font-size: 12.5px;
  font-weight: 600;
  border-radius: 4px;
}
.kp-group:hover { background: color-mix(in srgb, var(--accent) 10%, transparent); }
.kp-group.pinned .kp-gname { color: var(--accent); }
.kp-fold { color: var(--ink-2); font-size: 9px; width: 12px; }
.kp-cnt {
  margin-left: auto;
  color: var(--ink-2);
  font-size: 11px;
  border: 1px solid var(--line-0);
  border-radius: 8px;
  padding: 0 7px;
}
.kp-item {
  padding: 5px 8px 5px 26px;
  cursor: pointer;
  color: var(--ink-1);
  font-size: 12.5px;
  border-radius: 4px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.kp-item:hover { background: color-mix(in srgb, var(--accent) 14%, transparent); }
.kp-item.on { color: var(--accent); font-weight: 600; }
.kp-item.top { padding-left: 8px; color: var(--ink-0); }
.kp-empty { padding: 10px; color: var(--ink-2); font-size: 12px; text-align: center; }
</style>
