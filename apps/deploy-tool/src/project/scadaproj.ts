/**
 * `.scadaproj` 项目文件(T3.7,架构 §6「配置存在哪里」):页面 JSON 的「源码」,可导出 / 导入、进版本库、在另一台机器重发。
 *   { version, connection: { base, user }, siteName, metaSnapshot, pages: PageConfig[](实体按名), rules, published }
 * - 实体在文件里按「类型 + 名称」为准(ADR-002),id 只是上次解析的提示,发布时按名称重解析。
 * - `rules` 即原 `*.tbsite.json` 的内容(规则 / 运算部分),`pages` 取代原 `layout`;编辑器现阶段只管 pages,rules 由向导填。
 * - `published[页面资产名] = { assetId, version, at, by }`:每页最近一次发布,漂移检测用。
 * 不含任何密码。
 */
import { isPageConfig, validatePageConfig, type PageConfig } from '@grid/scada-renderer'
import type { PublishedRecord } from '../publish/publishPage'

export const PROJECT_VERSION = 1
export const PROJECT_EXT = '.scadaproj'

export interface MetaSnapshot {
  takenAt: number
  devices: { name: string; type?: string }[]
  assets: { name: string; type?: string }[]
}

export interface ScadaProject {
  version: typeof PROJECT_VERSION
  connection: { base: string; user: string }
  siteName: string
  metaSnapshot: MetaSnapshot | null
  pages: PageConfig[]
  rules: unknown | null
  published: Record<string, PublishedRecord>
}

export function createProject(init: Partial<ScadaProject> = {}): ScadaProject {
  return {
    version: PROJECT_VERSION,
    connection: { base: '', user: '' },
    siteName: '',
    metaSnapshot: null,
    pages: [],
    rules: null,
    published: {},
    ...init,
  }
}

export function serializeProject(p: ScadaProject): string {
  // 密码永远不进文件;字段顺序固定,便于 diff
  const out: ScadaProject = {
    version: PROJECT_VERSION,
    connection: { base: p.connection.base, user: p.connection.user },
    siteName: p.siteName,
    metaSnapshot: p.metaSnapshot,
    pages: p.pages,
    rules: p.rules ?? null,
    published: p.published,
  }
  return JSON.stringify(out, null, 2) + '\n'
}

export class ProjectParseError extends Error {
  constructor(
    message: string,
    public readonly issues: string[] = []
  ) {
    super(message)
  }
}

/** 解析并校验;pages 每页过 JSON Schema。任何问题都抛 ProjectParseError(带 issues) */
export function parseProject(text: string): ScadaProject {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch (e) {
    throw new ProjectParseError('不是合法 JSON:' + (e instanceof Error ? e.message : String(e)))
  }
  const issues: string[] = []
  const o = (raw ?? {}) as Partial<ScadaProject> & Record<string, unknown>
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) issues.push('顶层必须是对象')
  if (o.version !== PROJECT_VERSION) issues.push(`version 必须是 ${PROJECT_VERSION},得到 ${String(o.version)}`)
  if (typeof o.siteName !== 'string') issues.push('siteName 必须是字符串')
  const conn = (o.connection ?? {}) as { base?: unknown; user?: unknown }
  if (typeof conn.base !== 'string' || typeof conn.user !== 'string') issues.push('connection.base / user 必须是字符串')
  if ('password' in conn || 'pass' in conn) issues.push('项目文件不能含密码')
  if (!Array.isArray(o.pages)) issues.push('pages 必须是数组')
  else
    o.pages.forEach((pg, i) => {
      if (!isPageConfig(pg)) return issues.push(`pages[${i}] 不是 PageConfig`)
      const sv = validatePageConfig(pg)
      if (!sv.ok)
        issues.push(
          `pages[${i}]「${pg.title ?? ''}」不符合 schema:${sv.issues.map(x => x.path + ' ' + x.message).join('; ')}`
        )
    })
  const published = (o.published ?? {}) as Record<string, unknown>
  if (typeof published !== 'object' || Array.isArray(published)) issues.push('published 必须是对象')
  else
    for (const [k, v] of Object.entries(published)) {
      const r = v as Partial<PublishedRecord>
      if (typeof r?.version !== 'number' || typeof r?.assetId !== 'string')
        issues.push(`published[${k}] 缺 version / assetId`)
    }
  if (issues.length) throw new ProjectParseError(`项目文件有 ${issues.length} 处问题`, issues)
  return createProject({
    connection: { base: conn.base as string, user: conn.user as string },
    siteName: o.siteName as string,
    metaSnapshot: (o.metaSnapshot as MetaSnapshot | null) ?? null,
    pages: o.pages as PageConfig[],
    rules: o.rules ?? null,
    published: published as Record<string, PublishedRecord>,
  })
}

/** 文件名:`<站点名>.scadaproj`(站点名为空则 project) */
export const projectFileName = (p: ScadaProject) => `${p.siteName || 'project'}${PROJECT_EXT}`
