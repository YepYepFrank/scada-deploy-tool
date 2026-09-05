/**
 * 属性面板的纯逻辑(T3.3):把 propsSchema(JSON Schema draft-07 子集,见渲染器 schema/registry.ts)
 * 映射成表单字段类型,并做值校验。PropsForm.vue 只负责画;这里的函数可单测、可被校验层(T3.5)复用。
 */
import type { PropSchema, PropsSchema } from '@grid/scada-renderer'

export type FieldKind = 'text' | 'multiline' | 'url' | 'color' | 'number' | 'boolean' | 'enum' | 'array' | 'json'

/** schema → 表单控件;认不出的类型走 'json' 兜底(文本框 + JSON 校验) */
export function fieldKind(s: PropSchema): FieldKind {
  const t = (s as { type?: string }).type
  if (t === 'string') {
    const str = s as Extract<PropSchema, { type: 'string' }>
    if (str.enum?.length) return 'enum'
    if (str.format === 'color') return 'color'
    if (str.format === 'multiline') return 'multiline'
    if (str.format === 'url') return 'url'
    return 'text'
  }
  if (t === 'number' || t === 'integer') return 'number'
  if (t === 'boolean') return 'boolean'
  if (t === 'array') {
    const arr = s as Extract<PropSchema, { type: 'array' }>
    return arr.items?.type === 'object' && arr.items.properties ? 'array' : 'json'
  }
  return 'json'
}

/** 整个 propsSchema 里是否有走兜底的字段(T3.3 完成标准:10 个内置组件全部无兜底) */
export function fallbackFields(schema: PropsSchema, prefix = ''): string[] {
  const out: string[] = []
  for (const [k, s] of Object.entries(schema.properties)) {
    const kind = fieldKind(s)
    if (kind === 'json') out.push(prefix + k)
    if (kind === 'array')
      out.push(...fallbackFields((s as Extract<PropSchema, { type: 'array' }>).items, `${prefix}${k}[].`))
  }
  return out
}

export interface FieldIssue {
  /** 字段路径,如 decimals、columns/1/decimals */
  path: string
  message: string
}

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

/** 校验一份 props(只看 schema 里声明的字段;未声明字段按 additionalProperties 处理) */
export function validateProps(schema: PropsSchema, values: Record<string, unknown>, prefix = ''): FieldIssue[] {
  const issues: FieldIssue[] = []
  for (const [k, s] of Object.entries(schema.properties)) {
    const v = values[k]
    const path = prefix + k
    if (v === undefined || v === null) {
      if (schema.required?.includes(k)) issues.push({ path, message: '必填' })
      continue
    }
    const kind = fieldKind(s)
    switch (kind) {
      case 'number': {
        const ns = s as Extract<PropSchema, { type: 'number' | 'integer' }>
        if (!isNum(v)) {
          issues.push({ path, message: '必须是数字' })
          break
        }
        if (ns.type === 'integer' && !Number.isInteger(v)) issues.push({ path, message: '必须是整数' })
        if (ns.minimum !== undefined && v < ns.minimum) issues.push({ path, message: `不能小于 ${ns.minimum}` })
        if (ns.maximum !== undefined && v > ns.maximum) issues.push({ path, message: `不能大于 ${ns.maximum}` })
        if (ns.multipleOf && Math.abs(v / ns.multipleOf - Math.round(v / ns.multipleOf)) > 1e-9)
          issues.push({ path, message: `必须是 ${ns.multipleOf} 的倍数` })
        break
      }
      case 'boolean':
        if (typeof v !== 'boolean') issues.push({ path, message: '必须是开关值' })
        break
      case 'enum': {
        const es = s as Extract<PropSchema, { type: 'string' }>
        if (typeof v !== 'string' || !es.enum!.includes(v))
          issues.push({ path, message: `只能是 ${es.enum!.join(' / ')}` })
        break
      }
      case 'text':
      case 'multiline':
      case 'url':
      case 'color': {
        const ss = s as Extract<PropSchema, { type: 'string' }>
        if (typeof v !== 'string') {
          issues.push({ path, message: '必须是文本' })
          break
        }
        if (ss.maxLength !== undefined && v.length > ss.maxLength)
          issues.push({ path, message: `最多 ${ss.maxLength} 个字符` })
        if (
          kind === 'color' &&
          v &&
          !/^#[0-9a-fA-F]{6}$/.test(v) &&
          !/^#[0-9a-fA-F]{3}$/.test(v) &&
          !/^rgba?\(/.test(v)
        )
          issues.push({ path, message: '颜色格式应为 #rrggbb' })
        break
      }
      case 'array': {
        const as = s as Extract<PropSchema, { type: 'array' }>
        if (!Array.isArray(v)) {
          issues.push({ path, message: '必须是列表' })
          break
        }
        if (as.minItems !== undefined && v.length < as.minItems)
          issues.push({ path, message: `至少 ${as.minItems} 项` })
        if (as.maxItems !== undefined && v.length > as.maxItems)
          issues.push({ path, message: `最多 ${as.maxItems} 项` })
        v.forEach((row, i) => {
          if (!row || typeof row !== 'object' || Array.isArray(row))
            issues.push({ path: `${path}/${i}`, message: '每项必须是对象' })
          else issues.push(...validateProps(as.items, row as Record<string, unknown>, `${path}/${i}/`))
        })
        break
      }
      case 'json':
        break
    }
  }
  if (schema.additionalProperties === false)
    for (const k of Object.keys(values))
      if (!(k in schema.properties)) issues.push({ path: prefix + k, message: '不是该组件的属性,将被忽略' })
  return issues
}

/** 一行数组子表单的空值(用 items 的 default 填) */
export function emptyRow(items: PropsSchema): Record<string, unknown> {
  const row: Record<string, unknown> = {}
  for (const [k, s] of Object.entries(items.properties)) {
    const d = (s as { default?: unknown }).default
    if (d !== undefined) row[k] = d
  }
  return row
}

/** 把表单里的原始输入转成 schema 期望的值;返回 undefined 表示「清空,回到默认」 */
export function coerce(s: PropSchema, raw: string | boolean | null): unknown {
  const kind = fieldKind(s)
  if (kind === 'boolean') return !!raw
  if (kind === 'number') {
    if (raw === '' || raw === null) return undefined
    const n = Number(raw)
    return Number.isFinite(n) ? n : raw
  }
  if (kind === 'json') {
    if (raw === '' || raw === null) return undefined
    try {
      return JSON.parse(String(raw))
    } catch {
      return Symbol.for('invalid-json')
    }
  }
  return raw === null ? undefined : raw
}
