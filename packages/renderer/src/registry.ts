/**
 * 注册表:组件与模板的运行时登记 + 针对注册表的配置校验(契约 §9「注册表运行时」层)。
 * 契约层(JSON Schema)只管形状;这里管「template / type 存在、slot 在模板内、绑定槽位与 valueType / modes / multiple 相符」。
 * 槽位先按静态 bindingSlots 的名字找,找不到再按 dynamicSlots 的前缀匹配(接线图的 `pt.<pointId>`)。
 */
import type { PageConfig, WidgetConfig, Binding } from './schema/page-config'
import type { WidgetDefinition, TemplateDefinition, BindingSlotSpec } from './schema/registry'

export interface RegistryIssue {
  /** 'error' 阻止渲染该组件(其他组件照常);'warning' 只记录 */
  level: 'error' | 'warning'
  /** JSON Pointer 风格定位,如 /widgets/w-s1/bindings/value */
  path: string
  message: string
  /** 稳定问题码,供上层(编辑器校验层)分层 / 去重;只对少数检查给出 */
  code?: 'template-slot-required' | 'binding-slot-required'
}

const widgets_ = new Map<string, WidgetDefinition>()
const templates = new Map<string, TemplateDefinition>()

export function registerWidget(def: WidgetDefinition): void {
  if (!/^[a-z][a-z0-9-]*$/.test(def.type)) throw new Error(`widget type "${def.type}" 不符合 ^[a-z][a-z0-9-]*$`)
  const names = new Set<string>()
  for (const s of def.bindingSlots) {
    if (names.has(s.name)) throw new Error(`widget "${def.type}" 绑定槽位 "${s.name}" 重复`)
    names.add(s.name)
  }
  const prefixes = new Set<string>()
  for (const d of def.dynamicSlots ?? []) {
    if (!d.prefix) throw new Error(`widget "${def.type}" 动态槽位的 prefix 不能为空`)
    if (prefixes.has(d.prefix)) throw new Error(`widget "${def.type}" 动态槽位前缀 "${d.prefix}" 重复`)
    prefixes.add(d.prefix)
    // 静态槽位同名优先,落进动态前缀里的静态名会让同一个名字有两种读法,直接拒绝
    for (const n of names)
      if (n.startsWith(d.prefix))
        throw new Error(`widget "${def.type}" 动态槽位前缀 "${d.prefix}" 与静态槽位 "${n}" 冲突`)
  }
  widgets_.set(def.type, def)
}

/**
 * 查一个槽位名的规格:先静态 bindingSlots,再按 dynamicSlots 前缀(槽位名以 prefix 开头且长度大于 prefix;
 * 多个前缀都匹配时取最长的)。动态匹配上时构造一个等价的 BindingSlotSpec(非必填、非多序列)。
 */
export function findSlotSpec(def: WidgetDefinition, name: string): BindingSlotSpec | undefined {
  const fixed = def.bindingSlots.find(s => s.name === name)
  if (fixed) return fixed
  let hit: NonNullable<WidgetDefinition['dynamicSlots']>[number] | undefined
  for (const d of def.dynamicSlots ?? []) {
    if (name.length > d.prefix.length && name.startsWith(d.prefix) && (!hit || d.prefix.length > hit.prefix.length))
      hit = d
  }
  if (!hit) return undefined
  return {
    name,
    ...(hit.title !== undefined ? { title: hit.title } : {}),
    valueType: hit.valueType,
    ...(hit.modes ? { modes: hit.modes } : {}),
    ...(hit.stamped ? { stamped: true } : {}),
  }
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

export const getWidget = (type: string): WidgetDefinition | undefined => widgets_.get(type)
export const getTemplate = (id: string): TemplateDefinition | undefined => templates.get(id)
export const listWidgets = (): WidgetDefinition[] => [...widgets_.values()]
export const listTemplates = (): TemplateDefinition[] => [...templates.values()]
/**
 * 把配置里每个组件的旧属性名按其 migrateProps 正规化(不改输入,返回新对象;没有 migrateProps 的组件原样)。
 * <ScadaPage> 渲染前会自动做同样的事;编辑器 / 宿主在「读入一份可能是旧版本发布的配置」时调用它,
 * 这样校验层不会把旧键名当多余属性报错,再发布出去的也是新键名。
 */
export function migrateConfigProps(config: PageConfig): PageConfig {
  let changed = false
  const widgets = config.widgets.map(w => {
    const def = widgets_.get(w.type)
    if (!def?.migrateProps || !w.props) return w
    const next = def.migrateProps(w.props as Record<string, unknown>)
    if (next === w.props) return w
    changed = true
    return { ...w, props: next }
  })
  return changed ? { ...config, widgets } : config
}

/** 测试用:清空注册表 */
export function resetRegistry(): void {
  widgets_.clear()
  templates.clear()
}

const MODE_VALUE_TYPES: Record<Binding['mode'], BindingSlotSpec['valueType'][]> = {
  // ts / attr 也可喂 series 槽位:解析器把实时推送累积成点列(无历史回填的「实时曲线」/ 表格当前值)
  ts: ['number', 'string', 'boolean', 'series', 'any'],
  'ts-history': ['series', 'any'],
  attr: ['number', 'string', 'boolean', 'series', 'any'],
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
    if (seenIds.has(w.id)) issues.push({ level: 'error', path: `/widgets/${w.id}`, message: `组件 id "${w.id}" 重复` })
    seenIds.add(w.id)
    issues.push(...validateWidgetAgainstRegistry(w, tpl))
  }
  if (tpl) {
    for (const s of tpl.slots) {
      if (s.required && !config.widgets.some(w => w.slot === s.name))
        issues.push({
          level: 'error',
          path: '/widgets',
          code: 'template-slot-required',
          message: `模板必填槽位 "${s.name}" 未配置组件`,
        })
    }
  }
  return issues
}

/**
 * 校验单个组件(<ScadaWidget> 单卡入口用;validateAgainstRegistry 对每个组件也走这里)。
 * 传 tpl 时连带查槽位是否存在 / accepts;不传(单卡嵌入,没有模板)只查类型与绑定。
 */
export function validateWidgetAgainstRegistry(w: WidgetConfig, tpl?: TemplateDefinition): RegistryIssue[] {
  const issues: RegistryIssue[] = []
  const base = `/widgets/${w.id}`
  const def = widgets_.get(w.type)
  if (!def) {
    issues.push({ level: 'error', path: `${base}/type`, message: `未知组件类型 "${w.type}"` })
    return issues
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
  return issues
}

function validateBindings(w: WidgetConfig, def: WidgetDefinition, base: string): RegistryIssue[] {
  const issues: RegistryIssue[] = []
  for (const [name, b] of Object.entries(w.bindings)) {
    const p = `${base}/bindings/${name}`
    // 静态槽位找不到时按动态前缀匹配;动态规格不带 multiple,下面「必须是单个对象」的检查自然生效
    const spec = findSlotSpec(def, name)
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
        code: 'binding-slot-required',
        message: `组件 "${def.type}" 的必填绑定槽位 "${s.name}" 缺失`,
      })
  }
  return issues
}
