<script setup lang="ts">
/** 卡片外框:标题 + 副标 + 右侧键值(当前值等)。图表 / 列表类组件共用,样式对齐现有大屏 .card。 */
withDefaults(
  defineProps<{
    title?: string
    subtitle?: string
    sideLabel?: string
    sideValue?: string
    sideColor?: string
    alarming?: boolean
    error?: string
  }>(),
  { title: '', subtitle: '', sideLabel: '', sideValue: '', sideColor: '', alarming: false, error: '' }
)
</script>

<template>
  <div class="sr-card sr-frame" :class="{ 'sr-alarming': alarming, 'sr-error': !!error }">
    <div class="sr-card-head">
      <span class="sr-card-title"
        >{{ title }}<span v-if="subtitle" class="sr-card-en">{{ subtitle }}</span></span
      >
      <div v-if="error" class="sr-card-side">
        <div class="sr-side-k">数据不可用</div>
        <div class="sr-side-v sr-side-err" :title="error">!</div>
      </div>
      <div v-else-if="sideLabel || sideValue" class="sr-card-side">
        <div class="sr-side-k">{{ sideLabel }}</div>
        <div class="sr-side-v" :style="sideColor ? { color: sideColor } : undefined">{{ sideValue }}</div>
      </div>
    </div>
    <div class="sr-card-body">
      <slot />
    </div>
  </div>
</template>

<style>
.sr-card {
  width: 100%;
  height: 100%;
  box-sizing: border-box;
  border: 1px solid var(--sr-line-0);
  border-radius: var(--sr-radius);
  background: var(--sr-bg-1);
  display: flex;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
}
.sr-frame.sr-alarming {
  border-color: var(--sr-bad);
  box-shadow: 0 0 0 1px color-mix(in srgb, var(--sr-bad) 40%, transparent) inset;
}
.sr-card-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 14px 6px;
  border-bottom: 1px solid var(--sr-line-0);
}
.sr-card-title {
  font-family: var(--sr-font-title);
  font-size: 15px;
  letter-spacing: 0.06em;
  color: var(--sr-ink-0);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.sr-card-en {
  margin-left: 8px;
  font-family: var(--sr-font-num);
  font-size: max(11px, calc(var(--sr-min-text, 10px) * 0.85 / var(--sr-scale, 1)));
  letter-spacing: 0.12em;
  color: var(--sr-ink-2);
}
.sr-card-side {
  text-align: right;
  flex: none;
}
.sr-side-k {
  font-size: max(10px, calc(var(--sr-min-text, 10px) * 0.85 / var(--sr-scale, 1)));
  letter-spacing: 0.12em;
  color: var(--sr-ink-2);
}
.sr-side-v {
  font-family: var(--sr-font-num);
  font-size: 15px;
  color: var(--sr-ink-0);
  line-height: 1.2;
}
.sr-side-err {
  color: var(--sr-bad);
}
.sr-card-body {
  flex: 1;
  min-height: 0;
  position: relative;
  padding: 6px 8px 8px;
}
.sr-chart-box {
  width: 100%;
  height: 100%;
  min-height: 90px;
}
.sr-empty-hint {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--sr-ink-2);
  font-size: max(12px, calc(var(--sr-min-text, 10px) / var(--sr-scale, 1)));
  letter-spacing: 0.08em;
  pointer-events: none;
}
</style>
