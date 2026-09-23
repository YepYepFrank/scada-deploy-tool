<script setup lang="ts">
/**
 * 「绑定」面板(T5.6):只用 inject(SLD_EDITOR_CTX),不碰 X6、不收 props;所有修改经 ctx.apply,一次操作一步撤销。
 * - 顶部:可折叠的「设备树」,选中设备后可拖到画布(DataTransfer = application/x-grid-entity)或放到画布中央;
 * - 没选中 / 多选:整张图的测点概览,点一条未绑的 → 选中并滚到视口中央;
 * - 选中一个节点:设备、开关状态(测点 + 值映射)、依附的数值标签;
 * - 选中一个数值标签:单条编辑。
 * host.tree 为空时顶部提示「未连接平台」,映射表与格式照样能改;只读时整个面板禁用(fieldset disabled)。
 * 快速绑定(2026-09-23):没绑的测点直接展开这台设备的测点列表(QuickPointPicker),点一行就绑上,绑完自动轮到下一个;
 * 设备缺省 = 节点的设备,没有就沿用上一台(最近用过的设备,按站点记在本机)。原来的 BindingRow 收在「其他方式」里。
 */
import { computed, inject, provide, ref, watch } from 'vue'
import { collectPointRefs, getSldSymbol, isContextRef, type Binding, type BindingSlotSpec } from '@grid/scada-renderer'
import type { EntityRef } from '@grid/tb-client'
import BindingRow from '../../../editor/BindingRow.vue'
import EntityTree from '../../../editor/EntityTree.vue'
import type { MetaNode } from '../../../meta/MetaNode'
import { DEFAULT_STATE_MAP, type SldStateMap } from '../../device-defaults'
import { SLD_EDITOR_CTX } from '../../ext'
import { ENTITY_DRAG_TYPE, centerSpot, dragDataOf, placeEntity } from './drop'
import MapEditor from './MapEditor.vue'
import QuickPointPicker from './QuickPointPicker.vue'
import { QUICK_BIND, openSlotOf, type QuickBindState } from './quick'
import { recentDevices, rememberDevice } from './recent'
import {
  addValueLabel,
  attachedValueLabels,
  bindingOf,
  bindingTarget,
  clearState,
  enableOnlineForNodes,
  findEntityByName,
  hydrateBinding,
  invertStateMap,
  isPointBound,
  quickBindState,
  selectionOfRef,
  setNodeEntity,
  setNodeOnline,
  setOnlineBinding,
  setOnlineCorner,
  setStateBinding,
  setStatusLabelBinding,
  setStateMap,
  unboundRefs,
  withDefaultEntity,
  type QuickDevice,
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

/* ───────────── 快速绑定:当前设备 / 最近设备 / 展开哪个列表 ───────────── */

const site = ctx.host.siteName
const recent = recentDevices(site)
/** 绑定里带 id 的实体记进最近设备(BindingRow 里手动选的也算) */
function rememberFrom(b: Binding | null): void {
  const e = b && 'entity' in b ? b.entity : undefined
  if (e && !isContextRef(e)) rememberDevice(site, e)
}
/** 节点(或独立数值标签依附的节点)的设备,回设备树补上 id */
const hostDevice = computed<QuickDevice | null>(() => {
  const e = node.value?.entity ?? soloLabelEntity.value
  const hit = e ? findEntityByName(tree.value, e.type, e.name) : undefined
  return e && hit?.id ? { type: hit.type, id: hit.id, name: hit.name || e.name } : null
})
const deviceOverride = ref<QuickDevice | null>(null)
const explicitOpen = ref<string | null | undefined>(undefined)
// 换了选中对象:设备回到缺省、列表回到「自动展开第一个没绑的」
watch(
  () => JSON.stringify(target.value),
  () => {
    deviceOverride.value = null
    explicitOpen.value = undefined
  }
)
const quickDevice = computed(() => deviceOverride.value ?? hostDevice.value ?? recent.value[0] ?? null)
const labelBound = (pt: string): boolean => isPointBound(bindingOf(content.value, pt))
/** 还没绑的测点,按面板上从上到下的顺序 */
const unboundSlots = computed<string[]>(() => {
  const solo = soloLabel.value
  if (solo?.kind === 'value') return labelBound(solo.pt) ? [] : [`label:${solo.id}`]
  if (!node.value) return []
  const out: string[] = []
  if (hasStateBody.value && !stateBound.value) out.push('state')
  for (const l of labels.value) if (!labelBound(l.pt)) out.push(`label:${l.id}`)
  return out
})
const quick: QuickBindState = {
  device: quickDevice,
  recent,
  isOpen: slot => openSlotOf(explicitOpen.value, unboundSlots.value) === slot,
  toggle: slot => {
    explicitOpen.value = quick.isOpen(slot) ? null : slot
  },
  useDevice: d => {
    deviceOverride.value = d
    rememberDevice(site, d)
  },
  picked: () => {
    explicitOpen.value = undefined
  },
}
provide(QUICK_BIND, quick)

/* ───────────── 设备树(拖进画布) ───────────── */

const treeOpen = ref(false)
const picked = ref<MetaNode>()
function pickForDrag(e: EntityRef, n: MetaNode): void {
  picked.value = n
  rememberDevice(site, { type: e.type, id: e.id, name: e.name || n.name })
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
function refText(r: { pt: string; from: 'state' | 'label' | 'online'; owner: string }): string {
  if (r.from !== 'label') {
    const n = doc.value.nodes.find(x => x.id === r.owner)
    return `${n?.name || r.owner} · ${r.from === 'online' ? '在线状态' : '开关状态'}`
  }
  const l = doc.value.labels.find(x => x.id === r.owner)
  const host = l?.attach ? doc.value.nodes.find(x => x.id === l.attach) : undefined
  const title = l?.kind === 'status' ? `状态标签 ${l.title ?? ''}` : l?.kind === 'value' && l.title ? l.title : '数值'
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
  if (name) rememberDevice(site, { type: e.type, id: e.id, name })
  deviceOverride.value = null
}
/** 节点没设备时一键沿用上一台 */
function useRecentEntity(): void {
  const id = node.value?.id
  const last = recent.value[0]
  if (!id || !last) return
  ctx!.apply(d => setNodeEntity(d, id, { type: last.type, name: last.name }), '沿用上一台设备')
  rememberDevice(site, last)
  deviceOverride.value = null
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
  rememberFrom(next)
}
/** 测点列表里点了一行 */
function quickState(d: QuickDevice, key: string): void {
  const n = node.value
  if (!n) return
  if (ctx!.apply(draft => quickBindState(draft, n.id, d, key, () => ctx!.newId('p')), '绑定开关状态')) {
    rememberDevice(site, d)
    quick.picked()
  }
}
const stateKey = computed(() => {
  const b = stateBinding.value
  return b && 'key' in b && typeof b.key === 'string' ? b.key : undefined
})
const stateDevice = computed(() => {
  const b = stateBinding.value
  return b && 'entity' in b && b.entity && !isContextRef(b.entity) ? b.entity.name : undefined
})
/** 「其他方式」:属性 / 常量 / 手动选,即原来的 BindingRow */
const stateManual = ref(false)
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

/* ───────────── 在线状态(2026-09-20) ───────────── */

const ONLINE_HINT = '一般绑设备的服务端属性 active(平台自己维护:设备上线为 true、掉线为 false)'
const onlineSpec = computed<BindingSlotSpec>(() => ({
  name: `pt.${node.value?.online?.pt ?? soloStatus.value?.pt ?? 'new'}`,
  title: '在线状态',
  valueType: 'any',
  modes: ['attr', 'ts', 'const'],
}))
const onlineBinding = computed(() =>
  node.value?.online ? hydrateBinding(bindingOf(content.value, node.value.online.pt), tree.value) : null
)
function toggleOnline(e: Event): void {
  const n = node.value
  if (!n) return
  const on = (e.target as HTMLInputElement).checked
  ctx!.apply(d => setNodeOnline(d, n.id, on, tree.value, () => ctx!.newId('p')), on ? '加在线状态灯' : '去掉在线状态灯')
}
function setOnlinePoint(b: Binding | null): void {
  const n = node.value
  if (!n) return
  const next = withDefaultEntity(b, n.entity, tree.value)
  ctx!.apply(d => setOnlineBinding(d, n.id, next, () => ctx!.newId('p')), '改在线状态测点')
  rememberFrom(next)
}
function setCorner(e: Event): void {
  const id = node.value?.id
  const at = (e.target as HTMLSelectElement).value as 'tl' | 'tr' | 'bl' | 'br'
  if (id) ctx!.apply(d => setOnlineCorner(d, id, at), '改状态灯位置')
}
/** 多选:选中的节点里有设备、还没灯的,一次全开 */
const onlineCandidates = computed(() => {
  const ids = new Set(ctx.selection.value.nodes)
  return doc.value.nodes.filter(n => ids.has(n.id) && n.entity && !n.online).map(n => n.id)
})
function enableOnlineBatch(): void {
  const ids = onlineCandidates.value
  if (!ids.length) return
  ctx!.apply(
    d => (enableOnlineForNodes(d, ids, tree.value, () => ctx!.newId('p')) ? undefined : false),
    `给 ${ids.length} 台设备加在线状态灯`
  )
}

/** 选中的单个状态标签(灯 + 文字,标整站 / 某一路通讯) */
const soloStatus = computed(() => {
  const t = target.value
  const l = t.kind === 'status' ? doc.value.labels.find(x => x.id === t.id) : undefined
  return l?.kind === 'status' ? l : undefined
})
const statusBinding = computed(() =>
  soloStatus.value ? hydrateBinding(bindingOf(content.value, soloStatus.value.pt), tree.value) : null
)
function setStatusPoint(b: Binding | null): void {
  const id = soloStatus.value?.id
  if (id) ctx!.apply(d => setStatusLabelBinding(d, id, b, () => ctx!.newId('p')), '改状态标签测点')
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
            v-if="!node.entity && recent[0]"
            type="button"
            class="sld-bd-mini"
            data-role="use-recent-entity"
            :title="'沿用上一台:' + recent[0].name"
            @click="useRecentEntity"
          >
            沿用上一台
          </button>
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
        <QuickPointPicker
          v-if="quick.isOpen('state')"
          :bound-key="stateKey"
          :bound-device="stateDevice"
          @pick="quickState"
        />
        <div class="sld-bd-row">
          <button type="button" class="sld-bd-link" data-role="qp-toggle" @click="quick.toggle('state')">
            {{ quick.isOpen('state') ? '收起测点列表' : stateBound ? '换测点' : '展开测点列表' }}
          </button>
          <span class="sld-bd-grow" />
          <button
            v-if="!stateBound"
            type="button"
            class="sld-bd-link"
            data-role="manual-toggle"
            @click="stateManual = !stateManual"
          >
            {{ stateManual ? '收起' : '其他方式(属性 / 常量)' }}
          </button>
        </div>
        <BindingRow
          v-if="stateBound || stateManual"
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

      <section class="sld-bd-sec" data-sec="online">
        <h4 class="sld-bd-sec-title">
          <label class="sld-bd-check">
            <input type="checkbox" data-role="online-toggle" :checked="!!node.online" @change="toggleOnline" />
            在线状态灯
          </label>
          <i v-if="node.online && !isPointBound(onlineBinding)" class="sld-bd-dot" title="未绑定" />
          <code v-if="node.online">pt.{{ node.online.pt }}</code>
        </h4>
        <template v-if="node.online">
          <BindingRow
            :key="`online-${node.id}`"
            :spec="onlineSpec"
            :model-value="onlineBinding"
            :tree="tree"
            :client="client"
            :declared="declared"
            @update:model-value="setOnlinePoint"
          />
          <label class="sld-bd-row">
            <span class="sld-bd-hint">灯的位置</span>
            <select data-role="online-corner" :value="node.online.at ?? 'tr'" @change="setCorner">
              <option value="tr">右上</option>
              <option value="tl">左上</option>
              <option value="br">右下</option>
              <option value="bl">左下</option>
            </select>
          </label>
        </template>
        <p class="sld-bd-hint">
          在线 = 绿点呼吸,离线 = 红点常亮,没数据 = 灰点。节点有设备时勾上就自动绑好。{{ ONLINE_HINT }}。
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

    <!-- 选中一个状态标签(灯 + 文字):标整个站点 / 某一路通讯的在线与否 -->
    <section v-else-if="soloStatus" class="sld-bd-sec" data-sec="status">
      <h4 class="sld-bd-sec-title">
        状态标签
        <i v-if="!isPointBound(statusBinding)" class="sld-bd-dot" title="未绑定" />
        <code>pt.{{ soloStatus.pt }}</code>
      </h4>
      <BindingRow
        :key="`status-${soloStatus.id}`"
        :spec="onlineSpec"
        :model-value="statusBinding"
        :tree="tree"
        :client="client"
        :declared="declared"
        @update:model-value="setStatusPoint"
      />
      <p class="sld-bd-hint">
        标整个站点就绑**网关设备**的 active(站点在设备树里就是那台网关)。{{
          ONLINE_HINT
        }}。文字、字号、颜色在「属性」页签里改。
      </p>
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
      <p v-if="onlineCandidates.length" class="sld-bd-row">
        <button type="button" class="sld-bd-mini" data-role="online-batch" @click="enableOnlineBatch">
          给选中的 {{ onlineCandidates.length }} 台设备加在线状态灯
        </button>
      </p>
      <p class="sld-bd-hint">选中一个节点或标签可编辑它的测点;框选多台设备可以一次加在线状态灯。</p>
    </section>
  </fieldset>
</template>

<style>
.sld-bd-check {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  cursor: pointer;
}
.sld-bd select {
  padding: 3px 6px;
  color: inherit;
  background: var(--ed-bg-0, #061024);
  border: 1px solid var(--ed-line, rgba(83, 196, 255, 0.2));
  border-radius: 4px;
}
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
