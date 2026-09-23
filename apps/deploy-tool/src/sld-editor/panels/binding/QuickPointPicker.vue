<script setup lang="ts">
/**
 * 测点列表(2026-09-23 内测反馈「能否默认使用上一次的设备,并展开测点」,参考基站储能系统的「绑定量测」):
 * 上面一行是当前设备(缺省沿用上一台),下面直接列出这台设备的全部遥测——点一行就绑上。
 * 可以按中文名 / key 搜;每行带最近值,好认。换设备:点设备名,从最近用过的几台里点,或从设备树选。
 * 只管「挑」,写草稿由父组件在 pick 事件里做(开关状态 / 数值标签各有各的顺手补全)。
 */
import { computed, inject, ref, watch } from 'vue'
import type { KeyInfo } from '../../../meta/MetaNode'
import EntityTree from '../../../editor/EntityTree.vue'
import { declaredKeysFor } from '../../../editor/declared-keys'
import { dual, type KeyCnFn } from '../../../naming'
import { SLD_EDITOR_CTX } from '../../ext'
import { findMetaNode, type QuickDevice } from './ops'
import { QUICK_BIND } from './quick'

const props = withDefaults(
  defineProps<{
    /** 已绑的测点(高亮;只在同一台设备时高亮) */
    boundKey?: string
    boundDevice?: string
  }>(),
  { boundKey: undefined, boundDevice: undefined }
)
const emit = defineEmits<{ pick: [device: QuickDevice, key: string] }>()

const ctx = inject(SLD_EDITOR_CTX)!
const quick = inject(QUICK_BIND)!
const keyCn = inject<KeyCnFn>('keyCn', () => '')
const tree = computed(() => ctx.host.tree ?? null)
const device = quick.device

const devText = (d: QuickDevice): string => dual(findMetaNode(tree.value, d.id)?.label, d.name)
/** 没有设备时直接把选设备的菜单打开 */
const menu = ref(!device.value)
const treeOpen = ref(!device.value && !quick.recent.value.length)
function choose(d: QuickDevice): void {
  quick.useDevice(d)
  menu.value = false
  treeOpen.value = false
}

/* ───── 测点 ───── */
interface Row {
  key: string
  text: string
  latest: string
  pending?: boolean
}
const keys = ref<KeyInfo[]>([])
const loading = ref(false)
const failed = ref(false)
watch(
  () => device.value?.id ?? '',
  async id => {
    keys.value = []
    failed.value = false
    const c = ctx.host.client
    if (!id || !c || !device.value) return
    loading.value = true
    try {
      const got = await c.tsKeys({ type: device.value.type, id, name: device.value.name })
      if (device.value?.id === id) keys.value = got
    } catch {
      failed.value = true
    } finally {
      loading.value = false
    }
  },
  { immediate: true }
)
const short = (v: unknown): string => {
  if (v === undefined || v === null) return ''
  const s = typeof v === 'object' ? JSON.stringify(v) : String(v)
  return s.length > 10 ? s.slice(0, 9) + '…' : s
}
const rows = computed<Row[]>(() => {
  const d = device.value
  const have = new Set(keys.value.map(k => k.key))
  // 向导第 3 步声明、还没发布的运算输出也列上(标「待发布」),与 BindingRow 一致
  const decl = d ? declaredKeysFor(ctx.host.declared, d.type, d.name).filter(k => !have.has(k.key)) : []
  return [
    ...decl.map(k => ({ key: k.key, text: dual(keyCn(k.key), k.key), latest: '', pending: true })),
    ...keys.value.map(k => ({ key: k.key, text: dual(keyCn(k.key), k.key), latest: short(k.latest) })),
  ]
})
const q = ref('')
const shown = computed(() => {
  const t = q.value.trim().toLowerCase()
  return t ? rows.value.filter(r => r.text.toLowerCase().includes(t)) : rows.value
})
const isBound = (key: string): boolean =>
  !!props.boundKey && key === props.boundKey && (!props.boundDevice || props.boundDevice === device.value?.name)
function pick(key: string): void {
  if (device.value) emit('pick', device.value, key)
}
</script>

<template>
  <div class="sld-qp" data-role="quick-picker">
    <div class="sld-qp-head">
      <span class="sld-bd-hint">设备</span>
      <button
        type="button"
        class="sld-qp-dev"
        :class="{ empty: !device }"
        data-role="qp-device"
        :title="device ? '换一台设备' : ''"
        @click="menu = !menu"
      >
        {{ device ? devText(device) : tree ? '先选一台设备…' : '未连接平台' }} ▾
      </button>
    </div>
    <div v-if="menu" class="sld-qp-menu" data-role="qp-menu">
      <template v-if="quick.recent.value.length">
        <span class="sld-bd-hint">最近用过</span>
        <button
          v-for="d in quick.recent.value"
          :key="`${d.type}:${d.name}`"
          type="button"
          class="sld-qp-chip"
          :class="{ on: d.id === device?.id }"
          data-role="qp-recent"
          @click="choose(d)"
        >
          {{ devText(d) }}
        </button>
      </template>
      <button v-if="tree" type="button" class="sld-bd-link" data-role="qp-tree" @click="treeOpen = !treeOpen">
        {{ treeOpen ? '▾' : '▸' }} 从设备树选
      </button>
      <EntityTree
        v-if="treeOpen && tree"
        :root="tree"
        :selected-id="device?.id ?? null"
        :height="220"
        @select="e => choose({ type: e.type, id: e.id, name: e.name || '' })"
      />
    </div>
    <template v-if="device">
      <input v-model="q" class="sld-qp-search" data-role="qp-search" placeholder="搜测点:中文名 / key" />
      <p v-if="loading" class="sld-bd-hint">读取测点…</p>
      <p v-else-if="failed" class="sld-bd-bad">读不到这台设备的测点</p>
      <p v-else-if="!rows.length" class="sld-bd-hint">这台设备还没有遥测数据</p>
      <p v-else-if="!shown.length" class="sld-bd-hint">没有匹配「{{ q }}」的测点</p>
      <ul v-else class="sld-qp-list">
        <li v-for="r in shown" :key="r.key">
          <button
            type="button"
            class="sld-qp-row"
            :class="{ on: isBound(r.key) }"
            data-role="qp-key"
            :data-key="r.key"
            :title="`绑定 ${r.key}`"
            @click="pick(r.key)"
          >
            <span class="sld-qp-name">{{ r.text }}</span>
            <em v-if="r.pending" class="sld-qp-badge">待发布</em>
            <em v-else-if="r.latest" class="sld-qp-latest">{{ r.latest }}</em>
            <b v-if="isBound(r.key)" class="sld-qp-mark">✓</b>
          </button>
        </li>
      </ul>
    </template>
  </div>
</template>

<style>
.sld-qp {
  display: grid;
  gap: 6px;
  padding: 6px;
  border: 1px solid var(--ed-line, rgba(83, 196, 255, 0.2));
  border-radius: 6px;
  background: rgba(25, 183, 255, 0.04);
}
.sld-qp-head {
  display: flex;
  gap: 6px;
  align-items: center;
  min-width: 0;
}
.sld-qp-dev {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  padding: 3px 8px;
  color: inherit;
  font: inherit;
  text-align: left;
  white-space: nowrap;
  text-overflow: ellipsis;
  background: var(--ed-bg-1, #0b1a33);
  border: 1px solid var(--ed-line, rgba(83, 196, 255, 0.2));
  border-radius: 6px;
  cursor: pointer;
}
.sld-qp-dev.empty {
  color: #ffd27a;
}
.sld-qp-menu {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  align-items: center;
}
.sld-qp-menu .et,
.sld-qp-menu > div {
  flex-basis: 100%;
}
.sld-qp-chip {
  max-width: 100%;
  overflow: hidden;
  padding: 1px 8px;
  color: inherit;
  font: inherit;
  font-size: 12px;
  white-space: nowrap;
  text-overflow: ellipsis;
  background: none;
  border: 1px solid var(--ed-line, rgba(83, 196, 255, 0.3));
  border-radius: 12px;
  cursor: pointer;
}
.sld-qp-chip.on {
  border-color: var(--ed-accent, #19b7ff);
  background: rgba(25, 183, 255, 0.15);
}
.sld-qp-search {
  min-width: 0;
  padding: 4px 6px;
  color: inherit;
  font: inherit;
  background: var(--ed-bg-0, #061024);
  border: 1px solid var(--ed-line, rgba(83, 196, 255, 0.2));
  border-radius: 4px;
}
.sld-qp-list {
  max-height: 220px;
  margin: 0;
  padding: 0;
  overflow-y: auto;
  list-style: none;
}
.sld-qp-row {
  display: flex;
  gap: 6px;
  align-items: baseline;
  width: 100%;
  min-width: 0;
  padding: 4px 6px;
  color: inherit;
  font: inherit;
  text-align: left;
  background: none;
  border: 0;
  border-radius: 4px;
  cursor: pointer;
}
.sld-qp-row:hover {
  background: rgba(25, 183, 255, 0.12);
}
.sld-qp-row.on {
  background: rgba(25, 183, 255, 0.2);
}
.sld-qp-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.sld-qp-latest,
.sld-qp-badge {
  flex: none;
  font-size: 11px;
  font-style: normal;
  opacity: 0.65;
}
.sld-qp-badge {
  color: #ffd27a;
}
.sld-qp-mark {
  flex: none;
  color: var(--ed-accent, #19b7ff);
}
</style>
