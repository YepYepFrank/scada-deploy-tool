<script setup lang="ts">
/**
 * <ScadaPage :config :dataSource? :showStatus :design :theme>
 * 渲染器根组件:校验 → 取模板 → 按 slot 放组件 → 绑定解析 → 连接状态徽标。
 * 组件本身不知道业务;所有业务在 config 里。props 契约见 schema/scada-page.ts。
 */
import { computed, inject, nextTick, onBeforeUnmount, onMounted, reactive, ref, shallowRef, watch } from 'vue'
import type { ConnectionStatus, DataSource } from '@grid/tb-client'
import type { PageConfig, WidgetConfig } from './schema/page-config'
import { SCHEMA_VERSION } from './schema/page-config'
import type { ScadaPageProps } from './schema/scada-page'
import type { TemplateDefinition, WidgetDefinition } from './schema/registry'
import { getTemplate, getWidget, validateAgainstRegistry, type RegistryIssue } from './registry'
import { resolveBindings, type ResolverHandle, type SlotValue } from './binding-resolver'
import { computeScale, rootStyle, slotStyle, wrapperStyle } from './layout/template-style'
import { DATA_SOURCE_KEY } from './provide'

const props = withDefaults(defineProps<ScadaPageProps>(), { showStatus: false, design: false })
const emit = defineEmits<{
  (e: 'invalid', issues: { path: string; message: string }[]): void
  (e: 'status', status: ConnectionStatus): void
}>()

const injected = inject<DataSource | null>(DATA_SOURCE_KEY, null)
const ds = computed<DataSource | null>(() => props.dataSource ?? injected)

// ---------- 校验 ----------
const issues = ref<RegistryIssue[]>([])
const fatal = ref<string | null>(null)
const tpl = shallowRef<TemplateDefinition | null>(null)

function validate(cfg: PageConfig) {
  fatal.value = null
  issues.value = []
  tpl.value = null
  if (!cfg || typeof cfg !== 'object' || cfg.schemaVersion !== SCHEMA_VERSION) {
    fatal.value = `不支持的 schemaVersion:${(cfg as PageConfig | undefined)?.schemaVersion ?? '(缺失)'}(渲染器支持 ${SCHEMA_VERSION})`
    emit('invalid', [{ path: '/schemaVersion', message: fatal.value }])
    return
  }
  const found = validateAgainstRegistry(cfg)
  issues.value = found
  const t = getTemplate(cfg.template)
  if (!t) {
    fatal.value = `未知模板 "${cfg.template}"`
  }
  tpl.value = t ?? null
  const errors = found.filter(i => i.level === 'error')
  if (errors.length || fatal.value)
    emit('invalid', [...(fatal.value ? [{ path: '/template', message: fatal.value }] : []), ...errors])
}

/**
 * 每个组件的阻断性问题(有则该槽位渲染错误态)。
 * 设计态(design)只把结构问题(未知类型 / 槽位不匹配 / id 重复)当阻断,绑定缺失不算:
 * 编辑器刚放进去的组件绑定为空,仍要用 sampleData 画出缩略图。
 */
const widgetErrors = computed(() => {
  const m = new Map<string, string[]>()
  for (const i of issues.value) {
    if (i.level !== 'error') continue
    if (props.design && i.path.includes('/bindings')) continue
    const mm = /^\/widgets\/([^/]+)/.exec(i.path)
    if (mm) (m.get(mm[1]!) ?? m.set(mm[1]!, []).get(mm[1]!)!).push(i.message)
  }
  return m
})

// ---------- 槽位 → 组件 ----------
interface Placed {
  slot: TemplateDefinition['slots'][number]
  widgets: { cfg: WidgetConfig; def: WidgetDefinition | undefined }[]
}
const placed = computed<Placed[]>(() => {
  const t = tpl.value
  if (!t) return []
  return t.slots.map(slot => ({
    slot,
    widgets: props.config.widgets
      .filter(w => w.slot === slot.name && !widgetErrors.value.has(w.id))
      .map(cfg => ({ cfg, def: getWidget(cfg.type) })),
  }))
})

// ---------- 绑定 ----------
const values = reactive<Record<string, Record<string, SlotValue>>>({})
const bindErrors = reactive<Record<string, Record<string, string>>>({})
let handle: ResolverHandle | null = null

function teardown() {
  handle?.dispose()
  handle = null
}
function setup() {
  teardown()
  for (const k of Object.keys(values)) delete values[k]
  for (const k of Object.keys(bindErrors)) delete bindErrors[k]
  if (fatal.value || !tpl.value) return
  const cfg: PageConfig = { ...props.config, widgets: props.config.widgets.filter(w => !widgetErrors.value.has(w.id)) }
  if (props.design || !ds.value) {
    // 编辑态 / 无数据源:用 sampleData
    for (const w of cfg.widgets) {
      const def = getWidget(w.type)
      const sample = def?.sampleData?.() ?? {}
      values[w.id] = { ...sample }
      for (const [slot, b] of Object.entries(w.bindings)) {
        const one = Array.isArray(b) ? b[0] : b
        if (one && one.mode === 'const') values[w.id]![slot] = one.value as SlotValue
      }
    }
    return
  }
  handle = resolveBindings(cfg, ds.value, {
    onValue: (wid, slot, v) => {
      ;(values[wid] ??= {})[slot] = v
    },
    onError: (wid, slot, err) => {
      ;(bindErrors[wid] ??= {})[slot] = err instanceof Error ? err.message : String(err)
    },
    slotSpec: (w, slot) => getWidget(w.type)?.bindingSlots.find(s => s.name === slot),
  })
}

// ---------- 连接状态 ----------
const status = ref<ConnectionStatus>('connecting')
let offStatus: (() => void) | null = null
function watchStatus() {
  offStatus?.()
  offStatus = null
  const d = ds.value
  if (!d) {
    status.value = props.design ? 'live' : 'offline'
    return
  }
  status.value = d.status
  offStatus = d.onStatus(s => {
    status.value = s
    emit('status', s)
  })
}

// ---------- 缩放 ----------
const wrapper = ref<HTMLElement | null>(null)
const scale = ref(1)
let ro: ResizeObserver | null = null
function measure() {
  const t = tpl.value
  const el = wrapper.value?.parentElement
  if (!t || t.kind !== 'scaled' || !el) {
    scale.value = 1
    return
  }
  scale.value = computeScale(t.design!, { w: el.clientWidth, h: el.clientHeight })
}

// 校验在 setup 阶段同步执行:首次渲染即带模板,onMounted 时 wrapper 已在 DOM 中可量尺寸
validate(props.config)

function observeContainer() {
  ro?.disconnect()
  ro = null
  const el = wrapper.value?.parentElement
  if (typeof ResizeObserver !== 'undefined' && el) {
    ro = new ResizeObserver(measure)
    ro.observe(el)
  }
}

onMounted(async () => {
  setup()
  watchStatus()
  await nextTick()
  measure()
  observeContainer()
})
watch(
  () => props.config,
  async cfg => {
    validate(cfg)
    setup()
    await nextTick()
    measure()
    observeContainer()
  },
  { deep: true }
)
watch(ds, () => {
  setup()
  watchStatus()
})
watch(() => props.design, setup)
onBeforeUnmount(() => {
  teardown()
  offStatus?.()
  ro?.disconnect()
})

defineExpose({ issues, status, values })
</script>

<template>
  <div class="sr-page" :class="[`sr-theme-${theme ?? config.theme ?? 'default'}`, { 'sr-design': design }]">
    <div v-if="fatal" class="sr-fatal">
      <div class="sr-fatal-title">页面无法渲染</div>
      <div class="sr-fatal-msg">{{ fatal }}</div>
    </div>

    <template v-else-if="tpl">
      <div ref="wrapper" class="sr-wrapper" :style="wrapperStyle(tpl, scale)">
        <div class="sr-root" :data-template="tpl.id" :style="rootStyle(tpl, scale)">
          <div
            v-for="p in placed"
            :key="p.slot.name"
            class="sr-slot"
            :class="{ 'sr-slot-empty': !p.widgets.length }"
            :data-slot="p.slot.name"
            :style="slotStyle(tpl, p.slot)"
          >
            <template v-if="p.widgets.length">
              <div
                v-for="w in p.widgets"
                :key="w.cfg.id"
                class="sr-widget"
                :data-widget="w.cfg.id"
                :data-type="w.cfg.type"
              >
                <component
                  :is="w.def!.component"
                  v-bind="{ ...(w.def!.defaults ?? {}), ...(w.cfg.props ?? {}) }"
                  :values="values[w.cfg.id] ?? {}"
                  :errors="bindErrors[w.cfg.id] ?? {}"
                  :disabled="!!w.cfg.actions"
                />
              </div>
            </template>
            <div v-else class="sr-slot-placeholder">
              <span class="sr-slot-name">{{ p.slot.title ?? p.slot.name }}</span>
              <span v-if="p.slot.accepts" class="sr-slot-accepts">{{ p.slot.accepts.join(' / ') }}</span>
            </div>
          </div>
        </div>
      </div>

      <div v-if="showStatus && status !== 'live'" class="sr-status" :data-status="status">
        {{ status === 'connecting' ? '连接中…' : '离线 · 重连中' }}
      </div>
      <div v-if="widgetErrors.size" class="sr-issues">
        <div v-for="[wid, msgs] in widgetErrors" :key="wid" class="sr-issue">
          <b>{{ wid }}</b> {{ msgs.join(';') }}
        </div>
      </div>
    </template>
  </div>
</template>

<style>
.sr-page {
  position: relative;
  width: 100%;
  height: 100%;
  color: var(--sr-ink-0);
  font-family: var(--sr-font-body);
}
.sr-wrapper {
  margin: 0 auto;
}
.sr-slot {
  box-sizing: border-box;
}
.sr-widget {
  width: 100%;
  height: 100%;
}
.sr-slot-placeholder {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4px;
  border: 1px dashed var(--sr-line-1);
  border-radius: var(--sr-radius);
  color: var(--sr-ink-2);
  font-size: 12px;
  letter-spacing: 0.08em;
}
.sr-slot-accepts {
  font-size: 10px;
  opacity: 0.7;
}
.sr-fatal {
  padding: 24px;
  border: 1px solid var(--sr-bad);
  border-radius: var(--sr-radius);
  color: var(--sr-bad);
  background: color-mix(in srgb, var(--sr-bad) 8%, transparent);
}
.sr-fatal-title {
  font-weight: 600;
  margin-bottom: 6px;
}
.sr-status {
  position: absolute;
  top: 8px;
  right: 8px;
  padding: 4px 10px;
  border-radius: 999px;
  font-size: 12px;
  background: var(--sr-warn);
  color: #1a1a1a;
}
.sr-status[data-status='offline'] {
  background: var(--sr-bad);
  color: #fff;
}
.sr-issues {
  position: absolute;
  left: 8px;
  bottom: 8px;
  max-width: 60%;
  font-size: 11px;
  color: var(--sr-bad);
  background: rgba(0, 0, 0, 0.5);
  padding: 6px 8px;
  border-radius: var(--sr-radius);
}
</style>
