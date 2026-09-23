<script setup lang="ts">
/**
 * 取数的格子(2026-09-23):显示当前选的「设备 · 测点」,点一下由调用方打开右侧的数据源面板。
 * 替代第 3 步原来的原生下拉 / 分组下拉;正在被面板编辑的那一格高亮。
 */
withDefaults(
  defineProps<{
    /** 已选内容的显示文字;空 = 没选 */
    text?: string
    placeholder?: string
    /** 面板正在为这一格选 */
    active?: boolean
    disabled?: boolean
  }>(),
  { text: '', placeholder: '点击选择…', active: false, disabled: false }
)
defineEmits<{ open: [] }>()
</script>

<template>
  <button
    type="button"
    class="src-field"
    :class="{ empty: !text, active }"
    :disabled="disabled"
    :title="text || placeholder"
    data-role="source-field"
    @click="$emit('open')"
  >
    <span class="src-field-text">{{ text || placeholder }}</span>
    <span class="src-field-caret">›</span>
  </button>
</template>

<style>
.src-field {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  min-width: 220px;
  max-width: 100%;
  padding: 6px 10px;
  color: var(--ink-0);
  font: inherit;
  text-align: left;
  background: var(--bg-0);
  border: 1px solid var(--line-1);
  border-radius: var(--r);
  cursor: pointer;
}
.src-field:hover {
  border-color: var(--accent);
}
.src-field.empty {
  color: var(--ink-2);
}
.src-field.active {
  border-color: var(--accent);
  box-shadow: 0 0 0 2px rgba(25, 183, 255, 0.25);
}
.src-field-text {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
/* 多选格子 + 「清空」一行 */
.src-multi {
  display: flex;
  gap: 8px;
  align-items: center;
  min-width: 0;
}
.src-multi .src-field {
  flex: 1;
}
.src-field-caret {
  flex: none;
  color: var(--ink-2);
}
</style>
