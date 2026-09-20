<script setup lang="ts">
/** 「按键说明」浮层:内容由 shortcuts.ts 从工具栏同一份按键表生成;Esc 或点遮罩关闭。 */
import { computed } from 'vue'
import { helpSections, type HelpTool } from './shortcuts'

const props = defineProps<{ tools: HelpTool[] }>()
const emit = defineEmits<{ close: [] }>()
const sections = computed(() => helpSections(props.tools))
</script>

<template>
  <div class="sld-help-mask" data-role="help" @click.self="emit('close')" @keydown.esc="emit('close')">
    <div class="sld-help">
      <header>
        <b>接线图编辑器 · 按键说明</b>
        <button type="button" class="sld-help-x" title="关闭(Esc)" @click="emit('close')">✕</button>
      </header>
      <div class="sld-help-body">
        <section v-for="s in sections" :key="s.title">
          <h4>{{ s.title }}</h4>
          <dl>
            <template v-for="(it, i) in s.items" :key="i">
              <dt>
                <kbd v-if="it.keys">{{ it.keys }}</kbd
                ><span v-else>·</span>
              </dt>
              <dd>{{ it.text }}</dd>
            </template>
          </dl>
        </section>
      </div>
      <footer>画完点右上「完成」写回页面;整张图在页面编辑器里算一步撤销。</footer>
    </div>
  </div>
</template>

<style scoped>
.sld-help-mask {
  position: absolute;
  inset: 0;
  z-index: 40;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(2, 10, 26, 0.55);
}
.sld-help {
  width: min(720px, 92%);
  max-height: 86%;
  display: flex;
  flex-direction: column;
  background: var(--sld-bg-1, var(--ed-bg-1, #0b1a33));
  border: 1px solid var(--sld-line, var(--ed-line, rgba(83, 196, 255, 0.32)));
  border-radius: 8px;
  box-shadow: 0 16px 40px rgba(0, 0, 0, 0.5);
}
.sld-help header,
.sld-help footer {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border-bottom: 1px solid var(--sld-line, rgba(83, 196, 255, 0.2));
  font-size: 13px;
}
.sld-help footer {
  border-bottom: none;
  border-top: 1px solid var(--sld-line, rgba(83, 196, 255, 0.2));
  opacity: 0.75;
  font-size: 12px;
}
.sld-help-x {
  margin-left: auto;
  background: none;
  border: none;
  color: inherit;
  font: inherit;
  cursor: pointer;
}
.sld-help-body {
  overflow: auto;
  padding: 4px 12px 10px;
}
.sld-help h4 {
  margin: 12px 0 6px;
  font-size: 12px;
  opacity: 0.7;
  font-weight: 600;
}
.sld-help dl {
  display: grid;
  grid-template-columns: 170px 1fr;
  gap: 4px 10px;
  margin: 0;
  font-size: 12.5px;
}
.sld-help dt {
  text-align: right;
  opacity: 0.9;
}
.sld-help dd {
  margin: 0;
}
.sld-help kbd {
  display: inline-block;
  padding: 1px 6px;
  border: 1px solid var(--sld-line, rgba(83, 196, 255, 0.32));
  border-radius: 4px;
  background: rgba(255, 255, 255, 0.04);
  font: inherit;
  font-size: 12px;
  white-space: nowrap;
}
</style>
