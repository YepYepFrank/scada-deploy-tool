// @grid/tb-client 公共入口。T0.2 导出契约类型;LegacyDataSource 是 T1.1 预案(同事的 TbClient 到位后删除)。
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
  defaultKzInterval,
  type LegacyDataSourceOptions,
} from './legacy-adapter'
