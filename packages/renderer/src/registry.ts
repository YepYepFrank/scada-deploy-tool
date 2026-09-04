/**
 * 注册表:组件与模板的运行时登记 + 针对注册表的配置校验(契约 §9「注册表运行时」层)。
 * 契约层(JSON Schema)只管形状;这里管「template / type 存在、slot 在模板内、绑定槽位与 valueType / modes / multiple 相符」。
 */
import type { PageConfig, WidgetConfig, Binding } from './schema/page-config'
import type { WidgetDefinition, TemplateDefinition, BindingSlotSpec } from './schema/registry'

export interface RegistryIssue {
  /** 'error' 阻止渲染该组件(其他组件照常);'warning' 只记录 */
  level: 'error' | 'warning'
  /** JSON Pointer 风格定位,如 /widgets/w-s1/bindings/value */
  path: string
  message: string
}

const widgets = new Map<string, WidgetDefinition>()
const templates = new Map<string, TemplateDefinition>()

export function registerWidget(def: WidgetDefinition): void {
  if (!/^[a-z][a-z0-9-]*$/.test(def.type)) throw new Error(`widget type "${def.type}" 不符合 ^[a-z][a-z0-9-]*$`)
  const names = new Set<string>()
  for (const s of def.bindingSlots) {
    if (names.has(s.name)) throw new Error(`widget "${def.type}" 绑定槽位 "${s.name}" 重复`)
    names.add(s.name)
  }
  widgets.set(def.type, def)
}

export function registerTemplate(def: TemplateDefinition): void {
  if (!/^[a-z][a-z0-9-]*$/.test(def.id)) throw new Error(`template id "${def.id}" 不符合 ^[a-z][a-z0-9-]*$`)
  if (def.kind === 'scaled' && !def.design) throw new Error(`scaled 模板 "${def.id}" 缺少 design 尺寸`)
  if (def.kind === 'grid' && !def.areas?.length) throw new Error(`grid 模板 "${def.id}" 缺少 areas`)
  const names = new Set<string>()
  for (const s of def.slots) {
    if (names.has(s.name)) throw new Error(`template "${def.id}" 槽位 "${s.name}" 重复`)
    names.add(s.name)
  }
  templates.set(def.id, def)
}

export const getWidget = (type: string): WidgetDefinition | undefined => widgets.get(type)
export const getTemplate = (id: string): TemplateDefinition | undefined => templates.get(id)
export const listWidgets = (): WidgetDefinition[] => [...widgets.values()]
export const listTemplates = (): TemplateDefinition[] => [...templates.values()]
/** 测试用:清空注册表 */
export function resetRegistry(): void {
  widgets.clear()
  templates.clear()
}

const MODE_VALUE_TYPES: Record<Binding['mode'], BindingSlotSpec['valueType'][]> = {
  ts: ['number', 'string', 'boolean', 'any'],
  'ts-history': ['series', 'any'],
  attr: ['number', 'string', 'boolean', 'any'],
  alarm: ['alarms', 'any'],
  const: ['number', 'string', 'boolean', 'series', 'alarms', 'any'],
  ext: ['series', 'any'],
}

/** 针对注册表校验一份(已通过 JSON Schema 的)配置。不抛错,返回问题列表。 */
export function validateAgainstRegistry(config: PageConfig): RegistryIssue[] {
  const issues: RegistryIssue[] = []
  const tpl = templates.get(config.template)
  if (!tpl) {
    issues.push({ level: 'error', path: '/template', message: `未知模板 "${config.template}"` })
  }
  const seenIds = new Set<string>()
  for (const w of config.widgets) {
    const base = `/widgets/${w.id}`
    if (seenIds.has(w.id)) issues.push({ level: 'error', path: base, message: `组件 id "${w.id}" 重复` })
    seenIds.add(w.id)

    const def = widgets.get(w.type)
    if (!def) {
      issues.push({ level: 'error', path: `${base}/type`, message: `未知组件类型 "${w.type}"` })
      continue
    }
    if (tpl) {
      const slot = tpl.slots.find(s => s.name === w.slot)
      if (!slot) issues.push({ level: 'error', path: `${base}/slot`, message: `模板 "${tpl.id}" 没有槽位 "${w.slot}"` })
      else if (slot.accepts && !slot.accepts.includes(w.type))
        issues.push({
          level: 'error',
          path: `${base}/slot`,
          message: `槽位 "${w.slot}" 不接受组件 "${w.type}"(允许:${slot.accepts.join(', ')})`,
        })
    }
    issues.push(...validateBindings(w, def, base))
  }
  if (tpl) {
    for (const s of tpl.slots) {
      if (s.required && !config.widgets.some(w => w.slot === s.name))
        issues.push({ level: 'error', path: '/widgets', message: `模板必填槽位 "${s.name}" 未配置组件` })
    }
  }
  return issues
}

function validateBindings(w: WidgetConfig, def: WidgetDefinition, base: string): RegistryIssue[] {
  const issues: RegistryIssue[] = []
  const specs = new Map(def.bindingSlots.map(s => [s.name, s]))
  for (const [name, b] of Object.entries(w.bindings)) {
    const p = `${base}/bindings/${name}`
    const spec = specs.get(name)
    if (!spec) {
      issues.push({ level: 'warning', path: p, message: `组件 "${def.type}" 没有绑定槽位 "${name}",已忽略` })
      continue
    }
    const isArr = Array.isArray(b)
    if (spec.multiple && !isArr) {
      issues.push({ level: 'error', path: p, message: `槽位 "${name}" 为多序列,绑定必须写成数组(单条也写一项)` })
      continue
    }
    if (!spec.multiple && isArr) {
      issues.push({ level: 'error', path: p, message: `槽位 "${name}" 不是多序列,绑定必须是单个对象` })
      continue
    }
    const list = isArr ? (b as Binding[]) : [b as Binding]
    list.forEach((one, i) => {
      const pp = isArr ? `${p}/${i}` : p
      if (spec.modes?.length && !spec.modes.includes(one.mode))
        issues.push({
          level: 'error',
          path: pp,
          message: `槽位 "${name}" 不允许 mode "${one.mode}"(允许:${spec.modes.join(', ')})`,
        })
      else if (!MODE_VALUE_TYPES[one.mode].includes(spec.valueType))
        issues.push({ level: 'error', path: pp, message: `mode "${one.mode}" 无法提供 "${spec.valueType}" 类型的值` })
    })
  }
  for (const s of def.bindingSlots) {
    if (s.required && !(s.name in w.bindings))
      issues.push({
        level: 'error',
        path: `${base}/bindings`,
        message: `组件 "${def.type}" 的必填绑定槽位 "${s.name}" 缺失`,
      })
  }
  return issues
}
