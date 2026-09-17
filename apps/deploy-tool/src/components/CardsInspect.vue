<script setup lang="ts">
/**
 * 卡片库检视(2026-09-17 YY):一张一张看之前配的卡——左栏用真数据源渲染出来(<ScadaWidget>,实时值),
 * 右栏是前端怎么引用它(页面 id + 组件 id、复制引用 / 接入代码)+ 数据源摘要 + 订阅报错。
 * 三处共用:第 4 步「预览卡片库」(编辑器 PreviewPane)、大屏 site.html?cards=1、第 5 步「打开检视页」。
 */
import { computed, reactive } from 'vue'
import { getWidget, ScadaWidget, type PageConfig, type WidgetConfig } from '@grid/scada-renderer'
import type { DataSource } from '@grid/tb-client'
import { refJson, refSnippet, widgetTitle } from '../editor/widget-ref'

const props = defineProps<{
  config: PageConfig
  /** 卡片库页面资产 id(已发布才有) */
  pageId: string | null
  /** 数据源;不传则用 provide 注入的(design 时不需要) */
  dataSource?: DataSource | null
  /** 编辑态:用 sampleData,不订阅 */
  design?: boolean
}>()

/** 每种组件在检视页里的容器尺寸(px):图表 / 表格 / 告警列表要宽一点 */
const SIZE: Record<string, [number, number]> = {
  line: [520, 280],
  'dual-axis': [520, 280],
  table: [520, 280],
  'alarm-list': [520, 280],
  'overview-card': [420, 220],
  image: [360, 220],
}
const sizeOf = (type: string) => SIZE[type] ?? [340, 170]

const rows = computed(() =>
  [...props.config.widgets]
    .sort((a, b) => a.slot.localeCompare(b.slot, 'en', { numeric: true }))
    .map(w => {
      const def = getWidget(w.type)
      const [wpx, hpx] = sizeOf(w.type)
      return {
        w,
        typeName: def?.name ?? w.type,
        title: widgetTitle(w, def?.name ?? w.type),
        style: { width: `${wpx}px`, height: `${hpx}px` },
        bindings: bindingLines(w),
      }
    })
)

/** 绑定摘要:槽位 = mode 实体名.key(多序列逐条) */
function bindingLines(w: WidgetConfig): string[] {
  const one = (b: Record<string, unknown>) => {
    const e = b.entity as { name?: string; id?: string } | undefined
    const ent = e?.name || e?.id || ''
    const key = typeof b.key === 'string' ? b.key : Array.isArray(b.keys) ? (b.keys as string[]).join('+') : ''
    const src = typeof b.source === 'string' ? `:${b.source}` : ''
    const win = typeof b.window === 'string' ? ` · ${b.window}` : ''
    return `${String(b.mode ?? '?')}${src}${ent ? ' ' + ent : ''}${key ? '.' + key : ''}${win}`
  }
  return Object.entries(w.bindings ?? {}).map(([slot, b]) => {
    const list = (Array.isArray(b) ? b : [b]) as unknown as Record<string, unknown>[]
    return `${slot} = ${list.map(one).join(' | ')}`
  })
}

/** 每张卡的订阅报错(无权访问 / 实体不存在……),给「数据源对不对」一个直接的答案 */
const errors = reactive<Record<string, string[]>>({})
function onErr(id: string, slot: string, message: string) {
  const list = errors[id] ?? (errors[id] = [])
  const line = `${slot}:${message}`
  if (!list.includes(line)) list.push(line)
}

const msg = reactive({ text: '' })
let timer: ReturnType<typeof setTimeout> | null = null
function toast(t: string) {
  msg.text = t
  if (timer) clearTimeout(timer)
  timer = setTimeout(() => (msg.text = ''), 2600)
}
async function copy(kind: 'json' | 'code', w: WidgetConfig) {
  if (!props.pageId) return toast('卡片库还没发布,没有页面 id;发布后再复制')
  try {
    await navigator.clipboard.writeText(kind === 'json' ? refJson(props.pageId, w.id) : refSnippet(props.pageId, w))
    toast(kind === 'json' ? `已复制「${widgetTitle(w)}」的引用` : `已复制「${widgetTitle(w)}」的接入代码`)
  } catch {
    toast('复制失败,请手动选择文本')
  }
}
</script>

<template>
  <div class="ci" data-role="cards-inspect">
    <div class="ci-head">
      <span class="ci-sum" data-role="ci-summary">
        {{ rows.length }} 张卡 · {{ pageId ? `页面 id ${pageId}` : '未发布(没有页面 id)' }}
      </span>
      <span v-if="msg.text" class="ci-msg" data-role="ci-msg">{{ msg.text }}</span>
    </div>
    <p v-if="!rows.length" class="ci-empty">卡片库是空的。</p>
    <div v-for="r in rows" :key="r.w.id" class="ci-row" :data-card="r.w.id">
      <div class="ci-left">
        <div class="ci-cell" :style="r.style">
          <ScadaWidget
            :config="r.w"
            :data-source="dataSource ?? undefined"
            :design="!!design"
            :expandable="false"
            @bind-error="(id, slot, m) => onErr(id, slot, m)"
          />
        </div>
      </div>
      <div class="ci-right">
        <div class="ci-title">
          <b>{{ r.title }}</b> <span class="ci-dim">{{ r.typeName }}</span>
        </div>
        <div class="ci-block">
          <div class="ci-k">数据源</div>
          <div v-for="(b, i) in r.bindings" :key="i" class="ci-bind">
            <code>{{ b }}</code>
          </div>
          <div v-if="!r.bindings.length" class="ci-dim">(没有绑定)</div>
          <div v-for="(e, i) in errors[r.w.id] ?? []" :key="'e' + i" class="ci-err" data-role="ci-error">✗ {{ e }}</div>
        </div>
        <div class="ci-block">
          <div class="ci-k">前端引用</div>
          <div class="ci-ids">
            <span class="ci-dim">页面 id</span>
            <code v-if="pageId" :title="pageId">{{ pageId }}</code>
            <span v-else class="ci-dim" data-role="ci-unpublished">发布后才有</span>
          </div>
          <div class="ci-ids"><span class="ci-dim">组件 id</span> <code>{{ r.w.id }}</code></div>
          <div v-if="pageId" class="ci-btns">
            <button type="button" class="ci-btn" data-role="ci-copy-json" @click="copy('json', r.w)">复制引用</button>
            <button type="button" class="ci-btn" data-role="ci-copy-code" @click="copy('code', r.w)">复制接入代码</button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.ci {
  --ci-line: rgba(83, 196, 255, 0.2);
  --ci-dim: rgba(205, 238, 255, 0.65);
  color: #ecf9ff;
  font-family: 'Microsoft YaHei', 'PingFang SC', sans-serif;
  font-size: 13px;
}
.ci-head {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 12px;
  border-bottom: 1px solid var(--ci-line);
}
.ci-sum {
  color: var(--ci-dim);
}
.ci-msg {
  margin-left: auto;
  color: #6fe3a0;
  font-size: 12px;
}
.ci-empty {
  padding: 24px;
  color: var(--ci-dim);
}
.ci-row {
  display: grid;
  grid-template-columns: auto minmax(280px, 1fr);
  gap: 16px;
  padding: 14px 12px;
  border-bottom: 1px solid var(--ci-line);
}
.ci-left {
  display: flex;
  align-items: flex-start;
}
.ci-cell {
  max-width: 100%;
  box-sizing: border-box;
  outline: 1px dashed rgba(255, 255, 255, 0.18);
}
.ci-right {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-width: 0;
}
.ci-title {
  font-size: 14px;
}
.ci-dim {
  color: var(--ci-dim);
  font-size: 12px;
}
.ci-k {
  font-size: 11px;
  letter-spacing: 0.1em;
  color: var(--ci-dim);
  margin-bottom: 4px;
}
.ci-bind code,
.ci-ids code {
  font-size: 11px;
  padding: 1px 6px;
  border: 1px solid var(--ci-line);
  border-radius: 4px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 100%;
  display: inline-block;
  vertical-align: middle;
}
.ci-bind {
  margin: 2px 0;
}
.ci-err {
  color: #ff8a8a;
  font-size: 12px;
  margin-top: 4px;
}
.ci-ids {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  margin: 2px 0;
}
.ci-btns {
  display: flex;
  gap: 6px;
  margin-top: 4px;
}
.ci-btn {
  background: transparent;
  border: 1px solid var(--ci-line);
  border-radius: 6px;
  color: inherit;
  font: inherit;
  font-size: 12px;
  padding: 3px 10px;
  cursor: pointer;
}
.ci-btn:hover {
  border-color: #19b7ff;
}
</style>
