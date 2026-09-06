/**
 * 页面发布器(T3.7)——薄壳。实现放在 @grid/tbsite-compiler 的 src/page/publish-page.ts(Node / 浏览器通用,
 * CLI `tbsite page` 与编辑器共用)。改逻辑请去那里,不要在这里加代码。
 */
export {
  publishPage,
  resolvePageEntities,
  readPageState,
  listSitePages,
  detectDrift,
  pageNameOf,
  SCADA_PAGE_TYPE,
  HISTORY_MAX,
  type PageStep,
  type PageStepReport,
  type PublishPageResult,
  type PublishedRecord,
  type DriftItem,
  type HistoryEntry,
  type UnresolvedRef,
} from '@grid/tbsite-compiler'
