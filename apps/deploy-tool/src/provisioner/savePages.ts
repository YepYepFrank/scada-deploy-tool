/**
 * 第 4 步「保存并进入发布上线」(2026-09-17):把页面(卡片库非空时一并)直接发布到 TB,成功后进第 5 步。
 * 纯逻辑,publishPage / listSitePages 注入,便于单测。安全规则与第 5 步的发布面板一致:
 *   - 任一文档校验有错 → 不发、不跳;
 *   - 线上 version 与本地记录不一致(有人在 TB 上改过 / 本地不是最新)→ 不发、不跳,让人去第 5 步面板里选「覆盖 / 保留」;
 *   - 站点资产还不存在(新站点还没发布过规则)→ 不发,但允许跳到第 5 步先发规则;
 *   - 发布失败于某一步 → 停在第 4 步,报出原因(publishPage 自己已逆序回滚)。
 */
import type { PagePayload, PublishPageOptions, PublishPageResult, SitePageInfo, TbApi } from '@grid/tbsite-compiler'

export interface PublishedRecordLike {
  assetId: string
  version: number
}
export interface SaveDoc {
  label: string
  /** 'cards' = 卡片库;普通页面不传 */
  kind?: string
  config: PagePayload
  pageName: string
  errorCount: number
  /** 本地(项目记录)的已发布版本;从没发布过为 undefined */
  published?: PublishedRecordLike
}
export interface SaveDeps {
  api: TbApi
  siteName: string
  user: string
  publishPage: (page: PagePayload, api: TbApi, opts: PublishPageOptions) => Promise<PublishPageResult>
  listSitePages: (api: TbApi, siteName: string) => Promise<SitePageInfo[]>
}
export type SaveBlock = 'errors' | 'conflict' | 'site-missing' | 'failed' | 'nothing'
export interface SaveOutcome {
  ok: boolean
  /** 给界面显示的一句话 */
  msg: string
  block?: SaveBlock
  /** 成功发布的文档(按传入顺序) */
  published: { label: string; pageName: string; assetId: string; version: number }[]
}

/** 站点下已有的页面按名字取(站点资产不存在时抛 Error,由调用方判断) */
async function remoteByName(deps: SaveDeps): Promise<Map<string, SitePageInfo>> {
  const pages = await deps.listSitePages(deps.api, deps.siteName)
  return new Map(pages.map(p => [p.name, p]))
}

const isSiteMissing = (e: unknown) => /站点资产.*不存在/.test(e instanceof Error ? e.message : String(e))

export async function savePagesAndPublish(docs: SaveDoc[], deps: SaveDeps): Promise<SaveOutcome> {
  const published: SaveOutcome['published'] = []
  // 没放过组件的文档(没配页面 / 卡片库空)不发,也不算错——一键发布(规则 + 页面)时站点可以只有规则
  const todo = docs.filter(d => d.config.widgets.length > 0)
  if (!todo.length) return { ok: true, block: 'nothing', msg: '没有配置页面,跳过页面发布', published }
  const bad = todo.find(d => d.errorCount > 0)
  if (bad) return { ok: false, block: 'errors', msg: `${bad.label}校验有 ${bad.errorCount} 个错误,先修好再发布`, published }

  let remote: Map<string, SitePageInfo>
  try {
    remote = await remoteByName(deps)
  } catch (e) {
    if (isSiteMissing(e))
      return {
        ok: false,
        block: 'site-missing',
        msg: `站点「${deps.siteName}」在平台上还不存在:先到第 5 步「发布上线」发布规则(会建站点资产),再回来发布页面`,
        published,
      }
    throw e
  }
  for (const d of todo) {
    const r = remote.get(d.pageName)
    const local = d.published?.version
    if (r && r.version !== null && r.version !== local)
      return {
        ok: false,
        block: 'conflict',
        msg: `「${d.pageName}」线上是 version ${r.version},本地记录${local === undefined ? '没有发布过' : ` version ${local}`}——有人在平台上改过或本地不是最新;到第 5 步「发布页面」里选「覆盖」或「保留」`,
        published,
      }
  }

  for (const d of todo) {
    const r = await deps.publishPage(d.config, deps.api, {
      siteName: deps.siteName,
      pageName: d.pageName,
      publishedBy: deps.user,
      ...(d.kind ? { kind: d.kind } : {}),
    })
    if (!r.ok) {
      const un = r.unresolved.length ? `;解析不到:${r.unresolved.map(u => `${u.type} ${u.name}`).join(', ')}` : ''
      return {
        ok: false,
        block: 'failed',
        msg: `${d.label}发布失败于 ${r.failedStep ?? '?'}:${r.error ?? ''}${un}${published.length ? `(${published.map(p => p.label).join('、')}已发布成功)` : ''}`,
        published,
      }
    }
    published.push({ label: d.label, pageName: r.pageName, assetId: r.assetId!, version: r.version! })
  }
  return {
    ok: true,
    msg: `已发布 ${published.map(p => `${p.label} v${p.version}`).join('、')}`,
    published,
  }
}
