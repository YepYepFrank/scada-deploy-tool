// T3.1 迁移函数在向导里的入口:实现放在 @grid/tbsite-compiler(纯函数、Node / 浏览器通用、有单测),
// 这里只做转发,向导「从既有站点导入」时调用 migrateSiteConfig(siteConfig, ids)。
export {
  migrateSiteConfig,
  legacyHistoryWindow,
  type LegacySiteConfig,
  type EntityIds,
  type MigrationResult,
  type MigrationNote,
  type MigratedPage,
} from '@grid/tbsite-compiler'
