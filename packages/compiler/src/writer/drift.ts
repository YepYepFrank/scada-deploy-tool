// 按站点的漂移检测(架构 §10「变更单向」):本地声明文件 / 页面文件 vs TB 上站点资产 siteConfig / ScadaPage pageConfig。
// 只读;给 CLI `tbsite drift` 与 `publish` 前的提示用。比较前把实体引用归一成 {type, name},避免「本地按名、线上按 id」的假差异(ADR-002)。
import type { TbsiteConfig } from '../types'
import { findAsset, type TbApi } from './api'
import { listSitePages, pageNameOf, readPageState } from '../page/publish-page'
import type { PagePayload } from '../page/types'

export interface DiffEntry {
  /** 点分路径;数组按 name / key / id 字段对齐时用 `[name]` */
  path: string
  kind: 'added' | 'removed' | 'changed'
  local?: unknown
  remote?: unknown
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const ID_FIELDS = ['name', 'key', 'id'] as const
const alignField = (arr: unknown[]): (typeof ID_FIELDS)[number] | null => {
  if (!arr.length || !arr.every(isObj)) return null
  for (const f of ID_FIELDS) if (arr.every(o => typeof (o as Record<string, unknown>)[f] === 'string')) return f
  return null
}
const brief = (v: unknown): unknown => {
  if (Array.isArray(v)) return `[${v.length} 项]`
  if (isObj(v)) return `{${Object.keys(v).length} 字段}`
  return v
}

/** 结构化 diff:对象按键、数组按 name / key / id 对齐(否则按下标),叶子按 JSON 值;最多 MAX 条 */
export function diffJson(local: unknown, remote: unknown, opts: { ignore?: string[]; max?: number } = {}): DiffEntry[] {
  const ignore = new Set(opts.ignore ?? [])
  const max = opts.max ?? 200
  const out: DiffEntry[] = []
  const push = (e: DiffEntry) => {
    if (out.length < max) out.push(e)
  }
  const walk = (a: unknown, b: unknown, path: string) => {
    if (out.length >= max) return
    if (isObj(a) && isObj(b)) {
      for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
        if (ignore.has(k)) continue
        const p = path ? `${path}.${k}` : k
        if (!(k in b)) push({ path: p, kind: 'added', local: brief(a[k]) })
        else if (!(k in a)) push({ path: p, kind: 'removed', remote: brief(b[k]) })
        else walk(a[k], b[k], p)
      }
      return
    }
    if (Array.isArray(a) && Array.isArray(b)) {
      const f = alignField(a) && alignField(a) === alignField(b) ? alignField(a) : null
      if (f) {
        const bm = new Map(b.map(o => [(o as Record<string, unknown>)[f] as string, o]))
        const am = new Map(a.map(o => [(o as Record<string, unknown>)[f] as string, o]))
        for (const [k, av] of am) {
          const p = `${path}[${k}]`
          if (!bm.has(k)) push({ path: p, kind: 'added', local: brief(av) })
          else walk(av, bm.get(k), p)
        }
        for (const k of bm.keys())
          if (!am.has(k)) push({ path: `${path}[${k}]`, kind: 'removed', remote: brief(bm.get(k)) })
        return
      }
      if (JSON.stringify(a) === JSON.stringify(b)) return
      if (a.length !== b.length) {
        push({ path, kind: 'changed', local: `[${a.length} 项]`, remote: `[${b.length} 项]` })
        return
      }
      a.forEach((av, i) => walk(av, b[i], `${path}[${i}]`))
      return
    }
    if (JSON.stringify(a) !== JSON.stringify(b))
      push({ path: path || '(root)', kind: 'changed', local: brief(a), remote: brief(b) })
  }
  walk(local, remote, '')
  return out
}

/** 实体引用归一:{type,id,name} → {type, name(缺则 id)},去掉发布时回填的 id 带来的假差异 */
export function normalizeEntityRefs<T>(v: T): T {
  const walk = (x: unknown): unknown => {
    if (Array.isArray(x)) return x.map(walk)
    if (isObj(x)) {
      if (
        (x.type === 'DEVICE' || x.type === 'ASSET') &&
        'id' in x &&
        Object.keys(x).every(k => ['type', 'id', 'name'].includes(k))
      )
        return { type: x.type, name: (typeof x.name === 'string' && x.name) || x.id }
      const o: Record<string, unknown> = {}
      for (const [k, val] of Object.entries(x)) o[k] = walk(val)
      return o
    }
    return x
  }
  return walk(v) as T
}

export const summarizeDiff = (d: DiffEntry[]): string[] =>
  d.map(e =>
    e.kind === 'added'
      ? `+ ${e.path}(本地有、线上无)${e.local !== undefined ? ':' + JSON.stringify(e.local) : ''}`
      : e.kind === 'removed'
        ? `- ${e.path}(线上有、本地无)${e.remote !== undefined ? ':' + JSON.stringify(e.remote) : ''}`
        : `~ ${e.path}:本地 ${JSON.stringify(e.local)} / 线上 ${JSON.stringify(e.remote)}`
  )

export async function readSiteState(api: TbApi, siteName: string) {
  const asset = await findAsset(api, siteName)
  if (!asset) return { assetId: null as string | null, config: null as TbsiteConfig | null, historyLength: 0 }
  const attrs: { key: string; value: unknown }[] =
    (await api(
      `/api/plugins/telemetry/ASSET/${asset.id.id}/values/attributes/SERVER_SCOPE?keys=siteConfig,siteConfigHistory`
    )) || []
  const parse = (v: unknown) => (typeof v === 'string' ? JSON.parse(v) : v)
  const config = parse(attrs.find(a => a.key === 'siteConfig')?.value) ?? null
  const hist = parse(attrs.find(a => a.key === 'siteConfigHistory')?.value)
  return {
    assetId: asset.id.id as string,
    config: config as TbsiteConfig | null,
    historyLength: Array.isArray(hist) ? hist.length : 0,
  }
}

export interface LocalPage {
  file: string
  config: PagePayload
}
export interface PageDrift {
  file: string
  title: string
  /** 对上的 TB 页面资产;没对上为 null(本地新页面或线上已删) */
  pageName: string | null
  assetId: string | null
  remoteVersion: number | null
  diff: DiffEntry[] | null
}
export interface SiteDriftReport {
  siteName: string
  assetId: string | null
  remoteExists: boolean
  historyLength: number
  siteDiff: DiffEntry[]
  pages: PageDrift[]
  /** 线上有、本地目录里没有对应文件的页面 */
  remoteOnlyPages: string[]
}

/** 站点声明 + 页面文件 vs 线上。页面按标题对上(其次按 pageNameOf 的默认命名);siteConfig 忽略发布元数据键 */
export async function detectSiteDrift(
  api: TbApi,
  cfg: TbsiteConfig,
  pages: LocalPage[] = []
): Promise<SiteDriftReport> {
  const siteName = cfg.site.name
  const st = await readSiteState(api, siteName)
  const siteDiff = st.config
    ? diffJson(normalizeEntityRefs(cfg), normalizeEntityRefs(st.config), {
        ignore: ['publishedAt', 'publishedBy', '_meta'],
      })
    : []
  const out: PageDrift[] = []
  const remoteOnlyPages: string[] = []
  if (st.assetId) {
    const remotePages = await listSitePages(api, siteName)
    const remoteStates = await Promise.all(
      remotePages.map(async p => ({ ...p, state: await readPageState(api, p.assetId) }))
    )
    const matched = new Set<string>()
    for (const lp of pages) {
      const title = lp.config.title ?? ''
      const hit =
        remoteStates.find(r => r.state.config?.title && r.state.config.title === title) ??
        remoteStates.find(r => r.name === pageNameOf(siteName, { title }))
      if (!hit) {
        out.push({ file: lp.file, title, pageName: null, assetId: null, remoteVersion: null, diff: null })
        continue
      }
      matched.add(hit.assetId)
      out.push({
        file: lp.file,
        title,
        pageName: hit.name,
        assetId: hit.assetId,
        remoteVersion: hit.version,
        diff: hit.state.config ? diffJson(normalizeEntityRefs(lp.config), normalizeEntityRefs(hit.state.config)) : null,
      })
    }
    for (const r of remoteStates) if (!matched.has(r.assetId)) remoteOnlyPages.push(r.name)
  }
  return {
    siteName,
    assetId: st.assetId,
    remoteExists: !!st.config,
    historyLength: st.historyLength,
    siteDiff,
    pages: out,
    remoteOnlyPages,
  }
}
