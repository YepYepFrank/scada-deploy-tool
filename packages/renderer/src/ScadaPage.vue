<script setup lang="ts">
/**
 * <ScadaPage :config :dataSource? :showStatus :design :theme>
 * 渲染器根组件:校验 → 取模板 → 按 slot 放组件 → 绑定解析 → 连接状态徽标。
 * 组件本身不知道业务;所有业务在 config 里。props 契约见 schema/scada-page.ts。
 */
import { computed, inject, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import type { ConnectionStatus, DataSource } from '@grid/tb-client'
import type { PageConfig, WidgetConfig } from './schema/page-config'
import { SCHEMA_VERSION } from './schema/page-config'
import type { ScadaPageProps, WidgetEventPayload } from './schema/scada-page'
import type { TemplateDefinition, WidgetDefinition } from './schema/registry'
import { getTemplate, getWidget, validateAgainstRegistry, type RegistryIssue } from './registry'
import { toWidgetEvent, useBindingRuntime, widgetPropsOf } from './widget-runtime'
import { computeScale, HEADER_DESIGN_H, rootStyle, slotStyle, wrapperStyle } from './layout/template-style'
import { DATA_SOURCE_KEY } from './provide'
import WidgetExpand from './WidgetExpand.vue'

const props = withDefaults(defineProps<ScadaPageProps>(), {
  showStatus: false,
  design: false,
  expandable: true,
  decor: true,
  header: true,
})
const emit = defineEmits<{
  (e: 'invalid', issues: { path: string; message: string }[]): void
  (e: 'status', status: ConnectionStatus): void
  /** 某个绑定解析 / 订阅失败(含 DataSource 的 onError:无权访问实体等);组件已置错误态,宿主可汇总提示 */
  (e: 'bindError', widgetId: string, slot: string, message: string): void
  /** 组件放大 / 关闭(2026-09-16):放大时给组件 id,关闭时 null */
  (e: 'expand', widgetId: string | null): void
  /** 组件事件透传:组件内 emit('widget-event', { name, detail }),补上 widgetId / type 抛给宿主(放大层里触发的也走这里) */
  (e: 'widget-event', payload: WidgetEventPayload): void
}>()
const themeName = computed(() => props.theme ?? props.config.theme ?? 'default')

/**
 * 大屏抬头(0.6.0):`config.header` 填了主标题、`show` 不为 false、宿主没传 `:header="false"` 才画。
 * 它不占模板槽位,和舞台一起竖排;高度按设计稿 84 px 乘当前缩放,字号同理——所以在编辑器的小预览里
 * 和在 1080p 大屏上比例一致。
 */
const hdr = computed(() => {
  if (!props.header) return null
  const h = props.config.header
  return h && h.show !== false && (h.title ?? '').trim() ? h : null
})
const headerH = computed(() => (hdr.value ? HEADER_DESIGN_H : 0))

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

/** 组件 props:defaults + 配置(先过组件的 migrateProps 把旧键名正规化) */
const widgetProps = (w: Placed['widgets'][number]) => widgetPropsOf(w.cfg)

/** 组件抛的 widget-event:补 widgetId / type 后向外抛;形状不对的忽略 */
function onWidgetEvent(cfg: WidgetConfig, ev: unknown) {
  const payload = toWidgetEvent(cfg, ev)
  if (payload) emit('widget-event', payload)
}

// ---------- 组件放大(2026-09-16):右上角按钮 → 铺满视口再渲染一份,共用 values / bindErrors,不新建订阅 ----------
const expandedId = ref<string | null>(null)
const expandedW = computed(() => {
  if (!expandedId.value) return null
  for (const p of placed.value) for (const w of p.widgets) if (w.cfg.id === expandedId.value && w.def) return w
  return null
})
function expand(id: string | null) {
  expandedId.value = id
  emit('expand', id)
}
// 配置换掉 / 组件被移除时收起
watch(expandedW, w => {
  if (!w && expandedId.value) expand(null)
})

// ---------- 绑定(与 <ScadaWidget> 共用 widget-runtime) ----------
const rt = useBindingRuntime((wid, slot, message) => emit('bindError', wid, slot, message))
const values = rt.values
const bindErrors = rt.bindErrors

function teardown() {
  rt.teardown()
}
function setup() {
  if (fatal.value || !tpl.value) {
    rt.setup([], null, true)
    return
  }
  rt.setup(
    props.config.widgets.filter(w => !widgetErrors.value.has(w.id)),
    ds.value,
    props.design
  )
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
  scale.value = computeScale(t.design!, { w: el.clientWidth, h: el.clientHeight }, headerH.value)
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
// 抬头出现 / 消失会改变舞台的可用高度,得重新量
watch(headerH, async () => {
  await nextTick()
  measure()
})
onBeforeUnmount(() => {
  teardown()
  offStatus?.()
  ro?.disconnect()
})

defineExpose({ issues, status, values, bindErrors })
</script>

<template>
  <div
    class="sr-page"
    :class="[
      `sr-theme-${theme ?? config.theme ?? 'default'}`,
      {
        'sr-design': design,
        'sr-decor': decor,
        'sr-page-scaled': tpl?.kind === 'scaled',
        'sr-has-header': !!hdr,
      },
    ]"
    :style="{ '--sr-scale': String(scale) }"
  >
    <!-- 装饰层(0.5.0):底色渐变 + 光晕 + 细网格 + 暗角。纯观感,不接收指针事件,:decor="false" 时不渲染 -->
    <div v-if="decor" class="sr-bg" aria-hidden="true"></div>

    <div v-if="fatal" class="sr-fatal">
      <div class="sr-fatal-title">页面无法渲染</div>
      <div class="sr-fatal-msg">{{ fatal }}</div>
    </div>

    <template v-else-if="tpl">
      <header
        v-if="hdr"
        class="sr-header"
        :class="`sr-header-${hdr.align ?? 'center'}`"
        :style="tpl.kind === 'scaled' ? { width: `${tpl.design!.w * scale}px` } : undefined"
      >
        <div class="sr-header-side">
          <img v-if="hdr.logo" class="sr-header-logo" :src="hdr.logo" alt="" />
          <span v-if="hdr.org" class="sr-header-org">{{ hdr.org }}</span>
        </div>
        <div class="sr-header-mid">
          <div class="sr-header-title" :data-text="hdr.title">{{ hdr.title }}</div>
          <div v-if="hdr.subtitle" class="sr-header-sub">{{ hdr.subtitle }}</div>
        </div>
        <div class="sr-header-side sr-header-side-r" aria-hidden="true"></div>
      </header>
      <div ref="wrapper" class="sr-wrapper" :style="wrapperStyle(tpl, scale)">
        <!-- 舞台四角角标:只给固定设计稿的大屏模板画,grid 模板(后台页)不画 -->
        <div v-if="decor && tpl.kind === 'scaled'" class="sr-corners" aria-hidden="true"></div>
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
                  v-bind="widgetProps(w)"
                  :values="values[w.cfg.id] ?? {}"
                  :errors="bindErrors[w.cfg.id] ?? {}"
                  :disabled="!!w.cfg.actions"
                  @widget-event="onWidgetEvent(w.cfg, $event)"
                />
                <button
                  v-if="expandable && !design"
                  type="button"
                  class="sr-expand-btn"
                  title="放大这个组件"
                  aria-label="放大"
                  data-role="expand"
                  @click.stop="expand(w.cfg.id)"
                >
                  ⤢
                </button>
              </div>
            </template>
            <div v-else-if="design" class="sr-slot-placeholder">
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
      <WidgetExpand
        v-if="expandedW"
        :config="expandedW.cfg"
        :def="expandedW.def!"
        :widget-props="widgetProps(expandedW)"
        :values="values[expandedW.cfg.id] ?? {}"
        :errors="bindErrors[expandedW.cfg.id] ?? {}"
        :disabled="!!expandedW.cfg.actions"
        :theme="themeName"
        @close="expand(null)"
        @widget-event="emit('widget-event', $event)"
      />
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
.sr-page.sr-decor {
  background: var(--sr-page-bg);
}

/* ── 装饰层(0.5.0)────────────────────────────────────────────────
   一层元素画光晕 + 网格,::after 画暗角。整层 pointer-events: none,盖在内容之下(z-index: 0),
   页面内容统一提到 z-index: 1;组件自己没有背景的地方能透出这层,所以卡片给了不透明的渐变底。 */
.sr-bg {
  position: absolute;
  inset: 0;
  z-index: 0;
  pointer-events: none;
  overflow: hidden;
  background-image:
    radial-gradient(1100px 520px at 10% -10%, var(--sr-glow-1), transparent 62%),
    radial-gradient(900px 440px at 92% 4%, var(--sr-glow-2), transparent 60%),
    linear-gradient(var(--sr-grid-line) 1px, transparent 1px),
    linear-gradient(90deg, var(--sr-grid-line) 1px, transparent 1px);
  background-size:
    auto,
    auto,
    var(--sr-grid-size) var(--sr-grid-size),
    var(--sr-grid-size) var(--sr-grid-size);
}
.sr-bg::after {
  content: '';
  position: absolute;
  inset: 0;
  background: radial-gradient(130% 95% at 50% 42%, transparent 52%, var(--sr-vignette));
}
.sr-page.sr-decor > .sr-wrapper,
.sr-page.sr-decor > .sr-fatal,
.sr-page.sr-decor > .sr-status,
.sr-page.sr-decor > .sr-issues {
  position: relative;
  z-index: 1;
}

/* 舞台四角角标:八条线段拼四个 L,一个伪元素画完,不加 DOM */
.sr-corners {
  position: absolute;
  inset: 0;
  z-index: 2;
  pointer-events: none;
  background-repeat: no-repeat;
  background-image:
    linear-gradient(var(--sr-corner), var(--sr-corner)), linear-gradient(var(--sr-corner), var(--sr-corner)),
    linear-gradient(var(--sr-corner), var(--sr-corner)), linear-gradient(var(--sr-corner), var(--sr-corner)),
    linear-gradient(var(--sr-corner), var(--sr-corner)), linear-gradient(var(--sr-corner), var(--sr-corner)),
    linear-gradient(var(--sr-corner), var(--sr-corner)), linear-gradient(var(--sr-corner), var(--sr-corner));
  background-size:
    var(--sr-corner-len) 2px,
    2px var(--sr-corner-len),
    var(--sr-corner-len) 2px,
    2px var(--sr-corner-len),
    var(--sr-corner-len) 2px,
    2px var(--sr-corner-len),
    var(--sr-corner-len) 2px,
    2px var(--sr-corner-len);
  background-position:
    left top,
    left top,
    right top,
    right top,
    left bottom,
    left bottom,
    right bottom,
    right bottom;
}
.sr-wrapper {
  margin: 0 auto;
}
/* 固定设计稿的大屏:舞台按比例缩放后在容器里**居中**(0.5.0;此前只水平居中,容器比设计稿高时下方空一大条) */
.sr-page-scaled {
  display: flex;
  align-items: center;
  justify-content: center;
}

/* ── 大屏抬头(0.6.0)───────────────────────────────────────────────
   抬头不在模板槽位里,它和舞台竖着排;所有尺寸乘 --sr-scale,所以编辑器里的小预览
   和 1080p 大屏上的比例完全一致。grid 模板 scale 恒为 1,就是 84 px 的一条。 */
.sr-page.sr-has-header {
  display: flex;
  flex-direction: column;
}
.sr-page.sr-has-header:not(.sr-page-scaled) > .sr-wrapper {
  flex: 1;
  min-height: 0;
}
.sr-header {
  --h: calc(84px * var(--sr-scale, 1));
  position: relative;
  z-index: 1;
  flex: none;
  box-sizing: border-box;
  width: 100%;
  height: var(--h);
  display: flex;
  align-items: center;
  gap: calc(16px * var(--sr-scale, 1));
  padding: 0 calc(28px * var(--sr-scale, 1));
  color: var(--sr-ink-0);
  /* 底色向下淡出 + 一条两端收尾的分隔亮线 */
  background:
    linear-gradient(90deg, transparent 4%, var(--sr-header-line, transparent), transparent 96%) bottom / 100% 1px
      no-repeat,
    linear-gradient(180deg, var(--sr-header-bg, transparent), transparent);
}
.sr-header-side {
  flex: 1 1 0;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: calc(12px * var(--sr-scale, 1));
}
.sr-header-side-r {
  justify-content: flex-end;
}
.sr-header-logo {
  height: calc(44px * var(--sr-scale, 1));
  width: auto;
  display: block;
  filter: drop-shadow(0 0 calc(10px * var(--sr-scale, 1)) rgba(72, 214, 255, 0.3));
}
.sr-header-org {
  font-size: max(12px, calc(17px * var(--sr-scale, 1)));
  letter-spacing: 0.1em;
  color: var(--sr-ink-1);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.sr-header-mid {
  position: relative;
  flex: none;
  max-width: 66%;
  text-align: center;
}

/* 主标题三层叠出来的(2026-09-20:光一层渐变字太素):
   ①「描边层」——同一段字垫在底下只描粗边,把标题从背景里抠出来,远看有厚度;
   ② 本体 —— 渐变填充 + 外发光;
   ③「扫光层」—— 一道窄高光每 7 秒扫过一次,只在文字形状里可见。
   ①③ 都用 content: attr(data-text) 复制同一段字,所以三层的字距 / 字号必须跟着本体走(继承即可)。 */
.sr-header-title {
  position: relative;
  display: block;
  font-family: var(--sr-font-title);
  font-size: max(16px, calc(38px * var(--sr-scale, 1)));
  line-height: 1.16;
  letter-spacing: 0.1em;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  background: var(--sr-header-title-fill, none);
  -webkit-background-clip: text;
  background-clip: text;
  color: var(--sr-header-title-ink, var(--sr-ink-0));
  /* 发光 / 实影用 em:字号有 max(16px, …) 的下限,跟着 --sr-scale 算会在小预览里缩没 */
  filter: drop-shadow(0 0 0.42em var(--sr-header-title-glow, transparent))
    drop-shadow(0 0.05em 0 var(--sr-header-title-drop, transparent));
}
.sr-header-title::before,
.sr-header-title::after {
  content: attr(data-text);
  position: absolute;
  inset: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  pointer-events: none;
}
/* ① 描边层:z-index -1 落在抬头底色之上、本体之下(.sr-header 自己是个层叠上下文) */
.sr-header-title::before {
  z-index: -1;
  color: transparent;
  -webkit-text-stroke: 0.055em var(--sr-header-title-stroke, transparent);
}
/* ③ 扫光层:同一段字用高光色**实打实**再画一遍,再用一条移动的渐变遮罩只露出窄窄一道。
   没走「渐变 + background-clip: text」那条路——Chromium 里把半透明渐变裁成文字之后画不出来(实测),
   遮罩这条稳。不想要这道光:--sr-header-shine-anim: none(或系统开了「减少动态效果」时自动停)。 */
.sr-header-title::after {
  color: var(--sr-header-shine, transparent);
  -webkit-text-fill-color: var(--sr-header-shine, transparent);
  -webkit-mask-image: linear-gradient(100deg, transparent 38%, #000 50%, transparent 62%);
  mask-image: linear-gradient(100deg, transparent 38%, #000 50%, transparent 62%);
  -webkit-mask-size: 300% 100%;
  mask-size: 300% 100%;
  -webkit-mask-repeat: no-repeat;
  mask-repeat: no-repeat;
  -webkit-mask-position: 110% 0;
  mask-position: 110% 0;
  animation: var(--sr-header-shine-anim, sr-title-shine 7s ease-in-out infinite);
}
@keyframes sr-title-shine {
  0%,
  24% {
    -webkit-mask-position: 110% 0;
    mask-position: 110% 0;
  }
  60%,
  100% {
    -webkit-mask-position: -10% 0;
    mask-position: -10% 0;
  }
}
@media (prefers-reduced-motion: reduce) {
  .sr-header-title::after {
    animation: none;
  }
}

/* 标题两侧的翼饰:一道向外淡出的细线 + 内端一颗小菱形;只有居中版式才画。
   线和菱形是**同一个** clip-path 多边形(走完线的上沿 → 菱形一圈 → 线的下沿),
   所以一个伪元素就够,右边那只镜像过去。 */
.sr-header-center .sr-header-mid::before,
.sr-header-center .sr-header-mid::after {
  content: '';
  position: absolute;
  top: calc(50% - max(5px, 12px * var(--sr-scale, 1)) / 2);
  width: max(46px, calc(104px * var(--sr-scale, 1)));
  height: max(5px, calc(12px * var(--sr-scale, 1)));
  pointer-events: none;
  background: linear-gradient(90deg, transparent, var(--sr-header-wing, transparent) 82%);
  clip-path: polygon(0 46%, 86% 46%, 93% 0, 100% 50%, 93% 100%, 86% 54%, 0 54%);
  filter: drop-shadow(0 0 3px var(--sr-header-wing, transparent));
}
.sr-header-center .sr-header-mid::before {
  right: 100%;
  margin-right: max(10px, calc(18px * var(--sr-scale, 1)));
}
.sr-header-center .sr-header-mid::after {
  left: 100%;
  margin-left: max(10px, calc(18px * var(--sr-scale, 1)));
  transform: scaleX(-1);
}
.sr-header-sub {
  margin-top: calc(2px * var(--sr-scale, 1));
  font-family: var(--sr-font-num);
  font-size: max(10px, calc(14px * var(--sr-scale, 1)));
  letter-spacing: 0.28em;
  color: var(--sr-ink-2);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
/* 靠左时:标题贴着 logo 走,右边留空 */
.sr-header-left .sr-header-side {
  flex: none;
}
.sr-header-left .sr-header-mid {
  flex: 1 1 auto;
  max-width: none;
  text-align: left;
}
.sr-slot {
  box-sizing: border-box;
}
.sr-widget {
  position: relative;
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
