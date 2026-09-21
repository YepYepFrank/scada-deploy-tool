<script setup lang="ts">
/**
 * 「属性」面板(示例扩展):只用 inject(SLD_EDITOR_CTX),不碰 X6、不收 props。
 * 选中单个节点:id / 图元 / 名称(可改)/ 旋转 / 镜像;单个母线、标签、分组框:各自的一两个基本字段。
 * 输入框在 change(回车 / 失焦)时提交,一次提交 = 撤销栈里的一步。
 */
import { computed, inject } from 'vue'
import { SLD_BUS_WIDTH, busLength, getSldSymbol, validNodeScales } from '@grid/scada-renderer'
import { SLD_EDITOR_CTX } from '../../ext'
import {
  BUS_WIDTH_MAX,
  BUS_WIDTH_MIN,
  LABEL_SIZE_DEFAULT,
  LABEL_SIZE_MAX,
  LABEL_SIZE_MIN,
  parseKv,
  setBusColor,
  setBusKv,
  setBusWidth,
  setLabelStyle,
  setNodeScale,
  setNodeSource,
  setPortKv,
  setStacking,
  type StackMove,
  type LabelStylePatch,
} from './ops'

const ctx = inject(SLD_EDITOR_CTX)
if (!ctx) throw new Error('InspectorPanel 必须放在 <SldEditor> 里')

const doc = computed(() => ctx.content.value.doc)
const sel = computed(() => ctx.selection.value)
const count = computed(
  () =>
    sel.value.nodes.length +
    sel.value.buses.length +
    sel.value.wires.length +
    sel.value.labels.length +
    (sel.value.frames?.length ?? 0)
)
const single = computed(() => count.value === 1)
const node = computed(() => (single.value ? doc.value.nodes.find(n => n.id === sel.value.nodes[0]) : undefined))
const bus = computed(() => (single.value ? doc.value.buses.find(b => b.id === sel.value.buses[0]) : undefined))
const wire = computed(() => (single.value ? doc.value.wires.find(w => w.id === sel.value.wires[0]) : undefined))
const label = computed(() => (single.value ? doc.value.labels.find(l => l.id === sel.value.labels[0]) : undefined))
const frame = computed(() => (single.value ? doc.value.frames?.find(f => f.id === sel.value.frames?.[0]) : undefined))
const symbolDef = computed(() => (node.value ? getSldSymbol(node.value.symbol) : undefined))
/** 变压器各侧端口(portKv 按端口 id 存,如 hv / lv) */
const trPorts = computed(() => (symbolDef.value?.conduct === 'transformer' ? symbolDef.value.ports.map(p => p.id) : []))
const symbolName = computed(() => (node.value ? (getSldSymbol(node.value.symbol)?.name ?? '未知图元') : ''))

const valueOf = (e: Event): string => (e.target as HTMLInputElement).value

function setNodeName(e: Event): void {
  const id = node.value?.id
  const name = valueOf(e).trim()
  ctx!.apply(d => {
    const n = d.doc.nodes.find(x => x.id === id)
    if (!n) return false
    if (name) n.name = name
    else delete n.name
  }, '改名称')
}
function setBusName(e: Event): void {
  const id = bus.value?.id
  const name = valueOf(e).trim()
  ctx!.apply(d => {
    const b = d.doc.buses.find(x => x.id === id)
    if (!b) return false
    if (name) b.name = name
    else delete b.name
  }, '改母线名称')
}
function setLabelText(e: Event): void {
  const id = label.value?.id
  const text = valueOf(e)
  ctx!.apply(d => {
    const l = d.doc.labels.find(x => x.id === id)
    if (!l) return false
    if (l.kind === 'text') l.text = text
    else if (text) l.title = text
    else delete l.title
  }, '改文字')
}
function setFrameTitle(e: Event): void {
  const id = frame.value?.id
  const title = valueOf(e).trim()
  ctx!.apply(d => {
    const f = d.doc.frames?.find(x => x.id === id)
    if (!f) return false
    if (title) f.title = title
    else delete f.title
  }, '改分组框标题')
}
// ---- 电气参数(带电着色按 kv 取色,ADR-005 D11)----
const kvOf = (e: Event) => parseKv(valueOf(e))
function toggleSource(e: Event): void {
  const id = node.value!.id
  const on = (e.target as HTMLInputElement).checked
  ctx!.apply(
    d => (setNodeSource(d.doc, id, on, node.value?.source?.kv) ? undefined : false),
    on ? '设为电源点' : '取消电源点'
  )
}
function setSourceKv(e: Event): void {
  const id = node.value!.id
  const kv = kvOf(e)
  ctx!.apply(d => (setNodeSource(d.doc, id, true, kv) ? undefined : false), '改电源电压等级')
}
function setTrKv(port: string, e: Event): void {
  const id = node.value!.id
  const kv = kvOf(e)
  ctx!.apply(d => (setPortKv(d.doc, id, port, kv) ? undefined : false), '改变压器电压等级')
}
function setBusKvInput(e: Event): void {
  const id = bus.value!.id
  const kv = kvOf(e)
  ctx!.apply(d => (setBusKv(d.doc, id, kv) ? undefined : false), '改母线电压等级')
}
// ---- 外观(2026-09-20):节点大小、母线粗细 / 颜色、文字大小 / 粗细 / 颜色 ----
/** 这个图元放大后端口仍落栅格的倍数(不同图元不一样,见 validNodeScales) */
const scales = computed(() => (symbolDef.value ? validNodeScales(symbolDef.value) : [1]))
function setScale(e: Event): void {
  const id = node.value!.id
  const k = Number(valueOf(e))
  ctx!.apply(d => (setNodeScale(d.doc, id, k, getSldSymbol) ? undefined : false), '改图元大小')
}
function setBusWidthInput(e: Event): void {
  const id = bus.value!.id
  const w = Number(valueOf(e))
  ctx!.apply(d => (setBusWidth(d.doc, id, w) ? undefined : false), '改母线粗细')
}
function setBusColorInput(color: string | undefined): void {
  const id = bus.value!.id
  ctx!.apply(d => (setBusColor(d.doc, id, color) ? undefined : false), '改母线颜色')
}
function styleLabel(patch: LabelStylePatch, what: string): void {
  const id = label.value!.id
  ctx!.apply(d => (setLabelStyle(d.doc, id, patch) ? undefined : false), what)
}
/** 标签颜色的下拉:随主题 / 三个相色 / 自定义(#hex) */
const labelColorMode = computed(() => {
  const c = label.value?.color
  return !c ? '' : c === 'a' || c === 'b' || c === 'c' ? c : 'custom'
})
function setLabelColorMode(e: Event): void {
  const v = valueOf(e)
  styleLabel({ color: v === 'custom' ? '#19b7ff' : v }, '改文字颜色')
}
/** 叠放层次:对当前选中的这一个图元 / 母线 */
function stack(move: StackMove): void {
  const pick = { nodes: node.value ? [node.value.id] : [], buses: bus.value ? [bus.value.id] : [] }
  const what = move === 'front' ? '置顶' : move === 'back' ? '置底' : '恢复默认层次'
  ctx!.apply(d => (setStacking(d.doc, pick, move) ? undefined : false), what)
}
const zText = (z: number | undefined): string => (!z ? '默认' : z > 0 ? `上移 ${z} 级` : `下移 ${-z} 级`)

const LABEL_KIND_TEXT = { text: '文字', value: '数值', status: '状态(在线灯)' } as const

const endText = (e: { node: string; port: string } | { bus: string; d: number }): string =>
  'bus' in e ? `母线 ${e.bus} @ ${e.d}` : `${e.node} . ${e.port}`
</script>

<template>
  <div class="sld-insp">
    <p v-if="count === 0" class="sld-insp-hint">未选中元素。点选或框选画布上的元素。</p>
    <p v-else-if="!single" class="sld-insp-hint">已选中 {{ count }} 个元素。</p>

    <template v-else-if="node">
      <div class="sld-insp-row">
        <span>id</span><code data-field="id">{{ node.id }}</code>
      </div>
      <div class="sld-insp-row">
        <span>图元</span><b data-field="symbol">{{ symbolName }}({{ node.symbol }})</b>
      </div>
      <label class="sld-insp-row">
        <span>名称</span>
        <input
          data-field="name"
          :value="node.name ?? ''"
          :disabled="ctx.readonly.value"
          placeholder="如:1# 进线柜"
          @change="setNodeName"
        />
      </label>
      <div class="sld-insp-row">
        <span>旋转</span><b data-field="rot">{{ node.rot }}°</b>
      </div>
      <div class="sld-insp-row">
        <span>镜像</span><b>{{ node.flip ? '是' : '否' }}</b>
      </div>
      <div class="sld-insp-row">
        <span>位置</span><b>{{ node.x }}, {{ node.y }}</b>
      </div>
      <label class="sld-insp-row" title="直接拖图元四角的手柄就能改大小(松手吸附到最近一档);这里是要精确倍数时用的">
        <span>大小</span>
        <select data-field="scale" :value="node.scale ?? 1" :disabled="ctx.readonly.value" @change="setScale">
          <option v-for="k in scales" :key="k" :value="k">{{ k }} 倍</option>
        </select>
      </label>
      <div
        class="sld-insp-row"
        title="重叠时谁压着谁。默认:图元压连线、连线压母线。也可以用工具栏的「置顶 / 置底」(快捷键 ] 与 [)"
      >
        <span>层次</span>
        <b data-field="z">{{ zText(node.z) }}</b>
        <button type="button" class="sld-insp-mini" :disabled="ctx.readonly.value" @click="stack('front')">置顶</button>
        <button type="button" class="sld-insp-mini" :disabled="ctx.readonly.value" @click="stack('back')">置底</button>
        <button
          v-if="node.z"
          type="button"
          class="sld-insp-mini"
          :disabled="ctx.readonly.value"
          @click="stack('reset')"
        >
          复位
        </button>
      </div>
      <div v-if="node.entity" class="sld-insp-row">
        <span>设备</span><b>{{ node.entity.name }}</b>
      </div>
      <div v-if="node.state" class="sld-insp-row">
        <span>状态测点</span><code>pt.{{ node.state.pt }}</code>
      </div>
      <label class="sld-insp-row">
        <span>电源点</span>
        <input
          type="checkbox"
          data-field="source"
          :checked="!!node.source"
          :disabled="ctx.readonly.value"
          @change="toggleSource"
        />
      </label>
      <label v-if="node.source" class="sld-insp-row">
        <span>电压 kV</span>
        <input
          data-field="source-kv"
          :value="node.source.kv ?? ''"
          :disabled="ctx.readonly.value"
          placeholder="如 10、0.4"
          @change="setSourceKv"
        />
      </label>
      <label v-for="p in trPorts" :key="p" class="sld-insp-row">
        <span>{{ p }} 侧 kV</span>
        <input
          :data-field="`port-kv-${p}`"
          :value="node.portKv?.[p] ?? ''"
          :disabled="ctx.readonly.value"
          placeholder="如 10、0.4"
          @change="setTrKv(p, $event)"
        />
      </label>
    </template>

    <template v-else-if="bus">
      <div class="sld-insp-row">
        <span>id</span><code>{{ bus.id }}</code>
      </div>
      <label class="sld-insp-row">
        <span>名称</span>
        <input :value="bus.name ?? ''" :disabled="ctx.readonly.value" @change="setBusName" />
      </label>
      <label class="sld-insp-row">
        <span>电压 kV</span>
        <input
          data-field="bus-kv"
          :value="bus.kv ?? ''"
          :disabled="ctx.readonly.value"
          placeholder="不填则随上游"
          @change="setBusKvInput"
        />
      </label>
      <label class="sld-insp-row">
        <span>粗细</span>
        <input
          type="number"
          data-field="bus-width"
          :min="BUS_WIDTH_MIN"
          :max="BUS_WIDTH_MAX"
          step="1"
          :value="bus.width ?? SLD_BUS_WIDTH"
          :disabled="ctx.readonly.value"
          @change="setBusWidthInput"
        />
      </label>
      <div class="sld-insp-row" title="自定义颜色盖过电压等级色;母线失电时照样变灰">
        <span>颜色</span>
        <input
          type="color"
          data-field="bus-color"
          :value="bus.color ?? '#19b7ff'"
          :disabled="ctx.readonly.value"
          @change="setBusColorInput(valueOf($event))"
        />
        <b v-if="!bus.color" class="sld-insp-dim">按电压等级</b>
        <button
          v-else
          type="button"
          class="sld-insp-mini"
          :disabled="ctx.readonly.value"
          @click="setBusColorInput(undefined)"
        >
          恢复按电压等级
        </button>
      </div>
      <div
        class="sld-insp-row"
        title="重叠时谁压着谁。默认:图元压连线、连线压母线。也可以用工具栏的「置顶 / 置底」(快捷键 ] 与 [)"
      >
        <span>层次</span>
        <b data-field="z">{{ zText(bus.z) }}</b>
        <button type="button" class="sld-insp-mini" :disabled="ctx.readonly.value" @click="stack('front')">置顶</button>
        <button type="button" class="sld-insp-mini" :disabled="ctx.readonly.value" @click="stack('back')">置底</button>
        <button v-if="bus.z" type="button" class="sld-insp-mini" :disabled="ctx.readonly.value" @click="stack('reset')">
          复位
        </button>
      </div>
      <div class="sld-insp-row">
        <span>长度</span><b>{{ busLength(bus) }}</b>
      </div>
      <div class="sld-insp-row">
        <span>起点</span><b>{{ bus.x1 }}, {{ bus.y1 }}</b>
      </div>
    </template>

    <template v-else-if="label">
      <div class="sld-insp-row">
        <span>id</span><code>{{ label.id }}</code>
      </div>
      <div class="sld-insp-row">
        <span>类型</span><b>{{ LABEL_KIND_TEXT[label.kind] }}</b>
      </div>
      <label class="sld-insp-row">
        <span>{{ label.kind === 'text' ? '文字' : '前缀' }}</span>
        <input
          :value="label.kind === 'text' ? label.text : (label.title ?? '')"
          :disabled="ctx.readonly.value"
          @change="setLabelText"
        />
      </label>
      <label class="sld-insp-row">
        <span>字号</span>
        <input
          type="number"
          data-field="label-size"
          :min="LABEL_SIZE_MIN"
          :max="LABEL_SIZE_MAX"
          step="1"
          :value="label.size ?? LABEL_SIZE_DEFAULT"
          :disabled="ctx.readonly.value"
          @change="styleLabel({ size: Number(valueOf($event)) }, '改字号')"
        />
      </label>
      <label class="sld-insp-row">
        <span>加粗</span>
        <input
          type="checkbox"
          data-field="label-bold"
          :checked="!!label.bold"
          :disabled="ctx.readonly.value"
          @change="styleLabel({ bold: ($event.target as HTMLInputElement).checked }, '改粗细')"
        />
      </label>
      <div class="sld-insp-row">
        <span>颜色</span>
        <select
          data-field="label-color"
          :value="labelColorMode"
          :disabled="ctx.readonly.value"
          @change="setLabelColorMode"
        >
          <option value="">随主题</option>
          <option value="a">A 相 · 黄</option>
          <option value="b">B 相 · 绿</option>
          <option value="c">C 相 · 红</option>
          <option value="custom">自定义…</option>
        </select>
        <input
          v-if="labelColorMode === 'custom'"
          type="color"
          data-field="label-color-hex"
          :value="label.color"
          :disabled="ctx.readonly.value"
          @change="styleLabel({ color: valueOf($event) }, '改文字颜色')"
        />
      </div>
      <div v-if="label.kind !== 'text'" class="sld-insp-row">
        <span>测点</span><code>pt.{{ label.pt }}</code>
      </div>
      <div v-if="label.attach" class="sld-insp-row">
        <span>依附</span><code>{{ label.attach }}</code>
      </div>
    </template>

    <template v-else-if="frame">
      <div class="sld-insp-row">
        <span>id</span><code>{{ frame.id }}</code>
      </div>
      <label class="sld-insp-row">
        <span>标题</span>
        <input :value="frame.title ?? ''" :disabled="ctx.readonly.value" @change="setFrameTitle" />
      </label>
      <div class="sld-insp-row">
        <span>尺寸</span><b>{{ frame.w }} × {{ frame.h }}</b>
      </div>
    </template>

    <template v-else-if="wire">
      <div class="sld-insp-row">
        <span>id</span><code>{{ wire.id }}</code>
      </div>
      <div class="sld-insp-row">
        <span>从</span><b>{{ endText(wire.from) }}</b>
      </div>
      <div class="sld-insp-row">
        <span>到</span><b>{{ endText(wire.to) }}</b>
      </div>
      <div class="sld-insp-row">
        <span>手工拐点</span><b>{{ wire.vertices?.length ?? 0 }}</b>
      </div>
    </template>
  </div>
</template>

<style>
.sld-insp {
  padding: 10px 12px;
  font-size: 12px;
}
.sld-insp-hint {
  margin: 4px 0;
  opacity: 0.6;
}
.sld-insp-row {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 28px;
}
.sld-insp-row > span {
  flex: none;
  width: 64px;
  opacity: 0.6;
}
.sld-insp-row > b {
  font-weight: 500;
}
.sld-insp-row > input {
  flex: 1;
  min-width: 0;
  padding: 4px 6px;
  color: inherit;
  background: var(--ed-bg-0, #061024);
  border: 1px solid var(--ed-line, rgba(83, 196, 255, 0.2));
  border-radius: 4px;
  outline: none;
}
.sld-insp-row > select {
  flex: 1;
  min-width: 0;
  padding: 4px 6px;
  color: inherit;
  background: var(--ed-bg-0, #061024);
  border: 1px solid var(--ed-line, rgba(83, 196, 255, 0.2));
  border-radius: 4px;
}
.sld-insp-row > input[type='checkbox'],
.sld-insp-row > input[type='color'] {
  flex: none;
}
.sld-insp-row > input[type='color'] {
  width: 36px;
  height: 24px;
  padding: 1px;
}
.sld-insp-dim {
  opacity: 0.6;
}
.sld-insp-mini {
  padding: 2px 8px;
  font-size: 12px;
  color: inherit;
  background: none;
  border: 1px solid var(--ed-line, rgba(83, 196, 255, 0.2));
  border-radius: 4px;
  cursor: pointer;
}
.sld-insp-row > input:focus {
  border-color: var(--ed-accent, #19b7ff);
}
</style>
