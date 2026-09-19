<script setup lang="ts">
/**
 * 一个数值标签的编辑:测点(复用 BindingRow)、前缀、digits / unit / scale、颜色、枚举文字。
 * 每个字段在 change 时经 ctx.apply 提交,一次一步撤销。
 */
import { computed, inject, ref } from 'vue'
import type { Binding, BindingSlotSpec, SldEntityName } from '@grid/scada-renderer'
import BindingRow from '../../../editor/BindingRow.vue'
import { SLD_EDITOR_CTX } from '../../ext'
import MapEditor from './MapEditor.vue'
import {
  bindingOf,
  hydrateBinding,
  removeValueLabel,
  setLabelBinding,
  updateValueLabel,
  withDefaultEntity,
  type SldValueLabel,
  type ValueLabelPatch,
} from './ops'

const props = defineProps<{
  labelId: string
  /** BindingRow 新建绑定时默认带出的设备(依附节点的 node.entity) */
  defaultEntity?: SldEntityName
}>()

const ctx = inject(SLD_EDITOR_CTX)!

const label = computed(() => {
  const l = ctx.content.value.doc.labels.find(x => x.id === props.labelId)
  return l?.kind === 'value' ? (l as SldValueLabel) : undefined
})
const tree = computed(() => ctx.host.tree ?? null)
const binding = computed(() =>
  label.value ? hydrateBinding(bindingOf(ctx.content.value, label.value.pt), tree.value) : null
)
const spec = computed<BindingSlotSpec>(() => ({
  name: `pt.${label.value?.pt ?? ''}`,
  title: '测点',
  valueType: 'any',
  modes: ['ts', 'attr', 'const'],
}))

const COLORS = [
  { value: '', label: '无(随主题)' },
  { value: 'a', label: 'A 相(黄)' },
  { value: 'b', label: 'B 相(绿)' },
  { value: 'c', label: 'C 相(红)' },
  { value: 'custom', label: '自定义…' },
]
const colorKind = computed(() => {
  const c = label.value?.color
  return !c ? '' : c === 'a' || c === 'b' || c === 'c' ? c : 'custom'
})
const customColor = computed(() => (colorKind.value === 'custom' ? (label.value?.color ?? '#19b7ff') : '#19b7ff'))

const ev = (e: Event): string => (e.target as HTMLInputElement | HTMLSelectElement).value
const num = (s: string): number | null => (s.trim() === '' ? null : Number(s))

function patch(p: ValueLabelPatch, what: string): void {
  ctx.apply(d => updateValueLabel(d, props.labelId, p), what)
}
function setBinding(b: Binding | null): void {
  const next = withDefaultEntity(b, props.defaultEntity, tree.value)
  ctx.apply(d => setLabelBinding(d, props.labelId, next, () => ctx.newId('p')), '改标签测点')
}
function setColor(kind: string): void {
  patch({ color: kind === 'custom' ? customColor.value : kind || null }, '改标签颜色')
}
const showMap = ref(false)
const map = computed(() => label.value?.format?.map ?? {})
function remove(): void {
  ctx.apply(d => removeValueLabel(d, props.labelId), '删除数值标签')
}
</script>

<template>
  <div v-if="label" class="sld-bd-label" :data-label="label.id">
    <div class="sld-bd-label-head">
      <b>{{ label.title || '(无前缀)' }}</b>
      <code>pt.{{ label.pt }}</code>
      <span class="sld-bd-grow" />
      <button type="button" class="sld-bd-mini sld-bd-danger" data-role="label-remove" @click="remove">删除</button>
    </div>
    <BindingRow
      :spec="spec"
      :model-value="binding"
      :tree="tree"
      :client="ctx.host.client ?? null"
      :declared="ctx.host.declared ?? null"
      @update:model-value="setBinding"
    />
    <div class="sld-bd-grid">
      <label>
        <span>前缀</span>
        <input
          :value="label.title ?? ''"
          placeholder="如 P / Ia"
          data-field="title"
          @change="patch({ title: ev($event).trim() || null }, '改标签前缀')"
        />
      </label>
      <label>
        <span>单位</span>
        <input
          :value="label.format?.unit ?? ''"
          placeholder="kW"
          data-field="unit"
          @change="patch({ unit: ev($event).trim() || null }, '改标签单位')"
        />
      </label>
      <label>
        <span>小数位</span>
        <input
          type="number"
          min="0"
          max="6"
          :value="label.format?.digits ?? ''"
          placeholder="自动"
          data-field="digits"
          @change="patch({ digits: num(ev($event)) }, '改小数位')"
        />
      </label>
      <label>
        <span>倍率</span>
        <input
          type="number"
          step="any"
          :value="label.format?.scale ?? ''"
          placeholder="1"
          data-field="scale"
          @change="patch({ scale: num(ev($event)) }, '改倍率')"
        />
      </label>
      <label>
        <span>颜色</span>
        <select :value="colorKind" data-field="color" @change="setColor(ev($event))">
          <option v-for="c in COLORS" :key="c.value" :value="c.value">{{ c.label }}</option>
        </select>
      </label>
      <label v-if="colorKind === 'custom'">
        <span>色值</span>
        <input
          type="color"
          :value="customColor"
          data-field="custom-color"
          @change="patch({ color: ev($event) }, '改标签颜色')"
        />
      </label>
    </div>
    <div class="sld-bd-sub">
      <button type="button" class="sld-bd-link" data-role="toggle-enum" @click="showMap = !showMap">
        {{ showMap ? '▾' : '▸' }} 枚举文字{{ Object.keys(map).length ? `(${Object.keys(map).length})` : '(可选)' }}
      </button>
      <MapEditor
        v-if="showMap"
        :model-value="map"
        default-value=""
        value-placeholder="如:停止 / 制冷"
        @update:model-value="patch({ map: $event }, '改枚举文字')"
      />
    </div>
  </div>
</template>
