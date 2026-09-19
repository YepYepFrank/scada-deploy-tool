<script setup lang="ts">
/**
 * 键值表(开关状态映射 值 → 合 / 分;数值标签枚举文字 值 → 文字)。
 * 每次改动 emit 一张新表,由父组件经 ctx.apply 写回——一次改动一步撤销;键在 change(回车 / 失焦)时提交。
 * 注意 JS 对象的整数键会按数值排序,所以行序可能与添加顺序不同(对映射语义没有影响)。
 */
import { computed } from 'vue'
import { mapAddRow, mapRemoveRow, mapRenameKey, mapSetValue } from './ops'

const props = defineProps<{
  modelValue: Record<string, string>
  /** 给了就是下拉(值只能从这里选);不给就是文本框 */
  options?: Array<{ value: string; label: string }>
  /** 新加一行时的缺省值 */
  defaultValue: string
  keyPlaceholder?: string
  valuePlaceholder?: string
}>()
const emit = defineEmits<{ 'update:modelValue': [map: Record<string, string>] }>()

const rows = computed(() => Object.entries(props.modelValue))
const ev = (e: Event): string => (e.target as HTMLInputElement | HTMLSelectElement).value

function renameKey(from: string, e: Event): void {
  const next = mapRenameKey(props.modelValue, from, ev(e))
  if (next !== props.modelValue) {
    emit('update:modelValue', next)
    return
  }
  // 撞键 / 空键:输入框退回原值
  ;(e.target as HTMLInputElement).value = from
}
const setValue = (key: string, e: Event): void => {
  const v = ev(e)
  if (v !== props.modelValue[key]) emit('update:modelValue', mapSetValue(props.modelValue, key, v))
}
</script>

<template>
  <div class="sld-bd-map">
    <div v-for="[k, v] in rows" :key="k" class="sld-bd-map-row" :data-key="k">
      <input
        class="sld-bd-map-k"
        :value="k"
        :placeholder="keyPlaceholder ?? '值'"
        data-role="map-key"
        @change="renameKey(k, $event)"
      />
      <span class="sld-bd-map-arrow">→</span>
      <select v-if="options" class="sld-bd-map-v" :value="v" data-role="map-value" @change="setValue(k, $event)">
        <option v-for="o in options" :key="o.value" :value="o.value">{{ o.label }}</option>
      </select>
      <input
        v-else
        class="sld-bd-map-v"
        :value="v"
        :placeholder="valuePlaceholder ?? '显示文字'"
        data-role="map-value"
        @change="setValue(k, $event)"
      />
      <button
        type="button"
        class="sld-bd-x"
        title="删除这一行"
        data-role="map-remove"
        @click="emit('update:modelValue', mapRemoveRow(modelValue, k))"
      >
        ×
      </button>
    </div>
    <button
      type="button"
      class="sld-bd-mini"
      data-role="map-add"
      @click="emit('update:modelValue', mapAddRow(modelValue, defaultValue))"
    >
      + 加一行
    </button>
  </div>
</template>
