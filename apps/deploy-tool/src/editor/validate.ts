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
import { isComplete } from './binding-check'
import { checkExt, extEntity, extKeys, extKind, extStationId } from './ext-params'

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

/** 各 mode 自己的字段:折叠 oneOf 分支错误时只保留与所选 mode 相关的「缺字段」提示 */
const MODE_FIELDS: Record<string, string[]> = {
  ts: ['entity', 'key'],
  attr: ['entity', 'scope', 'key'],
  'ts-history': ['entity', 'keys', 'window', 'agg', 'maxPoints'],
  alarm: ['entity', 'types'],
  const: ['value'],
  ext: ['source', 'window', 'interval', 'params'],
}

/** 把 Ajv 对一条绑定(oneOf 联合)报的一串错误折叠成一条,只留和所选 mode 有关、能指导修改的信息 */
function collapseBindingIssue(
  path: string,
  at: ReturnType<typeof locate>,
  list: { sub: string; message: string; keyword: string }[],
  cfg: PageConfig | null
): PageIssue {
  // 找到这条绑定对象,看它声明的 mode
  let mode: string | undefined
  const m = /^\/widgets\/([^/]+)\/bindings\/([^/]+)(?:\/(\d+))?$/.exec(path)
  if (m && cfg) {
    const w = cfg.widgets.find(x => x.id === m[1])
    const b = w?.bindings?.[m[2]!]
    const one = m[3] !== undefined ? (Array.isArray(b) ? b[Number(m[3])] : undefined) : Array.isArray(b) ? undefined : b
    mode = (one as { mode?: string } | undefined)?.mode
  }
  const fields = mode ? MODE_FIELDS[mode] : undefined
  const msgs = new Set<string>()
  for (const i of list) {
    if (i.keyword === 'oneOf' || i.keyword === 'anyOf' || i.keyword === 'additionalProperties') continue
    if (i.keyword === 'required') {
      const f = /property '([^']+)'/.exec(i.message)?.[1]
      if (f && fields && fields.includes(f)) msgs.add(`缺 ${f}`)
      continue
    }
    // 只留子路径上的具体错误(如 /key 太短、/entity/id 为空);绑定对象本身那一层的「must be array」之类是联合分支噪音
    const top = i.sub.split('/')[1]
    if (!top) continue
    if (!fields || fields.includes(top)) msgs.add(`${i.sub} ${i.message}`)
  }
  const message = !mode
    ? '绑定缺少 mode'
    : !fields
      ? `mode「${mode}」不是六种绑定之一`
      : msgs.size
        ? `「${mode}」绑定未填完整:${[...msgs].join(';')}`
        : `「${mode}」绑定形状不合法`
  return { level: 'error', layer: 'schema', ...at, path, message }
}

// ---------- 同步层:① schema、registry、props、③ template、④ actions ----------

/** 不需要 TB 连接的全部层。输入可以是任意 JSON(schema 不过时其余层跳过)。 */
export function validateStatic(input: unknown): PageIssue[] {
  const issues: PageIssue[] = []
  const sv = validatePageConfig(input)
  const shaped = isPageConfig(input) ? (input as PageConfig) : null
  // actions 下的形状问题归到第 ④ 层;Action 是 oneOf 联合,Ajv allErrors 对一个坏 action 会报一串,按 action 折叠成一条
  const actionShape = new Map<string, { at: ReturnType<typeof locate>; slot: string; msgs: Set<string> }>()
  // Binding 同样是六种 mode 的 oneOf 联合:一条没填完的 ts 绑定会冒出 20 多条分支错误,按绑定折叠成一条
  const bindingRaw = new Map<
    string,
    { at: ReturnType<typeof locate>; list: { sub: string; message: string; keyword: string }[] }
  >()
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
      const bm = /^(\/widgets\/[^/]+\/bindings\/[^/]+(?:\/\d+)?)/.exec(loc.path)
      if (bm) {
        const g = bindingRaw.get(bm[1]!) ?? { at: { ...loc, path: bm[1]! }, list: [] }
        g.list.push({ sub: loc.path.slice(bm[1]!.length), message: i.message, keyword: i.keyword })
        bindingRaw.set(bm[1]!, g)
        continue
      }
      issues.push({ level: 'error', layer: 'schema', ...loc, message: i.message })
    }
  }
  // 多序列槽位:数组本身那一层(bindings 值是「单个 | 数组」的 anyOf)也会挂一串,若已有更具体的 /<i> 分组就只报那一条
  const bindingPaths = [...bindingRaw.keys()]
  for (const [path, g] of bindingRaw) {
    if (bindingPaths.some(k => k !== path && k.startsWith(path + '/'))) continue
    issues.push(collapseBindingIssue(path, g.at, g.list, shaped))
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

  // 一条历史曲线绑定 = 一条序列 = 一个测点:多写的会被渲染器丢掉。纯配置检查,不连 TB 也要拦(审查 R3)
  for (const w of cfg.widgets) {
    for (const { slot, index: i, b } of bindingsOf(w)) {
      if (b.mode !== 'ts-history' || b.keys.length <= 1) continue
      issues.push({
        level: 'error',
        layer: 'registry',
        path: `/widgets/${w.id}/bindings/${slot}${i === null ? '' : `/${i}`}`,
        widgetId: w.id,
        slot,
        message:
          `一条历史曲线绑定只画一条序列,只会用第一个测点「${b.keys[0]}」,` +
          `${b.keys.slice(1).join('、')} 会被丢掉。要画多条曲线,请在这个槽位「+ 添加一条」绑定。`,
      })
    }
  }

  // ext(kz)的 params 是自由对象,JSON Schema 表达不了两种查询的形状 —— 在这里按契约 §4.3b 检查。
  // 与编辑器的绑定表单同一份规则(`ext-params.ts`),免得「表单让填、校验层不认」。
  for (const w of cfg.widgets) {
    for (const { slot, index: i, b } of bindingsOf(w)) {
      if (b.mode !== 'ext') continue
      const base = `/widgets/${w.id}/bindings/${slot}${i === null ? '' : `/${i}`}`
      for (const e of checkExt(b))
        issues.push({ level: e.level, layer: 'schema', path: base + e.sub, widgetId: w.id, slot, message: e.message })
    }
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
/**
 * ext(kz)绑定的存在性检查。
 * - 归档历史:`params.entity` 按 ADR-002 解析,`params.keys` 对 TB 的遥测 key 列表核对。
 *   key 不在列表里只给 **warning**:kz 是独立归档库,TB 侧已停更(或已被清理)的 key 仍可能有历史,
 *   拿 TB 的 latest key 列表当唯一真相会误杀。
 * - 收益趋势:`stationId` 实测就是 TB 里 `gateway` 设备的 id;不是网关就 warning ——
 *   kz 对任何不是站点的 id 一律只回「该站点下无设备」,现场分不出「选错了」还是「真没数据」。
 */
async function checkExtExistence(
  at: Pick<PageIssue, 'path' | 'widgetId' | 'slot'>,
  b: Binding & { mode: 'ext' },
  index: { byName: Map<string, MetaNode>; byId: Map<string, MetaNode> },
  client: NonNullable<MetaLookup['client']>,
  issues: PageIssue[]
): Promise<void> {
  const kind = extKind(b)
  if (kind === 'revenue') {
    const id = extStationId(b)
    const node = index.byId.get(id)
    if (!node)
      issues.push({
        level: 'warning',
        layer: 'binding',
        ...at,
        path: `${at.path}/params/stationId`,
        message: `站点 id「${id}」在当前连接里找不到对应设备;kz 对不是站点的 id 一律只回「该站点下无设备」,发布后看不出是选错还是没数据`,
      })
    else if (node.kind !== 'gateway' && node.profile !== 'gateway')
      issues.push({
        level: 'warning',
        layer: 'binding',
        ...at,
        path: `${at.path}/params/stationId`,
        message: `「${node.name}」不是 gateway 设备,kz 的站点只认网关;多半会返回「该站点下无设备」`,
      })
    return
  }
  if (kind !== 'history') return
  const ref = extEntity(b)
  if (!ref) return
  const r = resolveEntity(ref, index, { ...at, path: `${at.path}/params/entity` })
  if ('level' in r) {
    issues.push(r)
    return
  }
  if (r.issue) issues.push(r.issue)
  const entity = r.node.entity!
  let have: Set<string>
  try {
    have = new Set((await client.tsKeys(entity)).map(k => k.key))
  } catch (e) {
    issues.push({
      level: 'warning',
      layer: 'binding',
      ...at,
      message: `无法读取「${r.node.name}」的遥测 key 列表(${(e as Error).message ?? e}),kz 归档 key 存在性未检查`,
    })
    return
  }
  for (const key of extKeys(b)) {
    if (!key || have.has(key)) continue
    issues.push({
      level: 'warning',
      layer: 'binding',
      ...at,
      path: `${at.path}/params/keys`,
      message: `kz 归档测点「${key}」不在「${r.node.name}」当前的 TB 遥测 key 里 —— 若该点位已停更、只剩归档,属正常;否则多半是选错了`,
    })
  }
}

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
      if (b.mode === 'const') continue
      // 没填完的绑定由 schema 层报「未填完整」,这里不再重复报「实体(空)不存在」
      if (!isComplete(b)) continue
      const at = {
        path: `/widgets/${w.id}/bindings/${slot}${i === null ? '' : `/${i}`}`,
        widgetId: w.id,
        slot,
      }
      // ext(kz):kz 是 TB 同一份遥测的长期归档,实体与 key 都还是 TB 的,照样查得了存在性。
      // 形状本身在 validateStatic 的 checkExt 里管,这里只补存在性这一半。
      if (b.mode === 'ext') {
        await checkExtExistence(at, b, index, client, issues)
        continue
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
