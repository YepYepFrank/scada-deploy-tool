<script setup lang="ts">
/**
 * 组件放大层(2026-09-16):把一个组件铺满整个视口再渲染一份。
 * - Teleport 到 body、position: fixed,不受模板缩放影响(--sr-scale 固定 1);根节点自带主题类,令牌照常生效;
 * - 用的是同一份 values / errors(按组件 id 共享的响应式状态),**不新建订阅**;关掉即卸载;
 * - 组件抛的 widget-event 补上 widgetId / type 后原样上抛,由 ScadaPage / ScadaWidget 再抛给宿主;
 * - Esc / 右上角 ✕ 关闭;「浏览器全屏」按钮走 Fullscreen API(可选,浏览器不允许时只用覆盖层)。
 */
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import type { WidgetConfig } from './schema/page-config'
import type { WidgetDefinition } from './schema/registry'
import type { WidgetEventPayload } from './schema/scada-page'
import type { SlotValue } from './binding-resolver'
import { toWidgetEvent } from './widget-runtime'

const props = defineProps<{
  config: WidgetConfig
  def: WidgetDefinition
  widgetProps: Record<string, unknown>
  values: Record<string, SlotValue>
  errors: Record<string, string>
  disabled?: boolean
  theme: string
}>()
const emit = defineEmits<{
  (e: 'close'): void
  (e: 'widget-event', payload: WidgetEventPayload): void
}>()
function onWidgetEvent(ev: unknown) {
  const payload = toWidgetEvent(props.config, ev)
  if (payload) emit('widget-event', payload)
}

const root = ref<HTMLElement | null>(null)
const title = computed(() => {
  const t = props.widgetProps.title
  return typeof t === 'string' && t.trim() ? t : props.def.name
})
function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    e.stopPropagation()
    emit('close')
  }
}
const isFs = ref(false)
function onFsChange() {
  isFs.value = !!document.fullscreenElement && document.fullscreenElement === root.value
}
async function toggleFs() {
  try {
    if (document.fullscreenElement === root.value) await document.exitFullscreen()
    else await root.value?.requestFullscreen?.()
  } catch {
    /* 浏览器不允许时只用覆盖层 */
  }
}
async function close() {
  if (document.fullscreenElement === root.value) await document.exitFullscreen().catch(() => {})
  emit('close')
}
onMounted(() => {
  window.addEventListener('keydown', onKey, true)
  document.addEventListener('fullscreenchange', onFsChange)
})
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKey, true)
  document.removeEventListener('fullscreenchange', onFsChange)
  if (document.fullscreenElement === root.value) void document.exitFullscreen().catch(() => {})
})
</script>

<template>
  <Teleport to="body">
    <div
      ref="root"
      class="sr-page sr-expand"
      :class="`sr-theme-${theme}`"
      role="dialog"
      :aria-label="`放大:${title}`"
      :data-expand="config.id"
    >
      <div class="sr-expand-bar">
        <span class="sr-expand-title">{{ title }}</span>
        <span class="sr-expand-type">{{ def.name }}</span>
        <button
          type="button"
          class="sr-expand-fs"
          :title="isFs ? '退出浏览器全屏' : '浏览器全屏'"
          data-role="expand-fullscreen"
          @click="toggleFs"
        >
          {{ isFs ? '退出全屏' : '浏览器全屏' }}
        </button>
        <button type="button" class="sr-expand-close" title="关闭(Esc)" data-role="expand-close" @click="close">
          ✕
        </button>
      </div>
      <div class="sr-expand-body">
        <div class="sr-widget" :data-widget="config.id" :data-type="config.type">
          <component
            :is="def.component"
            v-bind="widgetProps"
            :values="values"
            :errors="errors"
            :disabled="disabled"
            @widget-event="onWidgetEvent"
          />
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style>
/* 组件右上角的「放大」按钮(ScadaPage / ScadaWidget 共用):悬停 / 键盘聚焦时才显示,不挡内容 */
.sr-expand-btn {
  position: absolute;
  top: 6px;
  right: 6px;
  z-index: 5;
  width: 24px;
  height: 24px;
  padding: 0;
  border: 1px solid var(--sr-line-1);
  border-radius: var(--sr-radius, 6px);
  background: color-mix(in srgb, var(--sr-bg-1, #061c40) 85%, transparent);
  color: var(--sr-ink-1);
  font-size: 14px;
  line-height: 22px;
  text-align: center;
  cursor: pointer;
  opacity: 0;
  transition: opacity 0.15s;
}
.sr-widget:hover > .sr-expand-btn,
.sr-widget:focus-within > .sr-expand-btn,
.sr-expand-btn:focus-visible {
  opacity: 1;
}
.sr-expand-btn:hover {
  border-color: var(--sr-accent);
  color: var(--sr-ink-0);
}
@media (hover: none) {
  .sr-expand-btn {
    opacity: 0.7;
  }
}
/* 写成 .sr-page.sr-expand 提高特异性:ScadaPage 的 .sr-page { position: relative; height: 100% } 在样式表里排在后面 */
.sr-page.sr-expand {
  --sr-scale: 1;
  position: fixed;
  inset: 0;
  width: 100vw;
  height: 100vh;
  z-index: 1000;
  display: flex;
  flex-direction: column;
  box-sizing: border-box;
  padding: 10px 16px 16px;
  background: var(--sr-bg-0, #041634);
  color: var(--sr-ink-0);
  font-family: var(--sr-font-body);
}
.sr-expand-bar {
  display: flex;
  align-items: center;
  gap: 10px;
  flex: 0 0 auto;
  height: 36px;
  margin-bottom: 8px;
}
.sr-expand-title {
  font-family: var(--sr-font-title);
  font-size: 18px;
  letter-spacing: 0.06em;
}
.sr-expand-type {
  font-size: 12px;
  color: var(--sr-ink-2);
  margin-right: auto;
}
.sr-expand-fs,
.sr-expand-close {
  background: transparent;
  border: 1px solid var(--sr-line-1);
  border-radius: var(--sr-radius, 6px);
  color: var(--sr-ink-1);
  font: inherit;
  font-size: 12px;
  padding: 4px 10px;
  cursor: pointer;
}
.sr-expand-close {
  font-size: 14px;
  line-height: 1;
  padding: 5px 9px;
}
.sr-expand-fs:hover,
.sr-expand-close:hover {
  border-color: var(--sr-accent);
  color: var(--sr-ink-0);
}
.sr-expand-body {
  flex: 1 1 auto;
  min-height: 0;
}
.sr-expand-body > .sr-widget {
  width: 100%;
  height: 100%;
}
</style>
