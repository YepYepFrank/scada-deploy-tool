<script setup lang="ts">
/**
 * <ScadaWidget :config :dataSource? :theme :design>
 * 单张卡片入口(2026-09-14,给宿主应用把某张卡单独嵌进自己的页面):一份 WidgetConfig(slot 可省)→ 校验 → 绑定 → 渲染。
 * 与 <ScadaPage> 共用注册表校验(validateWidgetAgainstRegistry)与绑定运行时(useBindingRuntime),不复制逻辑。
 * 尺寸由宿主容器决定(width/height: 100%),不做整页缩放(--sr-scale 固定 1);主题令牌在根节点生效,祖先上覆盖 --sr-* 即可换色。
 */
import { computed, inject, onBeforeUnmount, onMounted, watch } from 'vue'
import type { DataSource } from '@grid/tb-client'
import type { WidgetConfig } from './schema/page-config'
import { getWidget, validateWidgetAgainstRegistry } from './registry'
import { useBindingRuntime, widgetPropsOf } from './widget-runtime'
import { DATA_SOURCE_KEY } from './provide'

export interface ScadaWidgetProps {
  /** 一张卡的配置(通常是 pickWidget(pageConfig, widgetId) 取出来的);slot 字段可以没有,有也忽略 */
  config: WidgetConfig
  /** 数据源;缺省用 provideDataSource() 注入的 */
  dataSource?: DataSource
  /** 主题名,对应 .sr-theme-<name>;默认 default */
  theme?: string
  /** 编辑态:用组件 sampleData 渲染,不建立订阅 */
  design?: boolean
}
const props = withDefaults(defineProps<ScadaWidgetProps>(), { design: false })
const emit = defineEmits<{
  (e: 'invalid', issues: { path: string; message: string }[]): void
  (e: 'bindError', widgetId: string, slot: string, message: string): void
}>()

const injected = inject<DataSource | null>(DATA_SOURCE_KEY, null)
const ds = computed<DataSource | null>(() => props.dataSource ?? injected)
const def = computed(() => getWidget(props.config.type))

// 校验:结构问题阻断;design 下绑定缺失不算(与 ScadaPage 一致)
const issues = computed(() => validateWidgetAgainstRegistry(props.config))
const blocking = computed(() =>
  issues.value.filter(i => i.level === 'error' && !(props.design && i.path.includes('/bindings')))
)
watch(
  blocking,
  b => {
    if (b.length) emit('invalid', b)
  },
  { immediate: true }
)

const rt = useBindingRuntime((wid, slot, msg) => emit('bindError', wid, slot, msg))
function setup() {
  if (!def.value || blocking.value.length) {
    rt.teardown()
    return
  }
  rt.setup([props.config], ds.value, props.design)
}
onMounted(setup)
watch(() => props.config, setup, { deep: true })
watch(ds, setup)
watch(() => props.design, setup)
onBeforeUnmount(rt.teardown)

const widgetProps = computed(() => widgetPropsOf(props.config))
const themeClass = computed(() => `sr-theme-${props.theme ?? 'default'}`)

defineExpose({ issues, values: rt.values, bindErrors: rt.bindErrors })
</script>

<template>
  <div class="sr-page sr-widget-standalone" :class="[themeClass, { 'sr-design': design }]">
    <div v-if="!def || blocking.length" class="sr-fatal sr-widget-fatal">
      <div class="sr-fatal-title">卡片无法渲染</div>
      <div class="sr-fatal-msg">{{ blocking.map(i => i.message).join(';') || `未知组件类型 "${config.type}"` }}</div>
    </div>
    <div v-else class="sr-widget" :data-widget="config.id" :data-type="config.type">
      <component
        :is="def.component"
        v-bind="widgetProps"
        :values="rt.values[config.id] ?? {}"
        :errors="rt.bindErrors[config.id] ?? {}"
        :disabled="!!config.actions"
      />
    </div>
  </div>
</template>

<style>
.sr-widget-standalone {
  --sr-scale: 1;
  position: relative;
  box-sizing: border-box;
  width: 100%;
  height: 100%;
  color: var(--sr-ink-0);
  font-family: var(--sr-font-body);
}
.sr-widget-standalone > .sr-widget {
  width: 100%;
  height: 100%;
}
.sr-widget-fatal {
  box-sizing: border-box;
  height: 100%;
  padding: 12px;
  font-size: 12px;
  overflow: auto;
}
</style>
