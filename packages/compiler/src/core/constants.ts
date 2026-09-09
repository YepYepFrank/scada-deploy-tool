import type { AggName, CompareOp, Window } from '../types'

export const WINDOW_SECONDS: Record<Window, number> = { '5m': 300, '15m': 900, '1h': 3600 }
export const AGG_SUFFIX: Record<AggName, string> = { avg: 'Avg', min: 'Min', max: 'Max', sum: 'Sum' }
export const OP_JS: Record<CompareOp, string> = { gt: '>', lt: '<', gte: '>=', lte: '<=', eq: '==', ne: '!=' }

/** 多级归档:5 分钟 → 小时 → 日,各级独立保留期 */
export const CASCADE_LEVELS = [
  { id: '5m', seconds: 300, ttl: 7 * 86400 },
  { id: '1h', seconds: 3600, ttl: 90 * 86400 },
  { id: '1d', seconds: 86400, ttl: 0 },
] as const

/** 租户档案 maxArgumentsPerCF */
export const MAX_CF_ARGS = 10
/** 4 个分组 CF × 10 参数(单实体 CF 上限 5 = 4 分组 + 1 汇总) */
export const MAX_AGG_MEMBERS = 40

export const AGG_ASSET_TYPE = 'tbsite-agg'
export const SITE_ASSET_TYPE = 'tbsite'

export const chainNames = {
  rollup: (site: string) => `Site Rollups · ${site}`,
  alarm: (site: string) => `Site Alarms · ${site}`,
  revenue: (site: string) => `Site Revenue · ${site}`,
  /** Root 链上每站点独立的转发节点名,多站点互不覆盖 */
  rootFlow: (site: string) => `site alarms flow · ${site}`,
}

export const isCfTemplate = (t: string | undefined) => !!t && (t.startsWith('expr.') || t.startsWith('formula.'))

/**
 * TB 表示「未分配 Customer」用的占位 UUID。**它是个非空字符串**,直接拿 `customerId.id`
 * 做真值判断会把「未分配」当成一个真实客户,再去 `POST /api/customer/<它>/asset/…` 只会拿到
 * `404 Customer ... is not found`(2026-09-08 在镜像上实测,审查 R5)。凡是读 customerId 都要先过这里。
 */
export const NULL_UUID = '13814000-1dd2-11b2-8080-808080808080'

/** 读 TB 返回的 customerId:未分配(缺失或占位 UUID)一律归一成 null */
export const customerIdOf = (e: { customerId?: { id?: string } | null } | null | undefined): string | null => {
  const id = e?.customerId?.id
  return id && id !== NULL_UUID ? id : null
}
