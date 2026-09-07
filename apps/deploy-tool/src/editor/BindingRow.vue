<script setup lang="ts">
/**
 * 一条绑定的编辑(T3.4):mode(受槽位 modes 限制)→ 实体(元数据树)→ key(KeyPicker,含 calc_ 结果 key)→ 附加参数。
 *   ts:entity + key · attr:entity + scope + key · ts-history:entity + keys[] + window + agg
 *   alarm:entity + types[](可空 = 全部)· const:值(JSON 或文本)· ext:source + window + interval + params(JSON,形状待冻结)
 * 只负责产出契约形状的 Binding;校验(必填 / 类型)由 BindingsPanel 与校验层做。
 */
import { computed, ref, watch } from 'vue'
import type { Binding, BindingMode, BindingSlotSpec } from '@grid/scada-renderer'
import type { EntityRef } from '@grid/tb-client'
import KeyPicker from '../components/KeyPicker.vue'
import EntityTree from './EntityTree.vue'
import type { KeyInfo, MetaClient, MetaNode } from '../meta/MetaNode'
import { emptyBinding } from './binding-check'

const props = defineProps<{
  spec: BindingSlotSpec
  modelValue: Binding | null
  tree: MetaNode | null
  client: MetaClient | null
}>()
const emit = defineEmits<{ 'update:modelValue': [b: Binding | null] }>()

const ALL_MODES: BindingMode[] = ['ts', 'ts-history', 'attr', 'alarm', 'const', 'ext']
const MODE_LABEL: Record<BindingMode, string> = {
  ts: '实时遥测',
  'ts-history': '历史曲线',
  attr: '属性',
  alarm: '告警',
  const: '常量',
  ext: '外部(kz)',
}
const WINDOWS = ['15m', '1h', '2h', '6h', '12h', '24h', '3d', '7d', '30d', '90d']
const AGGS = ['', 'AVG', 'MIN', 'MAX', 'SUM', 'COUNT', 'NONE']
const INTERVALS = ['1m', '5m', '1h', '1d', '1M', '1y']
const SCOPES = ['SERVER_SCOPE', 'SHARED_SCOPE', 'CLIENT_SCOPE']

const modes = computed<BindingMode[]>(() => (props.spec.modes?.length ? props.spec.modes : ALL_MODES))
const mode = computed<BindingMode | ''>(() => props.modelValue?.mode ?? '')
const entity = computed<EntityRef | undefined>(() =>
  props.modelValue && 'entity' in props.modelValue ? props.modelValue.entity : undefined
)

/** 换 mode:尽量保留实体,其它字段按新 mode 的最小合法形状重建 */
function setMode(raw: string) {
  const m = raw as BindingMode | ''
  if (!m) return emit('update:modelValue', null)
  emit('update:modelValue', emptyBinding(m, entity.value))
}
function patch(p: Record<string, unknown>) {
  if (!props.modelValue) return
  const next = { ...(props.modelValue as unknown as Record<string, unknown>), ...p }
  for (const k of Object.keys(next)) if (next[k] === undefined) delete next[k]
  emit('update:modelValue', next as unknown as Binding)
}

// ---------- 实体 ----------
const treeOpen = ref(false)
function pickEntity(e: EntityRef) {
  treeOpen.value = false
  const m = mode.value
  // 换实体后 key 清空(不同设备 key 不同)
  patch(
    m === 'ts-history' ? { entity: e, keys: [] } : m === 'ts' || m === 'attr' ? { entity: e, key: '' } : { entity: e }
  )
}

// ---------- key ----------
const keys = ref<KeyInfo[]>([])
const attrKeys = ref<string[]>([])
const alarmTypes = ref<string[]>([])
const loading = ref(false)
watch(
  // 用字符串做 watch 源:返回数组的话每次求值都是新数组,任何 prop 变动都会重拉 key
  () => `${entity.value?.id ?? ''}|${mode.value}|${(props.modelValue as { scope?: string } | null)?.scope ?? ''}`,
  async () => {
    const e = entity.value
    const c = props.client
    keys.value = []
    attrKeys.value = []
    alarmTypes.value = []
    if (!e?.id || !c) return
    loading.value = true
    try {
      if (mode.value === 'ts' || mode.value === 'ts-history') keys.value = await c.tsKeys(e)
      else if (mode.value === 'attr')
        attrKeys.value = await c.attrKeys(e, (props.modelValue as { scope?: string }).scope ?? 'SERVER_SCOPE')
      else if (mode.value === 'alarm') alarmTypes.value = await c.alarmTypes(e)
    } catch {
      /* 拉不到 key 不阻塞手输 */
    } finally {
      loading.value = false
    }
  },
  { immediate: true }
)
const kindMark = (k: KeyInfo) =>
  k.kind === 'number' ? '#' : k.kind === 'boolean' ? '◐' : k.kind === 'string' ? '"' : ''
const keyGroups = computed(() => {
  const calc = keys.value.filter(k => /^calc_/.test(k.key))
  const rest = keys.value.filter(k => !/^calc_/.test(k.key))
  const item = (k: KeyInfo) => ({
    value: k.key,
    label: `${k.key}${kindMark(k) ? ' ' + kindMark(k) : ''}${k.latest !== undefined ? ' · ' + String(k.latest) : ''}`,
  })
  const g: { label: string; items: { value: string; label: string }[]; pinned?: boolean }[] = []
  if (calc.length) g.push({ label: '⭐ 计算结果(calc_)', items: calc.map(item), pinned: true })
  g.push({ label: `遥测(${rest.length})`, items: rest.map(item) })
  return g
})
const attrGroups = computed(() => [
  { label: `属性(${attrKeys.value.length})`, items: attrKeys.value.map(k => ({ value: k, label: k })) },
])

// ts-history 多 key
const hkeys = computed(() => ((props.modelValue as { keys?: string[] } | null)?.keys ?? []) as string[])
function setHKey(i: number, v: string) {
  const list = [...hkeys.value]
  list[i] = v
  patch({ keys: list.filter(Boolean) })
}
function addHKey() {
  patch({ keys: [...hkeys.value, ''] })
}
function delHKey(i: number) {
  patch({ keys: hkeys.value.filter((_, j) => j !== i) })
}
/** 输入框里未确定的空项也要显示 */
const hkeyRows = computed(() => (hkeys.value.length ? hkeys.value : ['']))

// alarm types
const types = computed(() => ((props.modelValue as { types?: string[] } | null)?.types ?? []) as string[])
const typeDraft = ref('')
function toggleType(t: string) {
  const set = new Set(types.value)
  if (set.has(t)) set.delete(t)
  else set.add(t)
  const list = [...set]
  patch({ types: list.length ? list : undefined })
}
function addType() {
  const t = typeDraft.value.trim()
  if (!t) return
  if (!types.value.includes(t)) patch({ types: [...types.value, t] })
  typeDraft.value = ''
}

// const / ext 的 JSON 文本
const constText = computed(() => {
  const v = (props.modelValue as { value?: unknown } | null)?.value
  return typeof v === 'string' ? v : JSON.stringify(v ?? '')
})
function setConst(raw: string) {
  try {
    patch({ value: JSON.parse(raw) })
  } catch {
    patch({ value: raw })
  }
}
const paramsBad = ref(false)
function setParams(raw: string) {
  try {
    patch({ params: raw.trim() ? JSON.parse(raw) : {} })
    paramsBad.value = false
  } catch {
    paramsBad.value = true
  }
}
const str = (v: unknown) => (v === undefined || v === null ? '' : String(v))
// 模板里不能写 as 断言:读当前绑定的字段 / 读事件值都走这两个助手
const f = (k: string): unknown => (props.modelValue as unknown as Record<string, unknown> | null)?.[k]
const ev = (e: Event) => (e.target as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement).value
</script>

<template>
  <div class="br" :data-mode="mode">
    <div class="br-line">
      <select class="br-mode" :value="mode" data-role="mode" @change="setMode(ev($event))">
        <option value="">(未绑定)</option>
        <option v-for="m in modes" :key="m" :value="m">{{ MODE_LABEL[m] }} · {{ m }}</option>
      </select>
      <template v-if="mode && mode !== 'const' && mode !== 'ext'">
        <button
          type="button"
          class="br-entity"
          data-role="entity"
          :class="{ empty: !entity?.id }"
          :disabled="!tree"
          @click="treeOpen = !treeOpen"
        >
          {{
            entity?.id
              ? `${entity.type === 'ASSET' ? '◆' : '▫'} ${entity.name || entity.id}`
              : tree
                ? '选择实体…'
                : '先连接 TB'
          }}
        </button>
      </template>
    </div>
    <div v-if="treeOpen && tree" class="br-tree">
      <EntityTree :root="tree" :selected-id="entity?.id ?? null" :height="260" @select="pickEntity" />
    </div>

    <!-- ts -->
    <div v-if="mode === 'ts'" class="br-line">
      <KeyPicker
        :model-value="str(f('key'))"
        :groups="keyGroups"
        :placeholder="loading ? '读取测点…' : entity?.id ? '选择测点' : '先选实体'"
        @update:model-value="patch({ key: $event })"
      />
    </div>
    <!-- attr -->
    <div v-else-if="mode === 'attr'" class="br-line">
      <select :value="f('scope')" @change="patch({ scope: ev($event), key: '' })">
        <option v-for="s in SCOPES" :key="s" :value="s">{{ s }}</option>
      </select>
      <KeyPicker
        :model-value="str(f('key'))"
        :groups="attrGroups"
        :placeholder="loading ? '读取属性…' : '选择属性'"
        @update:model-value="patch({ key: $event })"
      />
    </div>
    <!-- ts-history -->
    <template v-else-if="mode === 'ts-history'">
      <div v-for="(k, i) in hkeyRows" :key="i" class="br-line">
        <KeyPicker
          :model-value="k"
          :groups="keyGroups"
          :placeholder="loading ? '读取测点…' : entity?.id ? '选择测点' : '先选实体'"
          @update:model-value="setHKey(i, $event)"
        />
        <button v-if="hkeyRows.length > 1" type="button" class="br-mini" @click="delHKey(i)">×</button>
      </div>
      <div class="br-line">
        <button type="button" class="br-mini" @click="addHKey">+ 再加一个测点</button>
        <label
          >窗口
          <select :value="f('window')" data-role="window" @change="patch({ window: ev($event) })">
            <option v-for="w in WINDOWS" :key="w" :value="w">{{ w }}</option>
          </select></label
        >
        <label
          >聚合
          <select :value="f('agg') ?? ''" data-role="agg" @change="patch({ agg: ev($event) || undefined })">
            <option v-for="a in AGGS" :key="a" :value="a">{{ a || '自适应' }}</option>
          </select></label
        >
      </div>
    </template>
    <!-- alarm -->
    <div v-else-if="mode === 'alarm'" class="br-types">
      <span class="br-hint">告警类型(不选 = 全部):</span>
      <button
        v-for="t in alarmTypes"
        :key="t"
        type="button"
        class="br-chip"
        :class="{ on: types.includes(t) }"
        :data-type="t"
        @click="toggleType(t)"
      >
        {{ t }}
      </button>
      <span
        v-for="t in types.filter(x => !alarmTypes.includes(x))"
        :key="'x' + t"
        class="br-chip on"
        @click="toggleType(t)"
        >{{ t }} ×</span
      >
      <input v-model="typeDraft" class="br-type-in" placeholder="手输类型后回车" @keydown.enter.prevent="addType" />
    </div>
    <!-- const -->
    <div v-else-if="mode === 'const'" class="br-line">
      <input
        class="br-wide"
        :value="constText"
        placeholder="文本或 JSON(如 12.5 / true / [1,2])"
        @change="setConst(ev($event))"
      />
    </div>
    <!-- ext -->
    <template v-else-if="mode === 'ext'">
      <div class="br-line">
        <label>源 <input :value="f('source')" size="6" @change="patch({ source: ev($event) })" /></label>
        <label
          >窗口
          <select :value="f('window') ?? ''" @change="patch({ window: ev($event) || undefined })">
            <option value="">默认</option>
            <option v-for="w in WINDOWS" :key="w" :value="w">{{ w }}</option>
          </select></label
        >
        <label
          >粒度
          <select :value="f('interval') ?? ''" @change="patch({ interval: ev($event) || undefined })">
            <option value="">默认</option>
            <option v-for="i in INTERVALS" :key="i" :value="i">{{ i }}</option>
          </select></label
        >
      </div>
      <div class="br-line">
        <textarea
          class="br-wide"
          :class="{ bad: paramsBad }"
          rows="2"
          placeholder='params JSON:通用历史 {"entity":{"type":"DEVICE","id":"…"},"keys":["P"],"agg":"AVG"};收益趋势 {"stationId":"…","metric":"net"}'
          :value="JSON.stringify(f('params') ?? {})"
          @change="setParams(ev($event))"
        ></textarea>
      </div>
    </template>
  </div>
</template>

<style>
.br {
  display: grid;
  gap: 6px;
  padding: 8px;
  border: 1px solid var(--ed-line, rgba(83, 196, 255, 0.2));
  border-radius: 6px;
}
.br-line {
  display: flex;
  gap: 6px;
  align-items: center;
  flex-wrap: wrap;
}
.br select,
.br input,
.br textarea {
  background: var(--ed-bg-1, #0b1a33);
  border: 1px solid var(--ed-line, rgba(83, 196, 255, 0.2));
  border-radius: 6px;
  padding: 4px 6px;
  color: inherit;
  font: inherit;
}
.br-wide {
  flex: 1;
  min-width: 0;
  box-sizing: border-box;
}
.br textarea.bad {
  border-color: #ff6b6b;
}
.br-entity {
  flex: 1;
  text-align: left;
  background: var(--ed-bg-1, #0b1a33);
  border: 1px solid var(--ed-line, rgba(83, 196, 255, 0.2));
  border-radius: 6px;
  padding: 4px 8px;
  color: inherit;
  font: inherit;
  cursor: pointer;
}
.br-entity.empty {
  color: #ffd27a;
}
.br-tree {
  padding: 4px 0;
}
.br-mini {
  background: none;
  border: 1px dashed var(--ed-line, rgba(83, 196, 255, 0.3));
  border-radius: 6px;
  padding: 3px 8px;
  color: inherit;
  cursor: pointer;
  font: inherit;
}
.br .kp {
  flex: 1;
  min-width: 160px;
}
.br-types {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  align-items: center;
}
.br-hint {
  font-size: 12px;
  opacity: 0.7;
}
.br-chip {
  border: 1px solid var(--ed-line, rgba(83, 196, 255, 0.3));
  border-radius: 12px;
  padding: 1px 8px;
  background: none;
  color: inherit;
  font-size: 12px;
  cursor: pointer;
}
.br-chip.on {
  border-color: var(--ed-accent, #19b7ff);
  background: rgba(25, 183, 255, 0.15);
}
.br-type-in {
  width: 140px;
}
.br label {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
}
</style>
