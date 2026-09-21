<script setup lang="ts">
/**
 * 缺上下文 / 上下文不对时顶替组件画的占位(0.9.0)。
 * empty = 中性空态(「未选择设备」),不是报错,不用红色;error = 错误态,与 CardFrame 的「数据不可用」同一套观感。
 * hide 不会走到这里(外层 v-show 掉了)。
 */
import CardFrame from './widgets/_shared/CardFrame.vue'
import type { WidgetContextState } from './widget-runtime'

defineProps<{ state: WidgetContextState; title?: string }>()
</script>

<template>
  <CardFrame :title="title ?? ''" :error="state.status === 'error' ? state.message : ''">
    <div class="sr-empty-hint sr-ctx-hint" :class="`sr-ctx-${state.status}`" data-role="ctx-state">
      {{ state.message }}
    </div>
  </CardFrame>
</template>

<style>
.sr-ctx-hint.sr-ctx-error {
  padding: 0 12%;
  text-align: center;
  line-height: 1.6;
  letter-spacing: 0.02em;
  color: var(--sr-bad);
}
</style>
