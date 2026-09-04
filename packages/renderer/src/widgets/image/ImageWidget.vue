<script setup lang="ts">
/** 图片:静态图(props.src)或绑定得到的地址(src 槽位,const / attr);一期 main 槽位用它放接线图截图 / 站点照片。 */
import { computed, ref, watch } from 'vue'

const props = withDefaults(
  defineProps<{
    src?: string
    alt?: string
    fit?: 'contain' | 'cover' | 'fill'
    title?: string
    values?: Record<string, unknown>
    errors?: Record<string, string>
    disabled?: boolean
  }>(),
  { src: '', alt: '', fit: 'contain', title: '', values: () => ({}), errors: () => ({}), disabled: false }
)
const url = computed(() => {
  const v = props.values.src
  return typeof v === 'string' && v ? v : props.src
})
const failed = ref(false)
watch(url, () => (failed.value = false))
</script>

<template>
  <div class="sr-image" :class="{ 'sr-error': errors.src || failed }">
    <div v-if="title" class="sr-image-title">{{ title }}</div>
    <div class="sr-image-body">
      <div v-if="errors.src" class="sr-empty-hint" :title="errors.src">图片地址不可用</div>
      <div v-else-if="!url" class="sr-empty-hint">未设置图片</div>
      <div v-else-if="failed" class="sr-empty-hint">图片加载失败</div>
      <img v-else :src="url" :alt="alt" :style="{ objectFit: fit }" @error="failed = true" />
    </div>
  </div>
</template>

<style>
.sr-image {
  width: 100%;
  height: 100%;
  box-sizing: border-box;
  border: 1px solid var(--sr-line-0);
  border-radius: var(--sr-radius);
  background: var(--sr-bg-1);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.sr-image-title {
  padding: 10px 14px 6px;
  font-family: var(--sr-font-title);
  font-size: 15px;
  letter-spacing: 0.06em;
  color: var(--sr-ink-0);
  border-bottom: 1px solid var(--sr-line-0);
}
.sr-image-body {
  flex: 1;
  min-height: 0;
  position: relative;
}
.sr-image-body img {
  width: 100%;
  height: 100%;
  display: block;
}
</style>
