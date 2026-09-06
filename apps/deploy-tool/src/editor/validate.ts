/**
 * 页面配置的统一校验层(T3.5)。四层:
 *   ① schema   —— JSON Schema(渲染器 T0.2 生成物),形状错误
 *   ② binding  —— 绑定存在性:实体按「类型 + 名称」在当前连接的元数据树里可解析,key 在其遥测 / 属性 key 里;
 *                 `calc_` 结果 key 不存在只给 warning(「规则尚未发布」);需要 TB 连接,异步
 *   ③ template —— 模板必填槽位已放组件、组件必填绑定槽位已绑
 *   ④ actions  —— 一期一律 warning「写操作二期启用,渲染为禁用态」,且只允许绑 DEVICE(否则 error)
 * 另附 registry(类型 / 槽位 / mode / multiple)与 props(propsSchema 值域)两层,来自渲染器注册表和 T3.3。
 * error 阻止发布,warning 只提示。每条问题都定位到 widget id(和槽位名)。
 */
import {
  getTemplate,
  getWidget,
  isPageConfig,
  validateAgainstRegistry,
  validatePageConfig,
  type Binding,
  type PageConfig,
  type WidgetConfig,
} from '@grid/scada-renderer'
import type { EntityRef } from '@grid/tb-client'
import type { KeyInfo, MetaNode } from '../meta/MetaNode'
import { validateProps } from './props-form'

export type IssueLayer = 'schema' | 'registry' | 'props' | 'binding' | 'template' | 'actions'

export interface PageIssue {
  level: 'error' | 'warning'
  layer: IssueLayer
  /** JSON Pointer;widgets 下用组件 id 而非下标 */
  path: string
  widgetId?: string
  /** 绑定槽位名 / 模板槽位名 / action 名 */
  slot?: string
  message: string
}

export interface ValidationReport {
  issues: PageIssue[]
  errors: number
  warnings: number
  /** 第 ② 层是否真的跑了(需要 TB 连接) */
  bindingChecked: boolean
}

/** 第 ② 层需要的元数据访问面;`useMeta()` 的 tree / client 直接满足 */
export interface MetaLookup {
  tree: MetaNode | null
  client: {
    tsKeys(entity: EntityRef): Promise<KeyInfo[]>
    attrKeys(entity: EntityRef, scope: string): Promise<string[]>
  } | null
}

export const LAYER_TITLE: Record<IssueLayer, string> = {
  schema: '形状',
  registry: '注册表',
  props: '属性',
  binding: '绑定',
  template: '模板',
  actions: '写操作',
}

/** `calc_` 前缀的 key 是规则链 / 计算字段的结果,发布规则前不存在属正常 */
export const CALC_PREFIX = 'calc_'

// ---------- 路径工具 ----------
const WIDGET_IDX = /^\/widgets\/(\d+)(?=\/|$)/
const WIDGET_ID = /^\/widgets\/([^/]+)(?:\/bindings\/([^/]+))?/

/** schema 层的 `/widgets/0/...` 改成 `/widgets/<id>/...`,并抽出 widgetId / slot */
function locate(path: string, cfg: { widgets?: unknown[] } | null): Pick<PageIssue, 'path' | 'widgetId' | 'slot'> {
  let p = path
  const m = WIDGET_IDX.exec(path)
  if (m && cfg?.widgets) {
    const w = cfg.widgets[Number(m[1])] as { id?: unknown } | undefined
    if (w && typeof w.id === 'string') p = `/widgets/${w.id}${path.slice(m[0].length)}`
  }
  const n = WIDGET_ID.exec(p)
  const out: Pick<PageIssue, 'path' | 'widgetId' | 'slot'> = { path: p }
  if (n?.[1] && !/^\d+$/.test(n[1])) out.widgetId = n[1]
  if (n?.[2]) out.slot = n[2]
  return out
}

const bindingsOf = (w: WidgetConfig): Array<{ slot: string; index: number | null; b: Binding }> => {
  const out: Array<{ slot: string; index: number | null; b: Binding }> = []
  for (const [slot, v] of Object.entries(w.bindings ?? {})) {
    if (Array.isArray(v)) v.forEach((b, i) => out.push({ slot, index: i, b }))
    else if (v) out.push({ slot, index: null, b: v })
  }
  return out
}

// ---------- 同步层:① schema、registry、props、③ template、④ actions ----------

/** 不需要 TB 连接的全部层。输入可以是任意 JSON(schema 不过时其余层跳过)。 */
export function validateStatic(input: unknown): PageIssue[] {
  const issues: PageIssue[] = []
  const sv = validatePageConfig(input)
  const shaped = isPageConfig(input) ? (input as PageConfig) : null
  // actions 下的形状问题归到第 ④ 层;Action 是 oneOf 联合,Ajv allErrors 对一个坏 action 会报一串,按 action 折叠成一条
  const actionShape = new Map<string, { at: ReturnType<typeof locate>; slot: string; msgs: Set<string> }>()
  if (!sv.ok) {
    for (const i of sv.issues) {
      const loc = locate(i.path, shaped)
      const am = /^(\/widgets\/[^/]+\/actions\/([^/]+))/.exec(loc.path)
      if (am) {
        const g = actionShape.get(am[1]!) ?? { at: { ...loc, path: am[1]! }, slot: am[2]!, msgs: new Set() }
        g.msgs.add(`${loc.path.slice(am[1]!.length) || '/'} ${i.message}`)
        actionShape.set(am[1]!, g)
        continue
      }
      issues.push({ level: 'error', layer: 'schema', ...loc, message: i.message })
    }
  }
  if (!shaped) {
    for (const g of actionShape.values())
      issues.push({ level: 'error', layer: 'actions', ...g.at, slot: g.slot, message: [...g.msgs].join(';') })
    return issues
  }
  const cfg = shaped

  // registry(类型 / 槽位 / mode / multiple)—— 两个「必填」检查抽到第 ③ 层
  for (const i of validateAgainstRegistry(cfg)) {
    if (i.code === 'template-slot-required' || i.code === 'binding-slot-required') continue
    issues.push({ level: i.level, layer: 'registry', ...locate(i.path, cfg), message: i.message })
  }

  // props(propsSchema 值域)
  for (const w of cfg.widgets) {
    const def = getWidget(w.type)
    if (!def) continue
    for (const i of validateProps(def.propsSchema, w.props ?? {}))
      issues.push({
        level: 'error',
        layer: 'props',
        path: `/widgets/${w.id}/props/${i.path}`,
        widgetId: w.id,
        message: i.message,
      })
  }

  // ③ template:模板必填槽位 + 组件必填绑定槽位
  const tpl = getTemplate(cfg.template)
  if (tpl)
    for (const s of tpl.slots)
      if (s.required && !cfg.widgets.some(w => w.slot === s.name))
        issues.push({
          level: 'error',
          layer: 'template',
          path: '/widgets',
          slot: s.name,
          message: `模板「${tpl.name}」必填槽位 "${s.name}" 未放组件`,
        })
  for (const w of cfg.widgets) {
    const def = getWidget(w.type)
    if (!def) continue
    for (const s of def.bindingSlots) {
      const v = w.bindings?.[s.name]
      const empty = v === undefined || (Array.isArray(v) && v.length === 0)
      if (s.required && empty)
        issues.push({
          level: 'error',
          layer: 'template',
          path: `/widgets/${w.id}/bindings/${s.name}`,
          widgetId: w.id,
          slot: s.name,
          message: `组件「${def.name}」必填绑定槽位 "${s.title ?? s.name}" 未绑定`,
        })
    }
  }

  // ④ actions:一期一律禁用态 warning;只允许 DEVICE
  for (const w of cfg.widgets) {
    for (const [name, a] of Object.entries(w.actions ?? {})) {
      const path = `/widgets/${w.id}/actions/${name}`
      const type = (a as { entity?: { type?: string } }).entity?.type
      const shape = actionShape.get(path)
      if (type !== 'DEVICE')
        issues.push({
          level: 'error',
          layer: 'actions',
          path: `${path}/entity/type`,
          widgetId: w.id,
          slot: name,
          message: `写操作只允许绑 DEVICE,当前是 ${type ?? '(缺失)'}`,
        })
      else if (shape)
        issues.push({
          level: 'error',
          layer: 'actions',
          path,
          widgetId: w.id,
          slot: name,
          message: `写操作「${name}」形状不合法:${[...shape.msgs].join(';')}`,
        })
      issues.push({
        level: 'warning',
        layer: 'actions',
        path,
        widgetId: w.id,
        slot: name,
        message: `写操作「${name}」(${(a as { kind?: string }).kind ?? '?'})一期不执行:二期启用,渲染为禁用态`,
      })
    }
  }
  return issues
}

// ---------- ② 绑定存在性(异步,需要连接) ----------

interface ResolvedEntity {
  node: MetaNode
  issue?: PageIssue
}

/**
 * 按 ADR-002 解析:优先「类型 + 名称」,其次 id;两者不一致给 warning。
 * `byIdOnly`:契约里 action.entity 只有 {type,id},没有 name,按 id 命中即可不提示。
 */
export function resolveEntity(
  ref: EntityRef,
  index: { byName: Map<string, MetaNode>; byId: Map<string, MetaNode> },
  at: Pick<PageIssue, 'path' | 'widgetId' | 'slot'>,
  byIdOnly = false
): ResolvedEntity | PageIssue {
  const type = ref.type
  const byName = ref.name ? index.byName.get(`${type}\u0000${ref.name}`) : undefined
  if (byName) {
    if (ref.id && byName.entity!.id !== ref.id)
      return {
        node: byName,
        issue: {
          level: 'warning',
          layer: 'binding',
          ...at,
          message: `实体「${ref.name}」在当前环境的 id 与配置不同,发布时按名称重解析`,
        },
      }
    return { node: byName }
  }
  const byId = ref.id ? index.byId.get(ref.id) : undefined
  if (byId && byId.entity!.type === type) {
    if (byIdOnly) return { node: byId }
    if (!ref.name)
      return {
        node: byId,
        issue: {
          level: 'warning',
          layer: 'binding',
          ...at,
          message: `实体 ${ref.id} 缺少 name,跨环境无法按名称解析(应为「${byId.name}」)`,
        },
      }
    return {
      node: byId,
      issue: {
        level: 'warning',
        layer: 'binding',
        ...at,
        message: `按名称找不到「${ref.name}」,但 id 命中「${byId.name}」;名称可能已改,发布前请确认`,
      },
    }
  }
  return {
    level: 'error',
    layer: 'binding',
    ...at,
    message: `${type === 'ASSET' ? '资产' : '设备'}「${ref.name || ref.id || '(空)'}」在当前连接下不存在`,
  }
}

export function indexTree(root: MetaNode): { byName: Map<string, MetaNode>; byId: Map<string, MetaNode> } {
  const byName = new Map<string, MetaNode>()
  const byId = new Map<string, MetaNode>()
  const walk = (n: MetaNode) => {
    if (n.entity) {
      byName.set(`${n.entity.type}\u0000${n.name}`, n)
      byId.set(n.entity.id, n)
    }
    n.children.forEach(walk)
  }
  walk(root)
  return { byName, byId }
}

/** 第 ② 层。`meta.tree` / `meta.client` 任一为空则不检查(返回空数组,由 validatePage 标记 bindingChecked=false)。 */
export async function validateBindingsLayer(cfg: PageConfig, meta: MetaLookup): Promise<PageIssue[]> {
  if (!meta.tree || !meta.client) return []
  const client = meta.client
  const index = indexTree(meta.tree)
  const issues: PageIssue[] = []
  const tsKeysOf = (e: EntityRef) => client.tsKeys(e).then(l => l.map(k => k.key))

  const checkKeys = async (
    at: Pick<PageIssue, 'path' | 'widgetId' | 'slot'>,
    node: MetaNode,
    keys: string[],
    fetch: () => Promise<string[]>,
    what: string
  ) => {
    let have: Set<string>
    try {
      have = new Set(await fetch())
    } catch (e) {
      issues.push({
        level: 'warning',
        layer: 'binding',
        ...at,
        message: `无法读取「${node.name}」的${what} key 列表(${(e as Error).message ?? e}),存在性未检查`,
      })
      return
    }
    for (const key of keys) {
      if (!key || have.has(key)) continue
      if (key.startsWith(CALC_PREFIX))
        issues.push({
          level: 'warning',
          layer: 'binding',
          ...at,
          message: `计算 key「${key}」在「${node.name}」上尚不存在:规则尚未发布,发布规则后会出现`,
        })
      else
        issues.push({
          level: 'error',
          layer: 'binding',
          ...at,
          message: `${what} key「${key}」不在「${node.name}」的 key 列表里`,
        })
    }
  }

  for (const w of cfg.widgets) {
    for (const { slot, index: i, b } of bindingsOf(w)) {
      if (b.mode === 'const' || b.mode === 'ext') continue
      const at = {
        path: `/widgets/${w.id}/bindings/${slot}${i === null ? '' : `/${i}`}`,
        widgetId: w.id,
        slot,
      }
      const r = resolveEntity(b.entity, index, at)
      if ('level' in r) {
        issues.push(r)
        continue
      }
      if (r.issue) issues.push(r.issue)
      const entity = r.node.entity!
      if (b.mode === 'ts') await checkKeys(at, r.node, [b.key], () => tsKeysOf(entity), '遥测')
      else if (b.mode === 'ts-history') await checkKeys(at, r.node, b.keys, () => tsKeysOf(entity), '遥测')
      else if (b.mode === 'attr')
        await checkKeys(at, r.node, [b.key], () => client.attrKeys(entity, b.scope), `属性(${b.scope})`)
      // alarm:实体可解析即可,types 不做存在性检查(告警类型可能尚未发生过)
    }
    for (const [name, a] of Object.entries(w.actions ?? {})) {
      const ref = (a as { entity?: EntityRef }).entity
      if (!ref) continue
      const r = resolveEntity(
        ref,
        index,
        { path: `/widgets/${w.id}/actions/${name}`, widgetId: w.id, slot: name },
        true
      )
      if ('level' in r) issues.push(r)
      else if (r.issue) issues.push(r.issue)
    }
  }
  return issues
}

// ---------- 汇总 ----------

const ORDER: Record<IssueLayer, number> = { schema: 0, registry: 1, props: 2, template: 3, binding: 4, actions: 5 }

export function sortIssues(list: PageIssue[]): PageIssue[] {
  return [...list].sort(
    (a, b) =>
      (a.level === 'error' ? 0 : 1) - (b.level === 'error' ? 0 : 1) ||
      ORDER[a.layer] - ORDER[b.layer] ||
      a.path.localeCompare(b.path)
  )
}

export function summarize(issues: PageIssue[], bindingChecked: boolean): ValidationReport {
  const sorted = sortIssues(issues)
  return {
    issues: sorted,
    errors: sorted.filter(i => i.level === 'error').length,
    warnings: sorted.filter(i => i.level === 'warning').length,
    bindingChecked,
  }
}

/** 全部层。meta 缺省或未连接时第 ② 层跳过,`bindingChecked` 为 false。 */
export async function validatePage(input: unknown, meta?: MetaLookup | null): Promise<ValidationReport> {
  const issues = validateStatic(input)
  const canCheck = !!meta?.tree && !!meta.client && isPageConfig(input)
  if (canCheck) issues.push(...(await validateBindingsLayer(input as PageConfig, meta!)))
  return summarize(issues, canCheck)
}

/** error 阻止发布 */
export const canPublish = (r: Pick<ValidationReport, 'errors'>): boolean => r.errors === 0
