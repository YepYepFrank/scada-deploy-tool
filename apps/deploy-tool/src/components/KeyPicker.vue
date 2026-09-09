<script setup>
// 分组折叠式下拉选择器:关闭态显示当前选中项;打开后 关键字过滤 + 按组折叠(点组头展开)。
// pinned 组默认展开(用于置顶「本站声明的运算」),其余组默认折叠;过滤时命中组强制展开。
// 没有 pinned 组、且只有一组或总项数不多(≤ 40)时全部默认展开——否则单设备的「遥测(6)」也折着,像空的一样。
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'

const props = defineProps({
  modelValue: { type: String, default: '' },
  groups: { type: Array, default: () => [] }, // [{ label, items: [{value, label, badge?}], pinned? }]
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
function onWinMove() {
  if (open.value) place()
}

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
    .map(g => ({
      ...g,
      items: g.items.filter(it => it.label.toLowerCase().includes(f) || g.label.toLowerCase().includes(f)),
    }))
    .filter(g => g.items.length)
})
const autoExpand = computed(
  () =>
    !props.groups.some(g => g.pinned) &&
    (props.groups.length === 1 || props.groups.reduce((n, g) => n + g.items.length, 0) <= 40)
)
const isExpanded = g =>
  q.value.trim() ? true : g.label in openMap.value ? openMap.value[g.label] : !!g.pinned || autoExpand.value
const toggleG = g => {
  openMap.value[g.label] = !isExpanded(g)
}
function pick(it) {
  emit('update:modelValue', it.value)
  emit('change', it.value)
  open.value = false
  q.value = ''
}
async function toggle() {
  open.value = !open.value
  if (open.value) {
    q.value = ''
    place()
    await nextTick()
    place()
    qInput.value?.focus()
  }
}
function onDocDown(e) {
  if (
    open.value &&
    root.value &&
    !root.value.contains(e.target) &&
    !(panelEl.value && panelEl.value.contains(e.target))
  )
    open.value = false
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
        <input
          ref="qInput"
          v-model="q"
          class="kp-q"
          type="text"
          placeholder="🔍 关键字过滤(设备名 / 测点名 / 中文名)…"
        />
        <div class="kp-list">
          <div
            v-for="t in topItems"
            :key="t.value"
            class="kp-item top"
            :title="t.label"
            :class="{ on: t.value === modelValue }"
            @mousedown.prevent="pick(t)"
          >
            {{ t.label }}
          </div>
          <template v-for="g in filtered" :key="g.label">
            <div class="kp-group" :class="{ pinned: g.pinned }" @mousedown.prevent="toggleG(g)">
              <span class="kp-fold">{{ isExpanded(g) ? '▼' : '▶' }}</span>
              <span class="kp-gname">{{ g.label }}</span>
              <span class="kp-cnt">{{ g.items.length }}</span>
            </div>
            <template v-if="isExpanded(g)">
              <div
                v-for="it in g.items"
                :key="it.value"
                class="kp-item"
                :title="`${g.label} · ${it.label}`"
                :class="{ on: it.value === modelValue }"
                @mousedown.prevent="pick(it)"
              >
                <span class="kp-item-label">{{ it.label }}</span>
                <span v-if="it.badge" class="kp-badge">{{ it.badge }}</span>
              </div>
            </template>
          </template>
          <div v-if="!filtered.length && !topItems.length" class="kp-empty">无匹配项</div>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
/* 令牌自带兜底:面板 Teleport 到 body,拿不到宿主容器上的变量;editor.html 入口也不加载 style.css 的 --bg/--ink 令牌,
   只有 EditorApp 自己的 --ed-*。三层回退:向导主题 → 编辑器主题 → 常量,任一入口都不会画成透明。 */
.kp,
.kp-panel {
  --kp-bg-0: var(--bg-0, var(--ed-bg-0, #061024));
  --kp-bg-1: var(--bg-1, var(--ed-bg-1, #0b1a33));
  --kp-line-0: var(--line-0, var(--ed-line, rgba(83, 196, 255, 0.14)));
  --kp-line-1: var(--line-1, var(--ed-line, rgba(83, 196, 255, 0.32)));
  --kp-ink-0: var(--ink-0, #ecf9ff);
  --kp-ink-1: var(--ink-1, #c9d8ee);
  --kp-ink-2: var(--ink-2, #8197b8);
  --kp-accent: var(--accent, var(--ed-accent, #19b7ff));
}
.kp {
  position: relative;
  min-width: 240px;
  flex: 1;
}
.kp-btn {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 8px;
  background: var(--kp-bg-0);
  border: 1px solid var(--kp-line-1);
  border-radius: 4px;
  padding: 8px 12px;
  color: var(--kp-ink-0);
  font: inherit;
  font-size: 13px;
  cursor: pointer;
  text-align: left;
}
.kp-btn:hover {
  border-color: var(--kp-accent);
}
.kp-sel {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.kp-sel.ph {
  color: var(--kp-ink-2);
}
.kp-caret {
  color: var(--kp-ink-2);
  font-size: 11px;
}
.kp-panel {
  /* 定位与尺寸由 place() 以 fixed 内联样式给出;Teleport 到 body,要盖过向导弹窗遮罩(160 / 300)
     和嵌入向导时的全屏编辑覆盖层 .ed-fs-host(1000)——之前是 220,在全屏编辑里面板开在覆盖层底下,看起来像点不开 */
  z-index: 1200;
  display: flex;
  flex-direction: column;
  background: var(--kp-bg-1);
  border: 1px solid var(--kp-line-1);
  border-radius: 6px;
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.5);
  padding: 8px;
}
.kp-q {
  width: 100%;
  margin-bottom: 6px;
  flex-shrink: 0;
}
.kp-list {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
}
.kp-group {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 8px;
  cursor: pointer;
  user-select: none;
  color: var(--kp-ink-1);
  font-size: 12.5px;
  font-weight: 600;
  border-radius: 4px;
}
.kp-group:hover {
  background: color-mix(in srgb, var(--kp-accent) 10%, transparent);
}
.kp-group.pinned .kp-gname {
  color: var(--kp-accent);
}
.kp-fold {
  color: var(--kp-ink-2);
  font-size: 9px;
  width: 12px;
}
.kp-cnt {
  margin-left: auto;
  color: var(--kp-ink-2);
  font-size: 11px;
  border: 1px solid var(--kp-line-0);
  border-radius: 8px;
  padding: 0 7px;
}
.kp-item {
  padding: 5px 8px 5px 26px;
  cursor: pointer;
  color: var(--kp-ink-1);
  font-size: 12.5px;
  border-radius: 4px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.kp-item:hover {
  background: color-mix(in srgb, var(--kp-accent) 14%, transparent);
}
.kp-item {
  display: flex;
  align-items: center;
  gap: 6px;
}
.kp-item-label {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
/* 「待发布」:本次配置声明、TB 上还没有的输出 */
.kp-badge {
  flex: none;
  font-size: 10px;
  padding: 0 5px;
  border-radius: 8px;
  border: 1px dashed var(--kp-line-1);
  color: var(--kp-ink-2);
}
.kp-item.on {
  color: var(--kp-accent);
  font-weight: 600;
}
.kp-item.top {
  padding-left: 8px;
  color: var(--kp-ink-0);
}
.kp-empty {
  padding: 10px;
  color: var(--kp-ink-2);
  font-size: 12px;
  text-align: center;
}
</style>
