<script setup lang="ts">
/**
 * 「属性」面板(示例扩展):只用 inject(SLD_EDITOR_CTX),不碰 X6、不收 props。
 * 按**选中集合里出现的类型**分块显示:图元 / 母线 / 文字 / 分组框 / 连线。
 * 每块里,「只选中一个」时多给出 id、名称、位置这些单体信息;外观(颜色、粗细、字号、大小、层次)
 * **一律作用于该类型的全部选中项**(2026-09-22 现场反馈「母线、文字的颜色粗细至少同类能批量改」)。
 * 输入框在 change(回车 / 失焦)时提交,一次提交 = 撤销栈里的一步。
 */
import { computed, inject } from 'vue'
import { SLD_BUS_WIDTH, busLength, getSldSymbol, isFreeSizeSymbol, validNodeScales } from '@grid/scada-renderer'
import type { SldSwitchState } from '@grid/scada-renderer'
import { SLD_EDITOR_CTX } from '../../ext'
import {
  BUS_WIDTH_MAX,
  BUS_WIDTH_MIN,
  FRAME_WIDTH_DEFAULT,
  FRAME_WIDTH_MAX,
  FRAME_WIDTH_MIN,
  LABEL_SIZE_DEFAULT,
  LABEL_SIZE_MAX,
  LABEL_SIZE_MIN,
  alignLabelColumns,
  freeSizeOf,
  parseKv,
  setBusColor,
  setBusKv,
  setBusWidth,
  setFrameStyle,
  setLabelStyle,
  setNodeColor,
  setNodeScale,
  setNodeSize,
  setNodeSource,
  setPortKv,
  setStacking,
  setStateFallback,
  type FrameStylePatch,
  type LabelStylePatch,
  type StackMove,
} from './ops'

const ctx = inject(SLD_EDITOR_CTX)
if (!ctx) throw new Error('InspectorPanel 必须放在 <SldEditor> 里')

const doc = computed(() => ctx.content.value.doc)
const sel = computed(() => ctx.selection.value)

/** 选中的各类元素(按文档顺序);外观操作作用于整组,单体信息只在该组只有一个时显示 */
const nodes = computed(() => doc.value.nodes.filter(n => sel.value.nodes.includes(n.id)))
const buses = computed(() => doc.value.buses.filter(b => sel.value.buses.includes(b.id)))
const labels = computed(() => doc.value.labels.filter(l => sel.value.labels.includes(l.id)))
const frames = computed(() => (doc.value.frames ?? []).filter(f => sel.value.frames?.includes(f.id)))
const wires = computed(() => doc.value.wires.filter(w => sel.value.wires.includes(w.id)))
const count = computed(
  () => nodes.value.length + buses.value.length + labels.value.length + frames.value.length + wires.value.length
)
/** 只选中一个时才显示的单体信息 */
const node = computed(() => (nodes.value.length === 1 ? nodes.value[0] : undefined))
const bus = computed(() => (buses.value.length === 1 ? buses.value[0] : undefined))
const label = computed(() => (labels.value.length === 1 ? labels.value[0] : undefined))
const frame = computed(() => (frames.value.length === 1 ? frames.value[0] : undefined))
const wire = computed(() => (wires.value.length === 1 ? wires.value[0] : undefined))
/** 选中概览:「3 条母线 · 5 个文字」 */
const summary = computed(() =>
  [
    [nodes.value.length, '个图元'],
    [buses.value.length, '条母线'],
    [labels.value.length, '个文字'],
    [frames.value.length, '个分组框'],
    [wires.value.length, '条连线'],
  ]
    .filter(([n]) => (n as number) > 0)
    .map(([n, t]) => `${n} ${t}`)
    .join(' · ')
)

const ids = <T extends { id: string }>(list: readonly T[]): string[] => list.map(x => x.id)
const nodeIds = computed(() => ids(nodes.value))
const busIds = computed(() => ids(buses.value))
const labelIds = computed(() => ids(labels.value))
const frameIds = computed(() => ids(frames.value))

const symbolDef = computed(() => (node.value ? getSldSymbol(node.value.symbol) : undefined))
/** 变压器各侧端口(portKv 按端口 id 存,如 hv / lv) */
const trPorts = computed(() => (symbolDef.value?.conduct === 'transformer' ? symbolDef.value.ports.map(p => p.id) : []))
const symbolName = computed(() => (node.value ? (getSldSymbol(node.value.symbol)?.name ?? '未知图元') : ''))

const valueOf = (e: Event): string => (e.target as HTMLInputElement).value
const checkedOf = (e: Event): boolean => (e.target as HTMLInputElement).checked
/** 批量时在标题后标一句「(N 个)」,让人知道这一下改的是几个 */
const many = (n: number): string => (n > 1 ? ` · ${n} 个` : '')

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
  const on = checkedOf(e)
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

// ---- 图元大小:等比倍数,或(设备框这类)自由宽高 ----
/** 选中的这些图元共同能用的放大倍数 */
const scales = computed(() => {
  const lists = nodes.value.map(n => {
    const def = getSldSymbol(n.symbol)
    return def ? validNodeScales(def) : [1]
  })
  return lists.length ? lists.reduce((acc, ks) => acc.filter(k => ks.includes(k)), lists[0]!) : [1]
})
/** 全部选中的图元都能自由改宽高时,才给宽高输入框 */
const freeAll = computed(
  () => nodes.value.length > 0 && nodes.value.every(n => isFreeSizeSymbol(getSldSymbol(n.symbol)))
)
const freeSize = computed(() => (node.value ? freeSizeOf(doc.value, node.value, getSldSymbol) : undefined))
/** 批量时用第一个的宽高打底 */
const freeFirst = computed(() => (nodes.value[0] ? freeSizeOf(doc.value, nodes.value[0], getSldSymbol) : undefined))
function setScale(e: Event): void {
  const list = nodeIds.value
  const k = Number(valueOf(e))
  ctx!.apply(d => (setNodeScale(d.doc, list, k, getSldSymbol) ? undefined : false), '改图元大小')
}
function setSize(which: 'w' | 'h', e: Event): void {
  const list = nodeIds.value
  const v = Number(valueOf(e))
  ctx!.apply(d => (setNodeSize(d.doc, list, { [which]: v }, getSldSymbol) ? undefined : false), '改图元宽高')
}
function colorNodes(color: string | undefined): void {
  const list = nodeIds.value
  ctx!.apply(d => (setNodeColor(d.doc, list, color) ? undefined : false), '改图元颜色')
}
// ---- 开关:没数据时按什么画 ----
const hasState = computed(() => nodes.value.some(n => !!n.state))
const stateFallback = computed<SldSwitchState>(() => nodes.value.find(n => n.state)?.state?.fallback ?? 'unknown')
function setFallback(e: Event): void {
  const list = nodeIds.value
  const v = valueOf(e) as SldSwitchState
  ctx!.apply(d => (setStateFallback(d.doc, list, v) ? undefined : false), '改「没数据时」的画法')
}
// ---- 母线 ----
function setBusWidthInput(e: Event): void {
  const list = busIds.value
  const w = Number(valueOf(e))
  ctx!.apply(d => (setBusWidth(d.doc, list, w) ? undefined : false), '改母线粗细')
}
function setBusColorInput(color: string | undefined): void {
  const list = busIds.value
  ctx!.apply(d => (setBusColor(d.doc, list, color) ? undefined : false), '改母线颜色')
}
// ---- 文字 ----
function styleLabel(patch: LabelStylePatch, what: string): void {
  const list = labelIds.value
  ctx!.apply(d => (setLabelStyle(d.doc, list, patch) ? undefined : false), what)
}
/** 标签颜色的下拉:随主题 / 三个相色 / 自定义(#hex);批量时看第一个 */
const labelFirst = computed(() => labels.value[0])
const labelColorMode = computed(() => {
  const c = labelFirst.value?.color
  return !c ? '' : c === 'a' || c === 'b' || c === 'c' ? c : 'custom'
})
function setLabelColorMode(e: Event): void {
  const v = valueOf(e)
  styleLabel({ color: v === 'custom' ? '#19b7ff' : v }, '改文字颜色')
}
/** 数值标签才有「数值列」:对齐后一组标签的数字排成一列 */
const valueLabels = computed(() => labels.value.filter(l => l.kind === 'value'))
const colW = computed(() => {
  const l = valueLabels.value[0]
  return l && l.kind === 'value' ? (l.colW ?? 0) : 0
})
function alignColumns(): void {
  const list = ids(valueLabels.value)
  ctx!.apply(d => (alignLabelColumns(d.doc, list) ? undefined : false), '对齐数值列')
}
function setColW(e: Event): void {
  const list = ids(valueLabels.value)
  const v = Number(valueOf(e))
  ctx!.apply(d => (setLabelStyle(d.doc, list, { colW: v }) ? undefined : false), '改数值列宽')
}
// ---- 分组框 ----
function styleFrame(patch: FrameStylePatch, what: string): void {
  const list = frameIds.value
  ctx!.apply(d => (setFrameStyle(d.doc, list, patch) ? undefined : false), what)
}
const frameFirst = computed(() => frames.value[0])
// ---- 层次 ----
/** 叠放层次:对当前选中的全部图元与母线 */
function stack(move: StackMove): void {
  const pickIds = { nodes: nodeIds.value, buses: busIds.value }
  const what = move === 'front' ? '置顶' : move === 'back' ? '置底' : '恢复默认层次'
  ctx!.apply(d => (setStacking(d.doc, pickIds, move) ? undefined : false), what)
}
const zText = (z: number | undefined): string => (!z ? '默认' : z > 0 ? `上移 ${z} 级` : `下移 ${-z} 级`)
const canStack = computed(() => nodes.value.length + buses.value.length > 0)

const LABEL_KIND_TEXT = { text: '文字', value: '数值', status: '状态(在线灯)' } as const

const endText = (e: { node: string; port: string } | { bus: string; d: number }): string =>
  'bus' in e ? `母线 ${e.bus} @ ${e.d}` : `${e.node} . ${e.port}`
</script>

<template>
  <div class="sld-insp">
    <p v-if="count === 0" class="sld-insp-hint">未选中元素。点选或框选画布上的元素。</p>
    <p v-else-if="count > 1" class="sld-insp-sum" data-role="selection-summary">
      已选中 {{ count }} 个:{{ summary }} —— 下面改的颜色 / 粗细 / 大小对<b>同类的全部选中项</b>生效。
    </p>

    <!-- ───────── 图元 ───────── -->
    <template v-if="nodes.length">
      <h4 v-if="count > nodes.length" class="sld-insp-h">图元{{ many(nodes.length) }}</h4>
      <template v-if="node">
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
      </template>

      <!-- 大小:设备框这类图元给宽高,其余给倍数 -->
      <template v-if="freeAll">
        <label class="sld-insp-row" title="设备框可以随便拉长宽(拖四角的手柄也行);宽高按步长吸附,端口才落得上栅格">
          <span>宽{{ many(nodes.length) }}</span>
          <input
            type="number"
            data-field="size-w"
            :step="freeFirst?.step.w ?? 20"
            :min="freeFirst?.step.w ?? 20"
            :value="(freeSize ?? freeFirst)?.w ?? ''"
            :disabled="ctx.readonly.value"
            @change="setSize('w', $event)"
          />
        </label>
        <label class="sld-insp-row">
          <span>高{{ many(nodes.length) }}</span>
          <input
            type="number"
            data-field="size-h"
            :step="freeFirst?.step.h ?? 20"
            :min="freeFirst?.step.h ?? 20"
            :value="(freeSize ?? freeFirst)?.h ?? ''"
            :disabled="ctx.readonly.value"
            @change="setSize('h', $event)"
          />
        </label>
      </template>
      <label
        v-else
        class="sld-insp-row"
        title="直接拖图元四角的手柄就能改大小(松手吸附到最近一档);这里是要精确倍数时用的"
      >
        <span>大小{{ many(nodes.length) }}</span>
        <select data-field="scale" :value="node?.scale ?? 1" :disabled="ctx.readonly.value" @change="setScale">
          <option v-for="k in scales" :key="k" :value="k">{{ k }} 倍</option>
        </select>
      </label>

      <div class="sld-insp-row" title="自定义颜色盖过电压等级色;图元失电时照样变灰">
        <span>颜色{{ many(nodes.length) }}</span>
        <input
          type="color"
          data-field="node-color"
          :value="nodes[0]?.color ?? '#19b7ff'"
          :disabled="ctx.readonly.value"
          @change="colorNodes(valueOf($event))"
        />
        <b v-if="!nodes[0]?.color" class="sld-insp-dim">随带电着色</b>
        <button
          v-else
          type="button"
          class="sld-insp-mini"
          :disabled="ctx.readonly.value"
          @click="colorNodes(undefined)"
        >
          恢复
        </button>
      </div>

      <div v-if="node?.entity" class="sld-insp-row">
        <span>设备</span><b>{{ node.entity.name }}</b>
      </div>
      <div v-if="node?.state" class="sld-insp-row">
        <span>状态测点</span><code>pt.{{ node.state.pt }}</code>
      </div>
      <label
        v-if="hasState"
        class="sld-insp-row"
        title="状态测点没数据 / 数据过期 / 值对不上映射时怎么画。回路只有电流没有位置信号时,选「按合闸画」"
      >
        <span>没数据时{{ many(nodes.length) }}</span>
        <select data-field="state-fallback" :value="stateFallback" :disabled="ctx.readonly.value" @change="setFallback">
          <option value="unknown">未知(虚线)</option>
          <option value="closed">按合闸画</option>
          <option value="open">按分闸画</option>
        </select>
      </label>
      <label v-if="node" class="sld-insp-row">
        <span>电源点</span>
        <input
          type="checkbox"
          data-field="source"
          :checked="!!node.source"
          :disabled="ctx.readonly.value"
          @change="toggleSource"
        />
      </label>
      <label v-if="node?.source" class="sld-insp-row">
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
          :value="node?.portKv?.[p] ?? ''"
          :disabled="ctx.readonly.value"
          placeholder="如 10、0.4"
          @change="setTrKv(p, $event)"
        />
      </label>
    </template>

    <!-- ───────── 母线 ───────── -->
    <template v-if="buses.length">
      <h4 v-if="count > buses.length" class="sld-insp-h">母线{{ many(buses.length) }}</h4>
      <template v-if="bus">
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
      </template>
      <label class="sld-insp-row">
        <span>粗细{{ many(buses.length) }}</span>
        <input
          type="number"
          data-field="bus-width"
          :min="BUS_WIDTH_MIN"
          :max="BUS_WIDTH_MAX"
          step="1"
          :value="buses[0]?.width ?? SLD_BUS_WIDTH"
          :disabled="ctx.readonly.value"
          @change="setBusWidthInput"
        />
      </label>
      <div class="sld-insp-row" title="自定义颜色盖过电压等级色;母线失电时照样变灰">
        <span>颜色{{ many(buses.length) }}</span>
        <input
          type="color"
          data-field="bus-color"
          :value="buses[0]?.color ?? '#19b7ff'"
          :disabled="ctx.readonly.value"
          @change="setBusColorInput(valueOf($event))"
        />
        <b v-if="!buses[0]?.color" class="sld-insp-dim">按电压等级</b>
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
      <template v-if="bus">
        <div class="sld-insp-row">
          <span>长度</span><b>{{ busLength(bus) }}</b>
        </div>
        <div class="sld-insp-row">
          <span>起点</span><b>{{ bus.x1 }}, {{ bus.y1 }}</b>
        </div>
      </template>
    </template>

    <!-- ───────── 文字 ───────── -->
    <template v-if="labels.length">
      <h4 v-if="count > labels.length" class="sld-insp-h">文字{{ many(labels.length) }}</h4>
      <template v-if="label">
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
      </template>
      <label class="sld-insp-row">
        <span>字号{{ many(labels.length) }}</span>
        <input
          type="number"
          data-field="label-size"
          :min="LABEL_SIZE_MIN"
          :max="LABEL_SIZE_MAX"
          step="1"
          :value="labelFirst?.size ?? LABEL_SIZE_DEFAULT"
          :disabled="ctx.readonly.value"
          @change="styleLabel({ size: Number(valueOf($event)) }, '改字号')"
        />
      </label>
      <label class="sld-insp-row">
        <span>加粗{{ many(labels.length) }}</span>
        <input
          type="checkbox"
          data-field="label-bold"
          :checked="!!labelFirst?.bold"
          :disabled="ctx.readonly.value"
          @change="styleLabel({ bold: checkedOf($event) }, '改粗细')"
        />
      </label>
      <div class="sld-insp-row">
        <span>颜色{{ many(labels.length) }}</span>
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
          :value="labelFirst?.color"
          :disabled="ctx.readonly.value"
          @change="styleLabel({ color: valueOf($event) }, '改文字颜色')"
        />
      </div>
      <div
        v-if="valueLabels.length"
        class="sld-insp-row"
        title="一组数值标签排成一列:前缀左对齐、数字右对齐、单位跟在数字后面。框选这一组,点「对齐」自动算列宽"
      >
        <span>数值列{{ many(valueLabels.length) }}</span>
        <input
          type="number"
          data-field="label-colw"
          min="0"
          step="2"
          :value="colW"
          :disabled="ctx.readonly.value"
          @change="setColW"
        />
        <button
          type="button"
          class="sld-insp-mini"
          data-role="align-columns"
          :disabled="ctx.readonly.value || valueLabels.length < 2"
          @click="alignColumns"
        >
          对齐
        </button>
      </div>
      <template v-if="label">
        <div v-if="label.kind !== 'text'" class="sld-insp-row">
          <span>测点</span><code>pt.{{ label.pt }}</code>
        </div>
        <div v-if="label.attach" class="sld-insp-row">
          <span>依附</span><code>{{ label.attach }}</code>
        </div>
      </template>
    </template>

    <!-- ───────── 分组框 ───────── -->
    <template v-if="frames.length">
      <h4 v-if="count > frames.length" class="sld-insp-h">分组框{{ many(frames.length) }}</h4>
      <template v-if="frame">
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
      <label class="sld-insp-row">
        <span>边框粗细{{ many(frames.length) }}</span>
        <input
          type="number"
          data-field="frame-width"
          :min="FRAME_WIDTH_MIN"
          :max="FRAME_WIDTH_MAX"
          step="1"
          :value="frameFirst?.width ?? FRAME_WIDTH_DEFAULT"
          :disabled="ctx.readonly.value"
          @change="styleFrame({ width: Number(valueOf($event)) }, '改分组框边框粗细')"
        />
      </label>
      <div class="sld-insp-row">
        <span>边框颜色{{ many(frames.length) }}</span>
        <input
          type="color"
          data-field="frame-color"
          :value="frameFirst?.color ?? '#5b7aa8'"
          :disabled="ctx.readonly.value"
          @change="styleFrame({ color: valueOf($event) }, '改分组框边框颜色')"
        />
        <b v-if="!frameFirst?.color" class="sld-insp-dim">随主题</b>
        <button
          v-else
          type="button"
          class="sld-insp-mini"
          :disabled="ctx.readonly.value"
          @click="styleFrame({ color: '' }, '改分组框边框颜色')"
        >
          恢复
        </button>
      </div>
      <label class="sld-insp-row">
        <span>实线边框</span>
        <input
          type="checkbox"
          data-field="frame-solid"
          :checked="!!frameFirst?.solid"
          :disabled="ctx.readonly.value"
          @change="styleFrame({ solid: checkedOf($event) }, '改分组框边框虚实')"
        />
      </label>
    </template>

    <!-- ───────── 层次(图元 / 母线共用) ───────── -->
    <div
      v-if="canStack"
      class="sld-insp-row"
      title="重叠时谁压着谁。默认:图元压连线、连线压母线。也可以用工具栏的「置顶 / 置底」(快捷键 ] 与 [)"
    >
      <span>层次</span>
      <b data-field="z">{{ count === 1 ? zText(node?.z ?? bus?.z) : '' }}</b>
      <button type="button" class="sld-insp-mini" :disabled="ctx.readonly.value" @click="stack('front')">置顶</button>
      <button type="button" class="sld-insp-mini" :disabled="ctx.readonly.value" @click="stack('back')">置底</button>
      <button type="button" class="sld-insp-mini" :disabled="ctx.readonly.value" @click="stack('reset')">复位</button>
    </div>

    <!-- ───────── 连线 ───────── -->
    <template v-if="wire">
      <h4 v-if="count > 1" class="sld-insp-h">连线</h4>
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
.sld-insp-sum b {
  color: var(--ed-accent, #19b7ff);
}
.sld-insp-sum {
  margin: 0 0 8px;
  padding: 6px 8px;
  border-radius: 4px;
  background: rgba(25, 183, 255, 0.08);
  line-height: 1.5;
}
.sld-insp-h {
  margin: 12px 0 2px;
  font-size: 12px;
  font-weight: 600;
  color: var(--ed-accent, #19b7ff);
}
.sld-insp-h:first-child {
  margin-top: 0;
}
.sld-insp-row {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 28px;
}
.sld-insp-row > span {
  flex: none;
  width: 72px;
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
.sld-insp-mini:disabled {
  opacity: 0.4;
  cursor: default;
}
.sld-insp-row > input:focus {
  border-color: var(--ed-accent, #19b7ff);
}
</style>
