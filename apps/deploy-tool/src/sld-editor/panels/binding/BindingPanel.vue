<script setup lang="ts">
/**
 * 「绑定」面板(T5.6):只用 inject(SLD_EDITOR_CTX),不碰 X6、不收 props;所有修改经 ctx.apply,一次操作一步撤销。
 * - 顶部:可折叠的「设备树」,选中设备后可拖到画布(DataTransfer = application/x-grid-entity)或放到画布中央;
 * - 没选中 / 多选:整张图的测点概览,点一条未绑的 → 选中并滚到视口中央;
 * - 选中一个节点:设备、开关状态(测点 + 值映射)、依附的数值标签;
 * - 选中一个数值标签:单条编辑。
 * host.tree 为空时顶部提示「未连接平台」,映射表与格式照样能改;只读时整个面板禁用(fieldset disabled)。
 */
import { computed, inject, ref } from 'vue'
import { collectPointRefs, getSldSymbol, type Binding, type BindingSlotSpec } from '@grid/scada-renderer'
import type { EntityRef } from '@grid/tb-client'
import BindingRow from '../../../editor/BindingRow.vue'
import EntityTree from '../../../editor/EntityTree.vue'
import type { MetaNode } from '../../../meta/MetaNode'
import { DEFAULT_STATE_MAP, type SldStateMap } from '../../device-defaults'
import { SLD_EDITOR_CTX } from '../../ext'
import { ENTITY_DRAG_TYPE, centerSpot, dragDataOf, placeEntity } from './drop'
import MapEditor from './MapEditor.vue'
import {
  addValueLabel,
  attachedValueLabels,
  bindingOf,
  bindingTarget,
  clearState,
  findEntityByName,
  hydrateBinding,
  invertStateMap,
  isPointBound,
  selectionOfRef,
  setNodeEntity,
  setStateBinding,
  setStateMap,
  unboundRefs,
  withDefaultEntity,
} from './ops'
import ValueLabelEditor from './ValueLabelEditor.vue'

const ctx = inject(SLD_EDITOR_CTX)
if (!ctx) throw new Error('BindingPanel 必须放在 <SldEditor> 里')

const content = computed(() => ctx.content.value)
const doc = computed(() => content.value.doc)
const readonly = computed(() => ctx.readonly.value)
const tree = computed<MetaNode | null>(() => ctx.host.tree ?? null)
const client = computed(() => ctx.host.client ?? null)
const declared = computed(() => ctx.host.declared ?? null)

const target = computed(() => bindingTarget(doc.value, ctx.selection.value))
const node = computed(() => {
  const t = target.value
  return t.kind === 'node' ? doc.value.nodes.find(n => n.id === t.id) : undefined
})
const def = computed(() => (node.value ? getSldSymbol(node.value.symbol) : undefined))
const soloLabel = computed(() => {
  const t = target.value
  return t.kind === 'label' ? doc.value.labels.find(l => l.id === t.id) : undefined
})
const soloLabelEntity = computed(() => {
  const at = soloLabel.value?.attach
  return at ? doc.value.nodes.find(n => n.id === at)?.entity : undefined
})

/* ───────────── 设备树(拖进画布) ───────────── */

const treeOpen = ref(false)
const picked = ref<MetaNode>()
function pickForDrag(_e: EntityRef, n: MetaNode): void {
  picked.value = n
}
function onDragStart(e: DragEvent): void {
  const data = picked.value && dragDataOf(picked.value)
  if (!data || readonly.value || !e.dataTransfer) {
    e.preventDefault()
    return
  }
  e.dataTransfer.setData(ENTITY_DRAG_TYPE, JSON.stringify(data))
  e.dataTransfer.effectAllowed = 'copy'
}
async function placeCenter(): Promise<void> {
  const data = picked.value && dragDataOf(picked.value)
  if (!data) return
  const id = await placeEntity(ctx!, data, centerSpot(ctx!, data))
  if (id) ctx!.select({ nodes: [id] }, { center: true })
}

/* ───────────── 概览 ───────────── */

const refs = computed(() => collectPointRefs(doc.value))
const unbound = computed(() => unboundRefs(content.value))
function refText(r: { pt: string; from: 'state' | 'label'; owner: string }): string {
  if (r.from === 'state') {
    const n = doc.value.nodes.find(x => x.id === r.owner)
    return `${n?.name || r.owner} · 开关状态`
  }
  const l = doc.value.labels.find(x => x.id === r.owner)
  const host = l?.attach ? doc.value.nodes.find(x => x.id === l.attach) : undefined
  const title = l?.kind === 'value' && l.title ? l.title : '数值'
  return host ? `${host.name || host.id} · ${title}` : `标签 ${r.owner} · ${title}`
}

/* ───────────── 节点:设备 ───────────── */

const entityPicking = ref(false)
const entityRef = computed(() =>
  node.value?.entity ? findEntityByName(tree.value, node.value.entity.type, node.value.entity.name) : undefined
)
function pickEntity(e: EntityRef, n: MetaNode): void {
  entityPicking.value = false
  const id = node.value?.id
  const name = e.name || n.name
  if (id && name) ctx!.apply(d => setNodeEntity(d, id, { type: e.type, name }), '选择设备')
}
function clearEntity(): void {
  const id = node.value?.id
  if (id) ctx!.apply(d => setNodeEntity(d, id, null), '清除设备')
}

/* ───────────── 节点:开关状态 ───────────── */

const hasStateBody = computed(() => !!def.value?.stateBody)
const stateSpec = computed<BindingSlotSpec>(() => ({
  name: `pt.${node.value?.state?.pt ?? 'new'}`,
  title: '状态测点',
  valueType: 'any',
  modes: ['ts', 'attr', 'const'],
}))
const stateBinding = computed(() =>
  node.value?.state ? hydrateBinding(bindingOf(content.value, node.value.state.pt), tree.value) : null
)
const stateBound = computed(() => isPointBound(stateBinding.value))
const STATE_OPTIONS = [
  { value: 'closed', label: '合' },
  { value: 'open', label: '分' },
]
function setStatePoint(b: Binding | null): void {
  const n = node.value
  if (!n) return
  const next = withDefaultEntity(b, n.entity, tree.value)
  ctx!.apply(d => setStateBinding(d, n.id, next, () => ctx!.newId('p')), '改状态测点')
}
function setMap(map: Record<string, string>): void {
  const id = node.value?.id
  if (id) ctx!.apply(d => setStateMap(d, id, map as SldStateMap), '改状态映射')
}
function invert(): void {
  const n = node.value
  if (n?.state) ctx!.apply(d => setStateMap(d, n.id, invertStateMap(n.state!.map)), '状态映射取反')
}
function removeState(): void {
  const id = node.value?.id
  if (id) ctx!.apply(d => clearState(d, id), '清除状态测点')
}

/* ───────────── 节点:数值标签 ───────────── */

const labels = computed(() => (node.value ? attachedValueLabels(doc.value, node.value.id) : []))
function addLabel(): void {
  const id = node.value?.id
  if (!id) return
  ctx!.apply(d => {
    if (!addValueLabel(d, id, { label: ctx!.newId('l'), pt: ctx!.newId('p') }, getSldSymbol)) return false
  }, '添加数值标签')
}
</script>

<template>
  <fieldset class="sld-bd" :disabled="readonly" :data-readonly="readonly || undefined">
    <p v-if="!tree" class="sld-bd-warn" data-role="no-tree">未连接平台,无法选设备 / 测点</p>

    <!-- 设备树:选中设备后拖到画布 -->
    <section v-if="tree" class="sld-bd-sec" data-sec="tree">
      <button type="button" class="sld-bd-link sld-bd-sec-title" data-role="toggle-tree" @click="treeOpen = !treeOpen">
        {{ treeOpen ? '▾' : '▸' }} 设备树(拖设备进画布)
      </button>
      <template v-if="treeOpen">
        <EntityTree :root="tree" :selected-id="picked?.id ?? null" :height="220" @select="pickForDrag" />
        <div v-if="picked" class="sld-bd-drag">
          <span
            class="sld-bd-handle"
            :draggable="!readonly"
            data-role="drag-handle"
            title="按住拖到画布上"
            @dragstart="onDragStart"
          >
            ⠿ 拖到画布:{{ picked.name }}
          </span>
          <button type="button" class="sld-bd-mini" data-role="place-center" @click="placeCenter">放到画布中央</button>
        </div>
        <p v-else class="sld-bd-hint">点一台设备,再把出现的手柄拖到画布上。</p>
      </template>
    </section>

    <!-- 选中一个节点 -->
    <template v-if="node">
      <section class="sld-bd-sec" data-sec="entity">
        <h4 class="sld-bd-sec-title">设备</h4>
        <div class="sld-bd-row">
          <b v-if="node.entity" data-field="entity">
            {{ node.entity.type === 'ASSET' ? '◆' : '▫' }} {{ node.entity.name }}
            <em v-if="tree && !entityRef" class="sld-bd-bad">(平台上找不到)</em>
          </b>
          <span v-else class="sld-bd-hint">未指定</span>
          <span class="sld-bd-grow" />
          <button
            type="button"
            class="sld-bd-mini"
            data-role="pick-entity"
            :disabled="!tree"
            @click="entityPicking = !entityPicking"
          >
            选择设备
          </button>
          <button v-if="node.entity" type="button" class="sld-bd-mini" data-role="clear-entity" @click="clearEntity">
            清除
          </button>
        </div>
        <EntityTree
          v-if="entityPicking && tree"
          :root="tree"
          :selected-id="entityRef?.id ?? null"
          :height="220"
          @select="pickEntity"
        />
      </section>

      <section v-if="hasStateBody" class="sld-bd-sec" data-sec="state">
        <h4 class="sld-bd-sec-title">
          开关状态
          <i v-if="node.state && !stateBound" class="sld-bd-dot" title="未绑定" />
          <code v-if="node.state">pt.{{ node.state.pt }}</code>
        </h4>
        <BindingRow
          :key="node.id"
          :spec="stateSpec"
          :model-value="stateBinding"
          :tree="tree"
          :client="client"
          :declared="declared"
          @update:model-value="setStatePoint"
        />
        <template v-if="node.state">
          <div class="sld-bd-row">
            <span class="sld-bd-hint">值映射(值 → 合 / 分;映射不上按「未知」)</span>
            <span class="sld-bd-grow" />
            <button type="button" class="sld-bd-mini" data-role="invert" @click="invert">取反</button>
          </div>
          <MapEditor
            :model-value="node.state.map"
            :options="STATE_OPTIONS"
            default-value="open"
            @update:model-value="setMap"
          />
          <button type="button" class="sld-bd-link sld-bd-danger" data-role="clear-state" @click="removeState">
            去掉状态测点(视为常合)
          </button>
        </template>
        <p v-else class="sld-bd-hint">
          没配状态测点时视为常合。选好测点后默认映射 {{ Object.keys(DEFAULT_STATE_MAP).join(' / ') }} → 合 / 分。
        </p>
      </section>

      <section class="sld-bd-sec" data-sec="labels">
        <h4 class="sld-bd-sec-title">数值标签({{ labels.length }})</h4>
        <ValueLabelEditor v-for="l in labels" :key="l.id" :label-id="l.id" :default-entity="node.entity" />
        <button type="button" class="sld-bd-mini" data-role="add-label" @click="addLabel">+ 添加数值标签</button>
      </section>
    </template>

    <!-- 选中一个数值标签 -->
    <section v-else-if="soloLabel" class="sld-bd-sec" data-sec="label">
      <h4 class="sld-bd-sec-title">数值标签</h4>
      <ValueLabelEditor :label-id="soloLabel.id" :default-entity="soloLabelEntity" />
    </section>

    <!-- 概览 -->
    <section v-else class="sld-bd-sec" data-sec="overview">
      <h4 class="sld-bd-sec-title">测点概览</h4>
      <p class="sld-bd-row" data-role="summary">
        共 {{ refs.length }} 处引用 · 已绑 <b>{{ refs.length - unbound.length }}</b> · 未绑
        <b :class="{ 'sld-bd-bad': unbound.length }">{{ unbound.length }}</b>
      </p>
      <ul v-if="unbound.length" class="sld-bd-list">
        <li v-for="r in unbound" :key="`${r.from}:${r.owner}`">
          <button
            type="button"
            class="sld-bd-link"
            data-role="unbound"
            @click="ctx.select(selectionOfRef(r), { center: true })"
          >
            {{ refText(r) }} <code>pt.{{ r.pt }}</code>
          </button>
        </li>
      </ul>
      <p class="sld-bd-hint">选中一个节点或数值标签可编辑它的测点。</p>
    </section>
  </fieldset>
</template>

<style>
.sld-bd {
  min-width: 0;
  margin: 0;
  padding: 8px 10px;
  font-size: 12px;
  border: 0;
}
.sld-bd-warn {
  margin: 0 0 8px;
  padding: 6px 8px;
  color: #f59e0b;
  background: rgba(245, 158, 11, 0.1);
  border-radius: 4px;
}
.sld-bd-sec,
.sld-bd-label,
.sld-bd-sub,
.sld-bd-map,
.sld-bd .br {
  grid-template-columns: minmax(0, 1fr);
}
.sld-bd .br .kp {
  min-width: 0;
}
/* 复用的 BindingRow / KeyPicker 在窄面板里:长设备名 / 测点名截断,不把面板撑出横向滚动 */
.sld-bd .br-entity,
.sld-bd .kp-btn {
  min-width: 0;
  max-width: 100%;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.sld-bd .kp-sel {
  overflow: hidden;
  text-overflow: ellipsis;
}
.sld-bd-sec {
  display: grid;
  gap: 6px;
  padding: 8px 0;
  border-bottom: 1px solid var(--ed-line, rgba(83, 196, 255, 0.2));
}
.sld-bd-sec-title {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 0;
  font-size: 12px;
  font-weight: 600;
}
.sld-bd-row {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 0;
  min-height: 24px;
}
.sld-bd-grow {
  flex: 1;
}
.sld-bd-hint {
  margin: 0;
  opacity: 0.6;
}
.sld-bd-bad {
  color: #f87171;
  font-style: normal;
}
.sld-bd-dot {
  display: inline-block;
  width: 7px;
  height: 7px;
  background: #f59e0b;
  border-radius: 50%;
}
.sld-bd button {
  color: inherit;
  font: inherit;
  cursor: pointer;
}
.sld-bd button:disabled {
  cursor: not-allowed;
  opacity: 0.5;
}
.sld-bd-mini {
  padding: 2px 8px;
  background: none;
  border: 1px solid var(--ed-line, rgba(83, 196, 255, 0.3));
  border-radius: 4px;
}
.sld-bd-mini:hover:not(:disabled) {
  border-color: var(--ed-accent, #19b7ff);
}
.sld-bd-link {
  padding: 0;
  text-align: left;
  background: none;
  border: 0;
}
.sld-bd-danger {
  color: #f87171 !important;
}
.sld-bd-list {
  display: grid;
  gap: 2px;
  margin: 0;
  padding: 0;
  list-style: none;
}
.sld-bd-list .sld-bd-link:hover {
  color: var(--ed-accent, #19b7ff);
}
.sld-bd-drag {
  display: flex;
  align-items: center;
  gap: 6px;
}
.sld-bd-handle {
  flex: 1;
  min-width: 0;
  padding: 4px 8px;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  background: rgba(25, 183, 255, 0.12);
  border: 1px dashed var(--ed-accent, #19b7ff);
  border-radius: 4px;
  cursor: grab;
}
.sld-bd[data-readonly] .sld-bd-handle {
  cursor: not-allowed;
  opacity: 0.5;
}
.sld-bd-label {
  display: grid;
  gap: 6px;
  padding: 6px;
  background: rgba(0, 0, 0, 0.15);
  border: 1px solid var(--ed-line, rgba(83, 196, 255, 0.2));
  border-radius: 6px;
}
.sld-bd-label-head {
  display: flex;
  align-items: center;
  gap: 6px;
}
.sld-bd-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 4px 8px;
}
.sld-bd-grid > label {
  display: flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
}
.sld-bd-grid > label > span {
  flex: none;
  width: 40px;
  opacity: 0.6;
}
.sld-bd input,
.sld-bd select {
  min-width: 0;
  padding: 3px 5px;
  color: inherit;
  font: inherit;
  background: var(--ed-bg-0, #061024);
  border: 1px solid var(--ed-line, rgba(83, 196, 255, 0.2));
  border-radius: 4px;
  outline: none;
}
.sld-bd-grid input,
.sld-bd-grid select {
  flex: 1;
  width: 100%;
}
.sld-bd input[type='color'] {
  height: 24px;
  padding: 0 2px;
}
.sld-bd-sub {
  display: grid;
  gap: 4px;
}
.sld-bd-map {
  display: grid;
  gap: 4px;
}
.sld-bd-map-row {
  display: flex;
  align-items: center;
  gap: 4px;
}
.sld-bd-map-k {
  width: 64px;
}
.sld-bd-map-v {
  flex: 1;
}
.sld-bd-map > .sld-bd-mini {
  justify-self: start;
}
.sld-bd-x {
  padding: 0 6px;
  background: none;
  border: 0;
  opacity: 0.6;
}
</style>
