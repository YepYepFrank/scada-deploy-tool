<script setup lang="ts">
/** 轻量模态框:遮罩 + 居中卡片;Esc 关闭、Enter 确认(焦点在 textarea 以外时)。样式沿用 --ed-* 变量。 */
defineProps<{ title: string; okText?: string; okDisabled?: boolean }>()
const emit = defineEmits<{ ok: []; cancel: [] }>()

function onKey(e: KeyboardEvent): void {
  // 编辑器的快捷键挂在 window 上:对话框里的按键一律不往外冒,免得 Esc 顺手清空选择、Delete 删掉节点
  e.stopPropagation()
  if (e.key === 'Escape') emit('cancel')
  else if (e.key === 'Enter' && (e.target as HTMLElement | null)?.tagName !== 'TEXTAREA') {
    e.preventDefault()
    emit('ok')
  }
}
</script>

<template>
  <div class="sld-tm-mask" @pointerdown.self="emit('cancel')">
    <div class="sld-tm" role="dialog" aria-modal="true" :aria-label="title" @keydown="onKey">
      <header class="sld-tm-head">{{ title }}</header>
      <div class="sld-tm-body"><slot /></div>
      <footer class="sld-tm-foot">
        <slot name="foot" />
        <span class="sld-tm-grow" />
        <button type="button" class="sld-tm-btn" data-act="cancel" @click="emit('cancel')">取消</button>
        <button
          type="button"
          class="sld-tm-btn sld-tm-btn-primary"
          data-act="ok"
          :disabled="okDisabled"
          @click="emit('ok')"
        >
          {{ okText ?? '确定' }}
        </button>
      </footer>
    </div>
  </div>
</template>

<style>
.sld-tm-mask {
  position: fixed;
  inset: 0;
  z-index: 1000;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.45);
  user-select: none;
}
.sld-tm {
  display: flex;
  flex-direction: column;
  width: min(560px, calc(100vw - 32px));
  max-height: calc(100vh - 64px);
  color: #dbeaff;
  font:
    13px/1.5 system-ui,
    'PingFang SC',
    'Microsoft YaHei',
    sans-serif;
  background: var(--ed-bg-1, #0b1a33);
  border: 1px solid var(--ed-line, rgba(83, 196, 255, 0.2));
  border-radius: 6px;
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.5);
}
.sld-tm-head {
  padding: 10px 14px;
  font-weight: 600;
  border-bottom: 1px solid var(--ed-line, rgba(83, 196, 255, 0.2));
}
.sld-tm-body {
  padding: 12px 14px;
  overflow: auto;
}
.sld-tm-foot {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 14px;
  border-top: 1px solid var(--ed-line, rgba(83, 196, 255, 0.2));
}
.sld-tm-grow {
  flex: 1;
}
.sld-tm-btn {
  padding: 4px 14px;
  color: inherit;
  font: inherit;
  font-size: 12px;
  background: transparent;
  border: 1px solid var(--ed-line, rgba(83, 196, 255, 0.2));
  border-radius: 4px;
  cursor: pointer;
}
.sld-tm-btn:hover:not(:disabled) {
  border-color: var(--ed-accent, #19b7ff);
}
.sld-tm-btn:disabled {
  opacity: 0.4;
  cursor: default;
}
.sld-tm-btn-primary {
  color: #061024;
  background: var(--ed-accent, #19b7ff);
  border-color: var(--ed-accent, #19b7ff);
}
/* 表单行:对话框与浮层共用 */
.sld-tf-row {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 30px;
}
.sld-tf-row > .sld-tf-label {
  flex: none;
  width: 84px;
  opacity: 0.65;
}
.sld-tf-row input[type='number'],
.sld-tf-row input[type='text'],
.sld-tf-row select {
  width: 90px;
  padding: 3px 6px;
  color: inherit;
  font: inherit;
  background: var(--ed-bg-0, #061024);
  border: 1px solid var(--ed-line, rgba(83, 196, 255, 0.2));
  border-radius: 4px;
  outline: none;
}
.sld-tf-row input:focus,
.sld-tf-row select:focus {
  border-color: var(--ed-accent, #19b7ff);
}
.sld-tf-row label {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  cursor: pointer;
}
.sld-tf-hint {
  margin: 4px 0;
  font-size: 12px;
  opacity: 0.55;
}
</style>
