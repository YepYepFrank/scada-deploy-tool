<script setup lang="ts">
/**
 * 「属性」面板(示例扩展):只用 inject(SLD_EDITOR_CTX),不碰 X6、不收 props。
 * 选中单个节点:id / 图元 / 名称(可改)/ 旋转 / 镜像;单个母线、标签、分组框:各自的一两个基本字段。
 * 输入框在 change(回车 / 失焦)时提交,一次提交 = 撤销栈里的一步。
 */
import { computed, inject } from 'vue'
import { busLength, getSldSymbol } from '@grid/scada-renderer'
import { SLD_EDITOR_CTX } from '../../ext'

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
      <div v-if="node.entity" class="sld-insp-row">
        <span>设备</span><b>{{ node.entity.name }}</b>
      </div>
      <div v-if="node.state" class="sld-insp-row">
        <span>状态测点</span><code>pt.{{ node.state.pt }}</code>
      </div>
    </template>

    <template v-else-if="bus">
      <div class="sld-insp-row">
        <span>id</span><code>{{ bus.id }}</code>
      </div>
      <label class="sld-insp-row">
        <span>名称</span>
        <input :value="bus.name ?? ''" :disabled="ctx.readonly.value" @change="setBusName" />
      </label>
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
        <span>类型</span><b>{{ label.kind === 'text' ? '文字' : '数值' }}</b>
      </div>
      <label class="sld-insp-row">
        <span>{{ label.kind === 'text' ? '文字' : '前缀' }}</span>
        <input
          :value="label.kind === 'text' ? label.text : (label.title ?? '')"
          :disabled="ctx.readonly.value"
          @change="setLabelText"
        />
      </label>
      <div v-if="label.kind === 'value'" class="sld-insp-row">
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
.sld-insp-row > input:focus {
  border-color: var(--ed-accent, #19b7ff);
}
</style>
