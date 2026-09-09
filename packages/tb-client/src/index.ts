// @grid/tb-client 公共入口。T0.2 导出契约类型;LegacyDataSource 曾是 T1.1 预案,2026-09-09 起转为
// **部署工具自用的数据源,长期保留**(不再计划删除,原因见 docs/联调记录/数据源归属-2026-09-09.md)。
export type {
  EntityRef,
  TsPoint,
  TsUpdate,
  AttrUpdate,
  AttributeScope,
  AlarmInfo,
  Aggregation,
  WindowLiteral,
  ConnectionStatus,
  Unsubscribe,
  DataSource,
  ExtQuery,
  ExtInterval,
  ExtResult,
} from './data-source'
export { parseWindow } from './data-source'
export {
  LegacyDataSource,
  normalizeValue,
  HISTORY_BUCKETS,
  KZ_BUCKETS,
  KZ_AGGS,
  defaultKzInterval,
  type LegacyDataSourceOptions,
} from './legacy-adapter'
