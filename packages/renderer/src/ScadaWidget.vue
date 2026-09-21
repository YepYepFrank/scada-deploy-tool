<script setup lang="ts">
/**
 * <ScadaWidget :config :dataSource? :theme :design>
 * 单张卡片入口(2026-09-14,给宿主应用把某张卡单独嵌进自己的页面):一份 WidgetConfig(slot 可省)→ 校验 → 绑定 → 渲染。
 * 与 <ScadaPage> 共用注册表校验(validateWidgetAgainstRegistry)与绑定运行时(useBindingRuntime),不复制逻辑。
 * 尺寸由宿主容器决定(width/height: 100%),不做整页缩放(--sr-scale 固定 1);主题令牌在根节点生效,祖先上覆盖 --sr-* 即可换色。
 */
import { computed, inject, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { DataSource } from '@grid/tb-client'
import type { WidgetConfig } from './schema/page-config'
import type { WidgetEventPayload } from './schema/scada-page'
import { getWidget, validateWidgetAgainstRegistry } from './registry'
import { clickEventOf, toWidgetEvent, useBindingRuntime, widgetPropsOf } from './widget-runtime'
import { contextKeysOf, contextSignature, type BindingContext } from './binding-context'
import { BINDING_CONTEXT_KEY, DATA_SOURCE_KEY } from './provide'
import WidgetExpand from './WidgetExpand.vue'
import ContextState from './ContextState.vue'

export interface ScadaWidgetProps {
  /** 一张卡的配置(通常是 pickWidget(pageConfig, widgetId) 取出来的);slot 字段可以没有,有也忽略 */
  config: WidgetConfig
  /** 数据源;缺省用 provideDataSource() 注入的 */
  dataSource?: DataSource
  /** 主题名,对应 .sr-theme-<name>;默认 default */
  theme?: string
  /** 编辑态:用组件 sampleData 渲染,不建立订阅 */
  design?: boolean
  /** 右上角「放大」按钮(铺满视口再渲染一份,共用同一份值);默认 true,design 态不显示 */
  expandable?: boolean
  /** 绑定上下文(0.9.0):同 <ScadaPage>;缺省用 provideBindingContext() 注入的,props 优先 */
  bindingContext?: BindingContext | null
}
const props = withDefaults(defineProps<ScadaWidgetProps>(), { design: false, expandable: true })
const emit = defineEmits<{
  (e: 'invalid', issues: { path: string; message: string }[]): void
  (e: 'bindError', widgetId: string, slot: string, message: string): void
  /** 放大 / 关闭:放大时给组件 id,关闭时 null */
  (e: 'expand', widgetId: string | null): void
  /** 组件事件透传(与 <ScadaPage> 同):组件内 emit('widget-event', { name, detail }),补上 widgetId / type 抛给宿主 */
  (e: 'widget-event', payload: WidgetEventPayload): void
}>()
const expanded = ref(false)
function expand(on: boolean) {
  expanded.value = on
  emit('expand', on ? props.config.id : null)
}

const injected = inject<DataSource | null>(DATA_SOURCE_KEY, null)
const ds = computed<DataSource | null>(() => props.dataSource ?? injected)
const injectedCtx = inject<BindingContext | null>(BINDING_CONTEXT_KEY, null)
const ctx = computed<BindingContext | null>(() => props.bindingContext ?? injectedCtx ?? null)
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
  rt.setup([props.config], ds.value, props.design, ctx.value)
}
onMounted(setup)
watch(() => props.config, setup, { deep: true })
watch(ds, setup)
watch(() => props.design, setup)
// 上下文里被引用的键变了才重订(换设备 / 换测点 / 换时间范围)
watch(() => contextSignature([props.config], ctx.value), setup)
onBeforeUnmount(rt.teardown)

const widgetProps = computed(() => widgetPropsOf(props.config, rt.resolved[props.config.id]))
const ctxState = computed(() => rt.ctxStates[props.config.id])
/** 这张卡要宿主喂哪些上下文键 */
const contextKeys = computed(() => contextKeysOf([props.config]))
function onClick() {
  if (!props.design) emit('widget-event', clickEventOf(props.config, rt.resolved[props.config.id]))
}
/** 组件抛的 widget-event:补 widgetId / type 后向外抛;形状不对的忽略 */
function onWidgetEvent(ev: unknown) {
  const payload = toWidgetEvent(props.config, ev)
  if (payload) emit('widget-event', payload)
}
const themeClass = computed(() => `sr-theme-${props.theme ?? 'default'}`)

defineExpose({
  issues,
  values: rt.values,
  bindErrors: rt.bindErrors,
  ctxStates: rt.ctxStates,
  contextKeys,
  stats: rt.stats,
})
</script>

<template>
  <div
    v-show="ctxState?.status !== 'hide'"
    class="sr-page sr-widget-standalone"
    :class="[themeClass, { 'sr-design': design }]"
  >
    <div v-if="!def || blocking.length" class="sr-fatal sr-widget-fatal">
      <div class="sr-fatal-title">卡片无法渲染</div>
      <div class="sr-fatal-msg">{{ blocking.map(i => i.message).join(';') || `未知组件类型 "${config.type}"` }}</div>
    </div>
    <div
      v-else
      class="sr-widget"
      :data-widget="config.id"
      :data-type="config.type"
      :data-ctx-state="ctxState?.status"
      @click="onClick"
    >
      <ContextState v-if="ctxState" :state="ctxState" :title="String(widgetProps.title ?? '')" />
      <component
        :is="def.component"
        v-else
        v-bind="widgetProps"
        :values="rt.values[config.id] ?? {}"
        :errors="rt.bindErrors[config.id] ?? {}"
        :disabled="!!config.actions"
        @widget-event="onWidgetEvent"
      />
      <button
        v-if="expandable && !design && !ctxState"
        type="button"
        class="sr-expand-btn"
        title="放大这个组件"
        aria-label="放大"
        data-role="expand"
        @click.stop="expand(true)"
      >
        ⤢
      </button>
    </div>
    <WidgetExpand
      v-if="expanded && def && !blocking.length"
      :config="config"
      :def="def"
      :widget-props="widgetProps"
      :values="rt.values[config.id] ?? {}"
      :errors="rt.bindErrors[config.id] ?? {}"
      :disabled="!!config.actions"
      :theme="theme ?? 'default'"
      @close="expand(false)"
      @widget-event="emit('widget-event', $event)"
    />
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
