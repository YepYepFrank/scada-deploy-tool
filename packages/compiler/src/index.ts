// @grid/tbsite-compiler 公共入口。
// core/  纯函数:tbsite 配置 → 写入计划(无网络);writer/ 把计划落到 TB(注入 TbApi,可 mock)。
// tbsite_compile.py 已冻结,本包是唯一编译器;向导里的 publisher.js 只是本包的薄壳。
export const version = '0.1.0'

export type * from './types'
export * from './core/constants'
export { AGG_JS, CASCADE_JS, REVENUE_JS } from './core/scripts'
export { matchSelector, itemKeys, expandTemplates } from './core/templates'
export { validateConfig } from './core/validate'
export { tsArg, buildCf } from './core/cf'
export { resolveAggMembers, buildAggCfs } from './core/aggregate'
export { rollupGroups, rollupMetadata } from './core/rollup'
export { alarmMetadata, alarmStateAttr } from './core/alarm'
export { revenueMetadata } from './core/revenue'
export {
  compile,
  expandConfig,
  placeholderIds,
  siteChainNames,
  summarizePlan,
  ConfigError,
  type CompileOptions,
} from './core/plan'
export {
  type TbApi,
  type Reporter,
  type StepId,
  type StepStatus,
  type PublishFailure,
  type RetryScope,
  findDevice,
  resolveDeviceIds,
  findAsset,
  ensureAsset,
  ensureChain,
  listCfs,
} from './writer/api'
export { publish, wireRootChain, type PublishOptions } from './writer/publish'
export { cleanup } from './writer/cleanup'
export {
  publishPage,
  resolvePageEntities,
  collectEntityRefs,
  lookupEntityId,
  readPageState,
  listSitePages,
  detectDrift,
  pageNameOf,
  SCADA_PAGE_TYPE,
  MANAGED_BY,
  HISTORY_MAX,
  NULL_UUID,
  type EntityRefLike,
  type PagePayload,
  type HistoryEntry,
  type PageStep,
  type PageStepReport,
  type UnresolvedRef,
  type PublishPageOptions,
  type PublishPageResult,
  type PublishedRecord,
  type DriftItem,
} from './page/publish-page'
export {
  migrateSiteConfig,
  legacyHistoryWindow,
  type LegacySiteConfig,
  type LegacySlot,
  type LegacyPage,
  type EntityIds,
  type MigrationResult,
  type MigrationNote,
  type MigratedPage,
  type PageConfigLike,
  type WidgetLike,
  type MigrateOptions,
} from './migrate/site-config-to-page-config'
