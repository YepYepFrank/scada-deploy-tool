/**
 * 一次接线图(SLD)文档模型 —— ADR-005。
 *
 * 纯数据 + 纯类型:不依赖 Vue、不依赖 X6。运行时组件(widgets/sld)、部署工具的接线图编辑器、工具侧校验共用这一份。
 *
 * 三条硬约定:
 * 1. 图存在 `sld` 组件的 `props.doc`;测点绑定**不在图里**,在 `WidgetConfig.bindings['pt.<pointId>']`(动态槽位),
 *    图里只存对 pointId 的引用 → 编译器按名解析 id、工具的 key 存在性检查都自动覆盖。
 * 2. 图里的实体只存 `{ type, name }`,不存 id(ADR-002:按名存、按 id 发;发布器不解析 props)。
 * 3. 图元只用 `currentColor` 上色,颜色由运行时按带电 / 电压等级 / 告警决定。
 *
 * 本文件在一个波次内只读;要改先回主会话。
 *
 * 2026-09-18 修订(T5.0 收尾,ADR-005「契约修订」):节点坐标语义、栅格固定 10、母线接点改整数距离 d、
 * 图元文字保持正向、标签颜色与枚举文字、分组框 frames。
 */

/** 栅格:v1 固定 10(图元按 10 画;doc.canvas.grid 保留字段但必须等于它,validateSldDoc 会报) */
export const SLD_GRID = 10

/** 文档版本;破坏性变更时 +1,并在 migrateSldDoc 里补迁移。 */
export const SLD_DOC_VERSION = 1 as const

/** 节点 / 母线 / 连线 / 标签 / 测点的 id 字符集(绑定路径用 `/` 分段,所以不许有 `/`;`.` 留给槽位前缀)。 */
export const SLD_ID_PATTERN = /^[A-Za-z0-9_-]+$/

/** 测点动态槽位前缀:`bindings['pt.' + pointId]` */
export const SLD_POINT_SLOT_PREFIX = 'pt.'
/** 告警静态槽位名(绑站点资产,靠告警上卷;组件内按 originator 匹配节点) */
export const SLD_ALARMS_SLOT = 'alarms'

export const sldPointSlot = (pointId: string): string => SLD_POINT_SLOT_PREFIX + pointId

export type SldRotation = 0 | 90 | 180 | 270

/** 图里的实体引用:只有类型与名称(约定 2)。 */
export interface SldEntityName {
  type: 'DEVICE' | 'ASSET'
  name: string
}

/** 开关状态。值映射不上 / 没数据 / 数据过期一律 unknown。 */
export type SldSwitchState = 'open' | 'closed' | 'unknown'

/** 节点状态来源:测点值(转成字符串)→ 分 / 合;映射不上为 unknown。例:`{ pt: 'p1', map: { '1': 'closed', '0': 'open' } }` */
export interface SldStateRef {
  pt: string
  map: Record<string, 'open' | 'closed'>
}

export interface SldNode {
  id: string
  /** 图元 id,在图元注册表里查 */
  symbol: string
  /** **旋转 / 镜像之后**画面上看到的包围盒左上角,画布坐标,落在栅格上(旋转不会让节点离开栅格,见 geometry.nodeBox) */
  x: number
  y: number
  rot: SldRotation
  /** 水平镜像(先镜像、后绕包围盒中心旋转) */
  flip?: boolean
  /** 显示名(如「1# 进线柜」) */
  name?: string
  entity?: SldEntityName
  /** conduct = 'switch' 的图元用;**没配 state 视为常合**(resolveSwitchState(undefined) = 'closed',energize 同) */
  state?: SldStateRef
  /** 电源点:带电计算的起点;kv 为该点电压等级(着色用) */
  source?: { kv?: number }
  /** conduct = 'transformer' 的图元用:各端口侧的电压等级,如 `{ hv: 10, lv: 0.4 }` */
  portKv?: Record<string, number>
}

/** 母线:水平或垂直的一段粗线,线上任意栅格位置可接线。约定 (x1,y1) 是左端 / 上端。 */
export interface SldBus {
  id: string
  x1: number
  y1: number
  x2: number
  y2: number
  name?: string
  /** 电压等级;给了就以它为准着色,不给则继承带电计算传来的等级 */
  kv?: number
}

/**
 * 连线端点:接在节点端口上,或接在母线上距 (x1,y1) 为 d 的位置(像素,栅格整数倍,0 ≤ d ≤ 母线长)。
 * 用整数距离而不是比例:接点恒落栅格、没有浮点漂移;母线从 (x2,y2) 端拉伸时接点不动,
 * 从 (x1,y1) 端拉伸时由编辑器给该母线上的 d 统一加减位移(保持画面位置)。
 */
export type SldWireEnd = { node: string; port: string } | { bus: string; d: number }

export interface SldWire {
  id: string
  from: SldWireEnd
  to: SldWireEnd
  /** 中间拐点(画布坐标);缺省由 wirePoints 按端口朝向给出正交折线 */
  vertices?: Array<[number, number]>
}

export interface SldValueFormat {
  digits?: number
  unit?: string
  /** 显示值 = 原值 × scale */
  scale?: number
  /** 枚举文字:值按 String() 命中就显示对应文字(如 `{ '0': '停止', '1': '制冷' }`),命中后不再套 digits / unit */
  map?: Record<string, string>
}

/** 标签颜色:缺省随主题;相色约定 a 黄 / b 绿 / c 红(现有一次图的习惯),也可直接给颜色值 */
export type SldLabelColor = 'a' | 'b' | 'c' | string

export type SldLabel =
  | {
      id: string
      x: number
      y: number
      attach?: string
      kind: 'text'
      text: string
      size?: number
      color?: SldLabelColor
    }
  | {
      id: string
      x: number
      y: number
      /** 依附的节点 id:节点移动 / 复制间隔时跟随 */
      attach?: string
      kind: 'value'
      pt: string
      /** 前缀文字,如「P」「Ia」 */
      title?: string
      format?: SldValueFormat
      size?: number
      color?: SldLabelColor
    }

/** 分组框:虚线矩形 + 标题(柜体 / 系统分区,如「LP3」「储能系统」);纯装饰,不参与连通与带电计算 */
export interface SldFrame {
  id: string
  x: number
  y: number
  w: number
  h: number
  title?: string
}

export interface SldDoc {
  v: typeof SLD_DOC_VERSION
  canvas: { w: number; h: number; grid: number }
  /** 描摹底图:只存项目文件,发布前由工具剥掉(ADR-005 D10) */
  background?: { src: string; opacity: number; x?: number; y?: number; w?: number; h?: number }
  nodes: SldNode[]
  buses: SldBus[]
  wires: SldWire[]
  labels: SldLabel[]
  /** 可选:旧图没有这个字段 */
  frames?: SldFrame[]
}

/* ───────────── 图元定义 ───────────── */

export type SldPortDir = 'n' | 's' | 'e' | 'w'

export interface SldPort {
  id: string
  /** 图元局部坐标(未旋转、未镜像,原点 = 包围盒左上角);必须落在栅格上 */
  x: number
  y: number
  /** 出线朝向(未旋转时) */
  dir: SldPortDir
}

/**
 * 导通方式(带电计算用):
 * - always:各端口常通(CT、熔断器、电缆头、串在回路里的电表)
 * - switch:合位才通(断路器、隔离刀、负荷开关、手车)
 * - transformer:带电能传过去,电压等级换成 node.portKv[对侧端口]
 * - none:不传(负荷、PT、避雷器、电源等终端图元)
 */
export type SldConduct = 'always' | 'switch' | 'transformer' | 'none'

export type SldSymbolCategory =
  'switch' | 'transformer' | 'measure' | 'source' | 'load' | 'storage' | 'protect' | 'connect'

/** 图元里的文字(如电表的「Wh」):位置跟着图元镜像 / 旋转,**字形保持正向**,所以不写进 body */
export interface SldSymbolText {
  /** 文字中心,图元局部坐标 */
  x: number
  y: number
  text: string
  size?: number
}

export interface SldSymbolDefinition {
  id: string
  name: string
  category: SldSymbolCategory
  /** 包围盒,栅格的整数倍 */
  w: number
  h: number
  ports: SldPort[]
  conduct: SldConduct
  /** 拖进画布时默认标为电源点(电网电源、发电机、光伏…) */
  defaultSource?: boolean
  /** SVG 片段(不含外层 <svg> / <g>),局部坐标;只用 currentColor(约定 3);**不放文字**(文字写 texts) */
  body: string
  texts?: SldSymbolText[]
  /** 随开关状态追加的片段(如刀闸的动触头);conduct = 'switch' 的图元必须三态齐全 */
  stateBody?: Record<SldSwitchState, string>
  /**
   * 数值标签的默认落点,从设备树拖入时依次使用。图元局部坐标(rot = 0、未镜像时相对包围盒左上角),
   * 落点按与端口相同的规则变换;标签文字本身不旋转,左对齐、垂直居中。
   */
  labelSlots?: Array<{ dx: number; dy: number }>
}

/* ───────────── 运行时 / 计算结果 ───────────── */

/** 动态槽位 `pt.*` 的值:带数据时间戳(过期变灰按它判,不按到达时间)。 */
export interface SldPointValue {
  v: unknown
  ts: number
}

export interface SldPoint {
  x: number
  y: number
}

/** doc 里对测点的一处引用 */
export interface SldPointRef {
  pt: string
  from: 'state' | 'label'
  /** 节点 id(state)或标签 id(label) */
  owner: string
}

export interface SldEnergy {
  live: boolean
  kv?: number
  /** 路径上有 unknown 状态的开关(按断开算,但提示不确定) */
  uncertain?: boolean
}

export interface SldEnergizeResult {
  nodes: Record<string, SldEnergy>
  buses: Record<string, SldEnergy>
  wires: Record<string, SldEnergy>
}

export interface SldIssue {
  level: 'error' | 'warning'
  /** 如 `nodes/n3`、`wires/w7/from` */
  path: string
  code:
    | 'bad-id'
    | 'duplicate-id'
    | 'unknown-symbol'
    | 'unknown-port'
    | 'dangling-wire'
    | 'off-grid'
    | 'bus-not-axis-aligned'
    | 'missing-state'
    | 'unknown-point-owner'
    | 'no-source'
    | 'bad-version'
    | 'bad-grid'
    | 'bus-end-out-of-range'
  message: string
}

/** 按 id 取图元定义;model 层不直接依赖图元注册表,便于单测注入 */
export type SldSymbolLookup = (symbolId: string) => SldSymbolDefinition | undefined

/** 一批图上元素的 id(选择集 / 复制间隔的输入) */
export interface SldSelection {
  nodes: string[]
  buses: string[]
  wires: string[]
  labels: string[]
  frames?: string[]
}
