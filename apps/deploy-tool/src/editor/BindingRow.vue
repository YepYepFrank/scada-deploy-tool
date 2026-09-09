<script setup lang="ts">
/**
 * 一条绑定的编辑(T3.4):mode(受槽位 modes 限制)→ 实体(元数据树)→ key(KeyPicker,含 calc_ 结果 key)→ 附加参数。
 *   ts:entity + key · attr:entity + scope + key · ts-history:entity + keys[] + window + agg
 *   alarm:entity + types[](可空 = 全部)· const:值(JSON 或文本)
 *   ext(kz):查询类型二选一 —— 归档历史(实体 + 测点 + 聚合)/ 收益趋势(站点 + 指标),都从元数据树点选,不再手写 JSON;
 *            形状与校验规则在 `ext-params.ts`,与校验层共用一份
 * 只负责产出契约形状的 Binding;校验(必填 / 类型)由 BindingsPanel 与校验层做。
 */
import { computed, ref, watch } from 'vue'
import type { Binding, BindingMode, BindingSlotSpec } from '@grid/scada-renderer'
import type { EntityRef } from '@grid/tb-client'
import KeyPicker from '../components/KeyPicker.vue'
import EntityTree from './EntityTree.vue'
import type { KeyInfo, MetaClient, MetaNode } from '../meta/MetaNode'
import { emptyBinding } from './binding-check'
import { declaredAlarmsFor, declaredKeysFor, type Declared } from './declared-keys'
import {
  aggLabel,
  emptyExtParams,
  EXT_AGGS,
  EXT_INTERVALS,
  EXT_KIND_LABEL,
  EXT_METRICS,
  extAgg,
  extEntity,
  extKeys,
  extKind,
  extMetric,
  extStationId,
  type ExtKind,
} from './ext-params'

const props = defineProps<{
  spec: BindingSlotSpec
  modelValue: Binding | null
  tree: MetaNode | null
  client: MetaClient | null
  /**
   * 向导第 3 步声明、可能还没发布的输出。绑定选择器原来只列 TB 上**已存在**的 key,
   * 而向导是「先配运算 → 再绑组件 → 最后发布」,第一次走流程时刚配的 calc_ 一个都选不到。
   * 这里把声明的输出并进来并标「待发布」,见 editor/declared-keys.ts。
   */
  declared?: Declared | null
}>()
const emit = defineEmits<{ 'update:modelValue': [b: Binding | null]; split: [keys: string[]] }>()

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
const SCOPES = ['SERVER_SCOPE', 'SHARED_SCOPE', 'CLIENT_SCOPE']

const modes = computed<BindingMode[]>(() => (props.spec.modes?.length ? props.spec.modes : ALL_MODES))
const mode = computed<BindingMode | ''>(() => props.modelValue?.mode ?? '')
/** 树里按 id 找节点(收益趋势只存了 stationId,名字要从树上取来显示) */
function findNode(n: MetaNode | null, id: string): MetaNode | null {
  if (!n || !id) return null
  if (n.id === id) return n
  for (const c of n.children) {
    const hit = findNode(c, id)
    if (hit) return hit
  }
  return null
}
const extK = computed<ExtKind>(() => extKind(props.modelValue))
/** 收益趋势的站点:kz 的 stationId 就是 TB 里 gateway 设备的 id,所以能当实体一样点选 */
const stationRef = computed<EntityRef | undefined>(() => {
  const id = extStationId(props.modelValue)
  if (!id) return undefined
  return { type: 'DEVICE', id, name: findNode(props.tree, id)?.name ?? '' }
})
const entity = computed<EntityRef | undefined>(() =>
  props.modelValue && 'entity' in props.modelValue
    ? props.modelValue.entity
    : // ext 的实体在 params 里:归档历史是 params.entity,收益趋势是 params.stationId(一台网关设备)
      mode.value === 'ext'
      ? extK.value === 'revenue'
        ? stationRef.value
        : extEntity(props.modelValue)
      : undefined
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
/** 只改 ext 的 params(合并);值为 undefined 的键删掉 */
function patchParams(p: Record<string, unknown>) {
  const cur = (props.modelValue as { params?: Record<string, unknown> } | null)?.params ?? {}
  const next = { ...cur, ...p }
  for (const k of Object.keys(next)) if (next[k] === undefined) delete next[k]
  patch({ params: next })
}
/** 换查询类型:重建一套最小合法 params,尽量把当前实体带过去 */
function setExtKind(raw: string) {
  const k = raw as Exclude<ExtKind, 'unknown'>
  if (k === extK.value) return
  patch({ params: emptyExtParams(k, entity.value) })
}

// ---------- 实体 ----------
const treeOpen = ref(false)
function pickEntity(e: EntityRef) {
  treeOpen.value = false
  const m = mode.value
  // 换实体后 key 清空(不同设备 key 不同)
  if (m === 'ext') {
    // 归档历史换实体 → 清测点;收益趋势换的是「站点」,存 id
    patchParams(extK.value === 'revenue' ? { stationId: e.id } : { entity: e, keys: [] })
    return
  }
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
  () =>
    `${entity.value?.id ?? ''}|${mode.value}|${extK.value}|${(props.modelValue as { scope?: string } | null)?.scope ?? ''}`,
  async () => {
    const e = entity.value
    const c = props.client
    keys.value = []
    attrKeys.value = []
    alarmTypes.value = []
    if (!e?.id || !c) return
    loading.value = true
    try {
      if (mode.value === 'ts' || mode.value === 'ts-history' || (mode.value === 'ext' && extK.value === 'history'))
        keys.value = await c.tsKeys(e)
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
/** 当前实体在本次配置里会产生的 key / 告警类型(可能尚未发布) */
const declKeys = computed(() => {
  const e = entity.value
  return e?.name ? declaredKeysFor(props.declared, e.type, e.name) : []
})
const declAlarms = computed(() => {
  const e = entity.value
  return e?.name ? declaredAlarmsFor(props.declared, e.type, e.name) : []
})

const kindMark = (k: KeyInfo) =>
  k.kind === 'number' ? '#' : k.kind === 'boolean' ? '◐' : k.kind === 'string' ? '"' : ''
type PickItem = { value: string; label: string; badge?: string }
const keyGroups = computed(() => {
  const item = (k: KeyInfo): PickItem => ({
    value: k.key,
    label: `${k.key}${kindMark(k) ? ' ' + kindMark(k) : ''}${k.latest !== undefined ? ' · ' + String(k.latest) : ''}`,
  })
  const have = new Map(keys.value.map(k => [k.key, k]))
  const decl = declKeys.value
  const declSet = new Set(decl.map(d => d.key))
  const g: { label: string; items: PickItem[]; pinned?: boolean }[] = []
  // ① 本次配置声明的输出置顶:已发布的照常显示最近值,没发布的标「待发布」也能先绑上
  if (decl.length)
    g.push({
      label: `⭐ 本站配置的运算结果(${decl.length})`,
      pinned: true,
      items: decl.map(d => {
        const k = have.get(d.key)
        return k ? item(k) : { value: d.key, label: d.key, badge: '待发布' }
      }),
    })
  const rest = keys.value.filter(k => !declSet.has(k.key))
  // ② TB 上已有、但本次配置没声明的 calc_(上一版配置留下的)
  const calc = rest.filter(k => /^calc_/.test(k.key))
  const plain = rest.filter(k => !/^calc_/.test(k.key))
  if (calc.length) g.push({ label: '⭐ 计算结果(calc_)', items: calc.map(item), pinned: true })
  g.push({ label: `遥测(${plain.length})`, items: plain.map(item) })
  return g
})
/** 告警类型:TB 上出现过的 + 本次配置声明的(还没触发过,所以查不到) */
const alarmChoices = computed<{ type: string; pending: boolean }[]>(() => {
  const seen = new Set(alarmTypes.value)
  return [
    ...alarmTypes.value.map(t => ({ type: t, pending: false })),
    ...declAlarms.value.filter(t => !seen.has(t)).map(t => ({ type: t, pending: true })),
  ]
})
const attrGroups = computed(() => [
  { label: `属性(${attrKeys.value.length})`, items: attrKeys.value.map(k => ({ value: k, label: k })) },
])

/**
 * ts-history:一条绑定 = 一条序列 = 一个测点。渲染器按绑定条数出 SeriesValue,一条绑定里写多个
 * 测点的话除第一个之外都会被丢掉(审查 R3)。要画多条曲线,在槽位上「+ 添加一条」绑定。
 * 这里只保留单选;遇到早期配置留下的多 key,原样显示并给出两个明确的处理办法。
 */
const hkeys = computed(() => ((props.modelValue as { keys?: string[] } | null)?.keys ?? []) as string[])
const extraKeys = computed(() => hkeys.value.slice(1).filter(Boolean))
/** 换第一个测点时保留多余项,免得「改个 key」把它们悄悄抹掉 —— 多余项要用下面两个按钮显式处理 */
function setHKey(v: string) {
  patch({ keys: [v, ...hkeys.value.slice(1)].filter(Boolean) })
}
function keepFirstKey() {
  patch({ keys: hkeys.value.slice(0, 1).filter(Boolean) })
}

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
/**
 * ext 归档历史同样是「一条绑定 = 一条序列」:渲染器只取 `Object.values(series)[0]`,
 * 多写的 key 会被悄悄丢掉(与 ts-history 的审查 R3 同一回事)。这里只单选,遗留多 key 给两个明确出口。
 */
const ekeys = computed(() => extKeys(props.modelValue))
const ekeyExtra = computed(() => ekeys.value.slice(1).filter(Boolean))
function setEKey(v: string) {
  patchParams({ keys: [v, ...ekeys.value.slice(1)].filter(Boolean) })
}
function keepFirstEKey() {
  patchParams({ keys: ekeys.value.slice(0, 1).filter(Boolean) })
}
/** 手写 params 的后路:只在「已经是 ext 且形状不认识」时自动展开,平时收着 */
const advanced = ref(false)
watch(
  () => mode.value === 'ext' && extK.value === 'unknown',
  odd => {
    if (odd) advanced.value = true
  },
  { immediate: true }
)
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
      <template v-if="mode && mode !== 'const' && !(mode === 'ext' && extK === 'unknown')">
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
                ? extK === 'revenue'
                  ? '选择站点(网关设备)…'
                  : '选择实体…'
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
      <div class="br-line">
        <KeyPicker
          :model-value="hkeys[0] ?? ''"
          :groups="keyGroups"
          :placeholder="loading ? '读取测点…' : entity?.id ? '选择测点' : '先选实体'"
          @update:model-value="setHKey($event)"
        />
      </div>
      <div v-if="extraKeys.length" class="br-line br-legacy" data-role="multi-key-warning">
        <span>这条绑定还绑着 {{ extraKeys.join('、') }} —— 一条绑定只画一条序列,渲染时只用第一个,多余的会被丢掉。</span>
        <button v-if="spec.multiple" type="button" class="br-mini" @click="emit('split', hkeys.slice())">
          拆成 {{ hkeys.length }} 条绑定
        </button>
        <button type="button" class="br-mini" @click="keepFirstKey">只留第一个</button>
      </div>
      <div class="br-line">
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
        v-for="c in alarmChoices"
        :key="c.type"
        type="button"
        class="br-chip"
        :class="{ on: types.includes(c.type), pending: c.pending }"
        :data-type="c.type"
        :title="c.pending ? '本站配置声明的告警,尚未触发过' : ''"
        @click="toggleType(c.type)"
      >
        {{ c.type }}<span v-if="c.pending" class="br-chip-badge">待发布</span>
      </button>
      <span
        v-for="t in types.filter(x => !alarmChoices.some(c => c.type === x))"
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
    <!-- ext(kz):查询类型二选一,实体 / 站点 / 测点都点选;手写 JSON 只作后路 -->
    <template v-else-if="mode === 'ext'">
      <div class="br-line">
        <label
          >查询
          <select data-role="ext-kind" :value="extK === 'unknown' ? '' : extK" @change="setExtKind(ev($event))">
            <option v-if="extK === 'unknown'" value="">(params 形状不认识)</option>
            <option value="history">{{ EXT_KIND_LABEL.history }}</option>
            <option value="revenue">{{ EXT_KIND_LABEL.revenue }}</option>
          </select></label
        >
        <template v-if="extK === 'revenue'">
          <label
            >周期
            <select
              data-role="ext-period"
              :value="f('interval') === '1M' ? '1M' : '1d'"
              @change="patch({ interval: ev($event) })"
            >
              <option value="1d">本月逐日</option>
              <option value="1M">本年逐月</option>
            </select></label
          >
        </template>
        <template v-else>
          <label
            >窗口
            <select
              :value="f('window') ?? ''"
              data-role="ext-window"
              @change="patch({ window: ev($event) || undefined })"
            >
              <option value="">默认(30d)</option>
              <option v-for="w in WINDOWS" :key="w" :value="w">{{ w }}</option>
            </select></label
          >
          <label
            >粒度
            <select
              :value="f('interval') ?? ''"
              data-role="ext-interval"
              @change="patch({ interval: ev($event) || undefined })"
            >
              <option value="">按窗口自适应</option>
              <option v-for="i in EXT_INTERVALS" :key="i" :value="i">{{ i }}</option>
            </select></label
          >
        </template>
      </div>
      <!-- 归档历史:实体在上面选,这里选测点 + 聚合 -->
      <template v-if="extK === 'history'">
        <div class="br-line">
          <KeyPicker
            :model-value="ekeys[0] ?? ''"
            :groups="keyGroups"
            :placeholder="loading ? '读取测点…' : entity?.id ? '选择测点' : '先选实体'"
            @update:model-value="setEKey($event)"
          />
          <label
            >聚合
            <select
              data-role="ext-agg"
              :value="extAgg(modelValue)"
              @change="patchParams({ agg: ev($event) || undefined })"
            >
              <option value="">默认(AVG)</option>
              <option v-for="a in EXT_AGGS" :key="a" :value="a">{{ aggLabel(a) }}</option>
            </select></label
          >
        </div>
        <div v-if="ekeyExtra.length" class="br-line br-legacy" data-role="ext-multi-key-warning">
          <span>这条绑定还绑着 {{ ekeyExtra.join('、') }} —— 一条 kz 归档绑定只画一条序列,多余的会被丢掉。</span>
          <button type="button" class="br-mini" @click="keepFirstEKey">只留第一个</button>
        </div>
      </template>
      <!-- 收益趋势:站点在上面选,这里选指标 -->
      <div v-else-if="extK === 'revenue'" class="br-line">
        <label
          >指标
          <select
            data-role="ext-metric"
            :value="extMetric(modelValue)"
            @change="patchParams({ metric: ev($event) || undefined })"
          >
            <option value="">(未选:只画{{ EXT_METRICS[0].label }})</option>
            <option v-for="m in EXT_METRICS" :key="m.value" :value="m.value">{{ m.label }} · {{ m.value }}</option>
          </select></label
        >
        <span class="br-hint">站点在上面选 —— kz 的站点就是 TB 里的网关设备</span>
      </div>
      <div class="br-line">
        <button type="button" class="br-mini" data-role="ext-advanced" @click="advanced = !advanced">
          {{ advanced ? '收起 params' : '高级:直接改 params JSON' }}
        </button>
      </div>
      <div v-if="advanced" class="br-line">
        <textarea
          class="br-wide"
          :class="{ bad: paramsBad }"
          rows="2"
          placeholder='params JSON:归档历史 {"entity":{"type":"DEVICE","id":"…"},"keys":["P"],"agg":"AVG"};收益趋势 {"stationId":"…","metric":"net"}'
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
.br-chip.pending {
  border-style: dashed;
}
.br-chip-badge {
  margin-left: 4px;
  font-size: 10px;
  opacity: 0.75;
}
.br-legacy {
  font-size: 12px;
  color: #ffcf6b;
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
