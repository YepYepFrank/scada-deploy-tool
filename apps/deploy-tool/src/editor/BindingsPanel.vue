<script setup lang="ts">
/**
 * 一个组件的全部绑定槽位(T3.4):按 bindingSlots 逐个出 BindingRow;multiple 槽位是可增删的列表;
 * 必填未绑标红、valueType 不匹配标黄(最近值类型来自元数据缓存)。
 */
import { computed, ref, watch } from 'vue'
import type { Binding, WidgetConfig, WidgetDefinition } from '@grid/scada-renderer'
import BindingRow from './BindingRow.vue'
import { checkSlot, defaultMode, emptyBinding, type BindingFlag } from './binding-check'
import type { MetaClient, MetaNode, ValueKind } from '../meta/MetaNode'

const props = defineProps<{
  def: WidgetDefinition
  widget: WidgetConfig
  tree: MetaNode | null
  client: MetaClient | null
}>()
const emit = defineEmits<{
  update: [bindings: WidgetConfig['bindings']]
  flags: [flags: Record<string, BindingFlag | null>]
}>()

const VT: Record<string, string> = {
  number: '数值',
  string: '文本',
  boolean: '布尔',
  series: '序列',
  alarms: '告警',
  any: '任意',
}

function set(slot: string, value: Binding | Binding[] | null) {
  const next = { ...props.widget.bindings }
  if (value === null || (Array.isArray(value) && !value.length)) delete next[slot]
  else next[slot] = value
  emit('update', next)
}
const single = (slot: string): Binding | null => {
  const b = props.widget.bindings[slot]
  return b === undefined ? null : Array.isArray(b) ? (b[0] ?? null) : b
}
const list = (slot: string): Binding[] => {
  const b = props.widget.bindings[slot]
  return b === undefined ? [] : Array.isArray(b) ? b : [b]
}
function setAt(slot: string, i: number, b: Binding | null) {
  const l = [...list(slot)]
  if (b === null) l.splice(i, 1)
  else l[i] = b
  set(slot, l)
}
function add(slot: string) {
  const spec = props.def.bindingSlots.find(s => s.name === slot)!
  set(slot, [...list(slot), emptyBinding(defaultMode(spec))])
}
function move(slot: string, i: number, dir: -1 | 1) {
  const l = [...list(slot)]
  const j = i + dir
  if (j < 0 || j >= l.length) return
  ;[l[i], l[j]] = [l[j]!, l[i]!]
  set(slot, l)
}

// ---------- 最近值类型缓存 → 标黄 ----------
const kinds = ref<Record<string, ValueKind | undefined>>({})
const keyKindOf = (b: Binding): ValueKind | undefined =>
  b.mode === 'ts' || b.mode === 'attr' ? kinds.value[`${b.entity.type}/${b.entity.id}/${b.key}`] : undefined
watch(
  () => [props.widget.bindings, props.client],
  async () => {
    const c = props.client
    if (!c) return
    for (const b of Object.values(props.widget.bindings).flatMap(v => (Array.isArray(v) ? v : [v]))) {
      if (b.mode !== 'ts' || !b.entity.id || !b.key) continue
      const k = `${b.entity.type}/${b.entity.id}/${b.key}`
      if (k in kinds.value) continue
      try {
        const info = (await c.tsKeys(b.entity)).find(x => x.key === b.key)
        kinds.value = { ...kinds.value, [k]: info?.kind }
      } catch {
        kinds.value = { ...kinds.value, [k]: undefined }
      }
    }
  },
  { deep: true, immediate: true }
)
const flags = computed(() => {
  const out: Record<string, BindingFlag | null> = {}
  for (const s of props.def.bindingSlots) out[s.name] = checkSlot(s, props.widget.bindings[s.name], keyKindOf)
  return out
})
watch(flags, f => emit('flags', f), { immediate: true })
</script>

<template>
  <div class="bp">
    <div
      v-for="s in def.bindingSlots"
      :key="s.name"
      class="bp-slot"
      :class="{ bad: flags[s.name]?.level === 'error', warn: flags[s.name]?.level === 'warning' }"
      :data-slot="s.name"
    >
      <div class="bp-head">
        <b>{{ s.title ?? s.name }}</b> <code>{{ s.name }}</code>
        <span class="bp-vt"
          >{{ VT[s.valueType] ?? s.valueType }}{{ s.multiple ? ' × N' : '' }}{{ s.required ? ' · 必填' : '' }}</span
        >
        <span v-if="flags[s.name]" class="bp-flag">{{ flags[s.name]!.message }}</span>
      </div>
      <template v-if="s.multiple">
        <div v-for="(b, i) in list(s.name)" :key="i" class="bp-item">
          <div class="bp-item-head">
            <span>#{{ i + 1 }}</span>
            <button type="button" class="bp-mini" :disabled="i === 0" @click="move(s.name, i, -1)">↑</button>
            <button type="button" class="bp-mini" :disabled="i === list(s.name).length - 1" @click="move(s.name, i, 1)">
              ↓
            </button>
            <button type="button" class="bp-mini bp-del" @click="setAt(s.name, i, null)">×</button>
          </div>
          <BindingRow
            :spec="s"
            :model-value="b"
            :tree="tree"
            :client="client"
            @update:model-value="setAt(s.name, i, $event ?? null)"
          />
        </div>
        <button type="button" class="bp-add" @click="add(s.name)">+ 添加一条</button>
      </template>
      <BindingRow
        v-else
        :spec="s"
        :model-value="single(s.name)"
        :tree="tree"
        :client="client"
        @update:model-value="set(s.name, $event)"
      />
    </div>
  </div>
</template>

<style>
.bp {
  display: grid;
  gap: 10px;
}
.bp-slot {
  border-left: 3px solid transparent;
  padding-left: 8px;
  display: grid;
  gap: 6px;
}
.bp-slot.bad {
  border-left-color: #ff6b6b;
}
.bp-slot.warn {
  border-left-color: #ffd27a;
}
.bp-head {
  display: flex;
  gap: 6px;
  align-items: baseline;
  flex-wrap: wrap;
  font-size: 12px;
}
.bp-vt {
  opacity: 0.6;
}
.bp-flag {
  margin-left: auto;
  color: #ffd27a;
}
.bp-slot.bad .bp-flag {
  color: #ff8a8a;
}
.bp-item {
  display: grid;
  gap: 4px;
}
.bp-item-head {
  display: flex;
  gap: 4px;
  align-items: center;
  font-size: 12px;
  opacity: 0.8;
}
.bp-item-head span {
  margin-right: auto;
}
.bp-mini {
  padding: 0 6px;
  line-height: 20px;
  font-size: 12px;
  background: var(--ed-bg-1, #0b1a33);
  border: 1px solid var(--ed-line, rgba(83, 196, 255, 0.2));
  border-radius: 4px;
  color: inherit;
  cursor: pointer;
}
.bp-mini:disabled {
  opacity: 0.35;
}
.bp-del {
  color: #ff8a8a;
}
.bp-add {
  background: none;
  border: 1px dashed var(--ed-line, rgba(83, 196, 255, 0.3));
  border-radius: 6px;
  padding: 5px;
  color: inherit;
  cursor: pointer;
  font: inherit;
}
</style>
