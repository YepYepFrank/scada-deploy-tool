// @grid/tb-client 公共入口。T0.2 只导出契约类型;TbClient 实现随 T1.1 加入。
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
} from './data-source'
export { parseWindow } from './data-source'
