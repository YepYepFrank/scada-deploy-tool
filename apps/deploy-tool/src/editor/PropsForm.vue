<script setup lang="ts">
/**
 * 属性面板(T3.3):按组件 propsSchema 自动生成表单。
 * string → 文本框 / 多行 / 地址;number|integer → 数字框(min / max / step);boolean → 开关;enum → 下拉;
 * color → 取色 + 文本;array<object> → 可增删行的子表单(递归);认不出的 → JSON 文本框兜底。
 * 每次输入立即 emit 新的 props(缩略图即时反映);越界 / 类型错误的字段标红并在 issues 里给出。
 */
import { computed, reactive } from 'vue'
import type { PropSchema, PropsSchema } from '@grid/scada-renderer'
import { coerce, emptyRow, fieldKind, validateProps, type FieldIssue } from './props-form'

const props = defineProps<{
  schema: PropsSchema
  modelValue: Record<string, unknown>
  /** 嵌套层级(数组子表单)时的路径前缀,只用于 issues 定位 */
  pathPrefix?: string
}>()
const emit = defineEmits<{ 'update:modelValue': [value: Record<string, unknown>]; issues: [issues: FieldIssue[]] }>()

const fields = computed(() =>
  Object.entries(props.schema.properties).map(([key, s]) => ({ key, schema: s, kind: fieldKind(s) }))
)
const issues = computed(() => validateProps(props.schema, props.modelValue, props.pathPrefix ?? ''))
const issueOf = (path: string) => issues.value.find(i => i.path === (props.pathPrefix ?? '') + path)?.message
/** JSON 兜底字段的解析失败态(不进 modelValue) */
const jsonBad = reactive<Record<string, boolean>>({})

function set(key: string, value: unknown) {
  const next = { ...props.modelValue }
  if (value === undefined) delete next[key]
  else next[key] = value
  emit('update:modelValue', next)
  emit('issues', validateProps(props.schema, next, props.pathPrefix ?? ''))
}
function onInput(key: string, s: PropSchema, e: Event) {
  const el = e.target as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement
  const raw = el instanceof HTMLInputElement && el.type === 'checkbox' ? el.checked : el.value
  const v = coerce(s, raw)
  if (v === Symbol.for('invalid-json')) {
    jsonBad[key] = true
    return
  }
  jsonBad[key] = false
  set(key, v)
}
const str = (v: unknown) => (v === undefined || v === null ? '' : String(v))
// 模板里不能写 as 断言,用这几个取 schema 的通用字段
const titleOf = (s: PropSchema) => (s as { title?: string }).title
const defaultOf = (s: PropSchema) => (s as { default?: unknown }).default
const descOf = (s: PropSchema) => (s as { description?: string }).description
const jsonStr = (v: unknown) => (v === undefined ? '' : JSON.stringify(v, null, 2))
const rows = (key: string) =>
  Array.isArray(props.modelValue[key]) ? (props.modelValue[key] as Record<string, unknown>[]) : []
const arrSchema = (s: PropSchema) => s as Extract<PropSchema, { type: 'array' }>
const numSchema = (s: PropSchema) => s as Extract<PropSchema, { type: 'number' | 'integer' }>
const strSchema = (s: PropSchema) => s as Extract<PropSchema, { type: 'string' }>

function addRow(key: string, s: PropSchema) {
  const a = arrSchema(s)
  const list = rows(key)
  if (a.maxItems !== undefined && list.length >= a.maxItems) return
  set(key, [...list, emptyRow(a.items)])
}
function removeRow(key: string, i: number) {
  set(
    key,
    rows(key).filter((_, j) => j !== i)
  )
}
function moveRow(key: string, i: number, dir: -1 | 1) {
  const list = [...rows(key)]
  const j = i + dir
  if (j < 0 || j >= list.length) return
  ;[list[i], list[j]] = [list[j]!, list[i]!]
  set(key, list)
}
function setRow(key: string, i: number, row: Record<string, unknown>) {
  const list = [...rows(key)]
  list[i] = row
  set(key, list)
}
</script>

<template>
  <div class="pf">
    <div
      v-for="f in fields"
      :key="f.key"
      class="pf-field"
      :class="[`pf-${f.kind}`, { 'pf-invalid': issueOf(f.key) || jsonBad[f.key] }]"
      :data-field="f.key"
    >
      <label class="pf-label">
        <span>{{ titleOf(f.schema) ?? f.key }}</span>
        <code>{{ f.key }}</code>
      </label>

      <!-- 文本 / 地址 -->
      <input
        v-if="f.kind === 'text' || f.kind === 'url'"
        :type="f.kind === 'url' ? 'url' : 'text'"
        :value="str(modelValue[f.key])"
        :placeholder="str(defaultOf(f.schema))"
        :maxlength="strSchema(f.schema).maxLength"
        @input="onInput(f.key, f.schema, $event)"
      />
      <!-- 多行 -->
      <textarea
        v-else-if="f.kind === 'multiline'"
        :value="str(modelValue[f.key])"
        rows="3"
        @input="onInput(f.key, f.schema, $event)"
      ></textarea>
      <!-- 数字 -->
      <input
        v-else-if="f.kind === 'number'"
        type="number"
        :value="str(modelValue[f.key])"
        :placeholder="str(defaultOf(f.schema))"
        :min="numSchema(f.schema).minimum"
        :max="numSchema(f.schema).maximum"
        :step="numSchema(f.schema).multipleOf ?? (numSchema(f.schema).type === 'integer' ? 1 : 'any')"
        @input="onInput(f.key, f.schema, $event)"
      />
      <!-- 开关 -->
      <label v-else-if="f.kind === 'boolean'" class="pf-switch">
        <input
          type="checkbox"
          :checked="!!(modelValue[f.key] ?? defaultOf(f.schema))"
          @change="onInput(f.key, f.schema, $event)"
        />
        <span>{{ (modelValue[f.key] ?? defaultOf(f.schema)) ? '开' : '关' }}</span>
      </label>
      <!-- 枚举 -->
      <select
        v-else-if="f.kind === 'enum'"
        :value="str(modelValue[f.key] ?? defaultOf(f.schema))"
        @change="onInput(f.key, f.schema, $event)"
      >
        <option v-for="(opt, i) in strSchema(f.schema).enum" :key="opt" :value="opt">
          {{ strSchema(f.schema).enumNames?.[i] ?? opt }}
        </option>
      </select>
      <!-- 颜色 -->
      <div v-else-if="f.kind === 'color'" class="pf-color">
        <input
          type="color"
          :value="/^#[0-9a-fA-F]{6}$/.test(str(modelValue[f.key])) ? str(modelValue[f.key]) : '#3987e5'"
          @input="onInput(f.key, f.schema, $event)"
        />
        <input
          type="text"
          :value="str(modelValue[f.key])"
          placeholder="#rrggbb(空 = 默认)"
          @input="onInput(f.key, f.schema, $event)"
        />
        <button
          v-if="str(modelValue[f.key])"
          type="button"
          class="pf-mini"
          title="清除,回到默认"
          @click="set(f.key, undefined)"
        >
          ×
        </button>
      </div>
      <!-- 数组子表单 -->
      <div v-else-if="f.kind === 'array'" class="pf-array">
        <div v-for="(row, i) in rows(f.key)" :key="i" class="pf-row" :data-row="i">
          <div class="pf-row-head">
            <span>#{{ i + 1 }}</span>
            <button type="button" class="pf-mini" :disabled="i === 0" title="上移" @click="moveRow(f.key, i, -1)">
              ↑
            </button>
            <button
              type="button"
              class="pf-mini"
              :disabled="i === rows(f.key).length - 1"
              title="下移"
              @click="moveRow(f.key, i, 1)"
            >
              ↓
            </button>
            <button type="button" class="pf-mini pf-del" title="删除" @click="removeRow(f.key, i)">×</button>
          </div>
          <PropsForm
            :schema="arrSchema(f.schema).items"
            :model-value="row"
            :path-prefix="`${pathPrefix ?? ''}${f.key}/${i}/`"
            @update:model-value="setRow(f.key, i, $event)"
          />
        </div>
        <button
          type="button"
          class="pf-add"
          :disabled="arrSchema(f.schema).maxItems !== undefined && rows(f.key).length >= arrSchema(f.schema).maxItems!"
          @click="addRow(f.key, f.schema)"
        >
          + 添加一项{{
            arrSchema(f.schema).maxItems !== undefined ? `(${rows(f.key).length}/${arrSchema(f.schema).maxItems})` : ''
          }}
        </button>
      </div>
      <!-- 兜底:JSON -->
      <textarea
        v-else
        class="pf-json"
        :value="jsonStr(modelValue[f.key])"
        rows="3"
        spellcheck="false"
        placeholder="JSON"
        @change="onInput(f.key, f.schema, $event)"
      ></textarea>

      <div v-if="descOf(f.schema)" class="pf-desc">
        {{ descOf(f.schema) }}
      </div>
      <div v-if="issueOf(f.key)" class="pf-err">{{ issueOf(f.key) }}</div>
      <div v-else-if="jsonBad[f.key]" class="pf-err">JSON 无法解析,未保存</div>
    </div>
  </div>
</template>

<style>
.pf {
  display: grid;
  gap: 10px;
}
.pf-field {
  display: grid;
  gap: 4px;
}
.pf-label {
  display: flex;
  justify-content: space-between;
  font-size: 12px;
  opacity: 0.85;
}
.pf-label code {
  opacity: 0.6;
  font-size: 11px;
}
.pf input[type='text'],
.pf input[type='url'],
.pf input[type='number'],
.pf select,
.pf textarea {
  width: 100%;
  box-sizing: border-box;
  background: var(--ed-bg-1, #0b1a33);
  border: 1px solid var(--ed-line, rgba(83, 196, 255, 0.2));
  border-radius: 6px;
  padding: 5px 8px;
  color: inherit;
  font: inherit;
}
.pf-invalid input,
.pf-invalid select,
.pf-invalid textarea {
  border-color: #ff6b6b !important;
  background: rgba(255, 107, 107, 0.08);
}
.pf-err {
  color: #ff8a8a;
  font-size: 12px;
}
.pf-desc {
  font-size: 11px;
  opacity: 0.6;
}
.pf-switch {
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
}
.pf-color {
  display: flex;
  gap: 6px;
  align-items: center;
}
.pf-color input[type='color'] {
  width: 36px;
  height: 28px;
  padding: 0;
  border: 1px solid var(--ed-line, rgba(83, 196, 255, 0.2));
  background: none;
  border-radius: 4px;
}
.pf-color input[type='text'] {
  flex: 1;
}
.pf-array {
  display: grid;
  gap: 6px;
}
.pf-row {
  border: 1px solid var(--ed-line, rgba(83, 196, 255, 0.2));
  border-radius: 6px;
  padding: 6px 8px;
  display: grid;
  gap: 6px;
}
.pf-row-head {
  display: flex;
  gap: 4px;
  align-items: center;
  font-size: 12px;
  opacity: 0.8;
}
.pf-row-head span {
  margin-right: auto;
}
.pf-mini {
  padding: 0 6px;
  line-height: 20px;
  font-size: 12px;
  background: var(--ed-bg-1, #0b1a33);
  border: 1px solid var(--ed-line, rgba(83, 196, 255, 0.2));
  border-radius: 4px;
  color: inherit;
  cursor: pointer;
}
.pf-mini:disabled {
  opacity: 0.35;
  cursor: default;
}
.pf-del {
  color: #ff8a8a;
}
.pf-add {
  background: none;
  border: 1px dashed var(--ed-line, rgba(83, 196, 255, 0.3));
  border-radius: 6px;
  padding: 5px;
  color: inherit;
  cursor: pointer;
  font: inherit;
}
.pf-add:disabled {
  opacity: 0.4;
  cursor: default;
}
.pf-json {
  font-family: ui-monospace, Consolas, monospace;
  font-size: 12px;
}
</style>
