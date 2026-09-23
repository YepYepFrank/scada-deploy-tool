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
 * 2026-09-20 修订(全部可选新增,v 仍为 1):节点 `scale` / `online`、母线 `width` / `color`、
 * 标签 `bold` 与新的 `status` 标签(在线灯 + 文字)、母线搭母线视为连通(topology.busesTouch)。
 * 2026-09-21 修订(可选新增):节点 / 母线的叠放层次 `z`。
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
  /**
   * 没数据 / 数据过期 / 值映射不上时按什么画(2026-09-22)。缺省 `'unknown'`(虚线),
   * 但现场很多回路只有电流没有位置信号,整张图全是虚线、还因「不确定」传不了带电色;
   * 这时把它设成 `'closed'`,没数据就按合闸画(带电照常传过去),有数据仍以数据为准。
   */
  fallback?: SldSwitchState
}

/**
 * 在线状态来源(2026-09-20):测点值为真(true / 'true' / 1 / '1')= 在线,为假 = 离线,没数据 = 未知(灰)。
 * 一般绑设备的服务端属性 `active`。**不判数据过期**——`active` 三天没变不代表数据旧了,它只在上下线时才变。
 */
export interface SldOnlineRef {
  pt: string
  /** 状态灯挂在图元包围盒的哪个角,缺省右上(tr) */
  at?: 'tl' | 'tr' | 'bl' | 'br'
}

/** 在线灯的三态 */
export type SldOnlineState = 'online' | 'offline' | 'unknown'

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
  /**
   * 放大倍数,缺省 1。图元整体(含线宽、图元内文字)等比放大,端口跟着走。
   * 只许取「放大后包围盒与全部端口仍落栅格」的值(见 geometry.validNodeScales),否则连线对不上栅格。
   */
  scale?: number
  /**
   * 自定义描边色(2026-09-22,`#rgb` / `#rrggbb`):盖过电压等级色,**失电时照样变灰**(与母线 color 同一套规矩)。
   * 不设则沿用带电着色 / 主题强调色。
   */
  color?: string
  /**
   * 自由宽高(2026-09-22):**只对 `freeBody` 图元(设备框)有效**,给了就以它为准、忽略 `scale`。
   * 图元局部坐标(未旋转),必须是 `geometry.freeSizeStep()` 的整数倍——否则端口离开栅格,连线就对不齐。
   */
  size?: { w: number; h: number }
  /** 边框线宽(2026-09-23,只对 `freeBody` 图元 / 设备框有效),缺省 2 */
  lineWidth?: number
  /** 虚线边框(2026-09-23,只对 `freeBody` 图元 / 设备框有效) */
  dashed?: boolean
  /** 在线 / 离线状态灯;不配不画 */
  online?: SldOnlineRef
  /** 叠放层次,缺省 0;见 SldBus.z 的说明 */
  z?: number
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
  /** 线宽(像素),缺省 4(SLD_BUS_WIDTH) */
  width?: number
  /** 自定义颜色:带电 / 不着色时用它(盖过电压等级色);失电仍然变灰,否则带电着色就没意义了 */
  color?: string
  /**
   * 叠放层次(2026-09-21),缺省 0。图元与母线放在一起排序:**先比 z,z 相同再按「母线 < 连线 < 图元」,再按数组顺序**;
   * 大的盖住小的。所以缺省(全是 0)就是原来的样子——图元压着连线、连线压着母线;把某个图元设成 −1 它就垫到母线底下,
   * 把某条母线设成 1 它就浮到图元上面。分组框永远在最底、标签永远在最上,不参与。
   */
  z?: number
}

/** 母线缺省线宽 */
export const SLD_BUS_WIDTH = 4

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
      bold?: boolean
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
      /**
       * 数值列的起点(2026-09-22,相对标签 x 的像素偏移):给了就按三列画——前缀左对齐、数值**右对齐**到这里、
       * 单位跟在数值后面左对齐。一组标签设同一个值,数字就排成一列(「Uab 388.7 V」与「P 0.4 kW」对得齐)。
       * 不给则照旧「前缀 数值 单位」直接拼接。
       */
      colW?: number
      /**
       * 显示样式(2026-09-23):`meter` = 数码框(黑底七段数码管、数字右对齐,前缀在框左、单位在框右),
       * `plain` = 纯文字。不设随组件的 `valueStyle`(缺省数码框)。
       */
      look?: SldValueLook
      /** 数码框的位数(不含小数点,1–12),缺省 5;值更长时框向左加宽 */
      cells?: number
      format?: SldValueFormat
      size?: number
      color?: SldLabelColor
      bold?: boolean
    }
  | {
      id: string
      x: number
      y: number
      attach?: string
      /** 状态标签(2026-09-20):一颗在线灯 + 文字,用来标整个站点(或任何一路通讯)在线 / 离线 */
      kind: 'status'
      /** 在线状态测点,语义同 SldOnlineRef.pt */
      pt: string
      /** 灯后面的文字,如「站点」;后面自动跟「在线 / 离线 / 未知」 */
      title?: string
      size?: number
      color?: SldLabelColor
      bold?: boolean
    }

/** 分组框:虚线矩形 + 标题(柜体 / 系统分区,如「LP3」「储能系统」);纯装饰,不参与连通与带电计算 */
export interface SldFrame {
  id: string
  x: number
  y: number
  w: number
  h: number
  title?: string
  /** 边框颜色(2026-09-22,`#rgb` / `#rrggbb`);不设则随主题(淡蓝) */
  color?: string
  /** 边框粗细(2026-09-22),缺省 1 */
  width?: number
  /** 实线边框(2026-09-22);缺省虚线 */
  solid?: boolean
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

/** 设备框这类图元重画时的线条样式(2026-09-23) */
export interface SldFreeBodyStyle {
  /** 线宽,缺省 2 */
  width?: number
  dashed?: boolean
}

/**
 * 开关的画法(2026-09-23):
 * - `state`(缺省):合闸红色、分闸绿色、通信异常灰色;断路器类画实心方块,刀闸类只给动触头上色;
 * - `classic`:国标图形 + 带电着色(0.10.0 及以前的样子)。
 */
export type SldSwitchStyle = 'state' | 'classic'

/**
 * 数值标签的显示样式(2026-09-23):
 * - `meter`(组件缺省):数码框,位数相同的数值小数点对成一列;
 * - `plain`:纯文字「前缀 数值 单位」(0.11.0 及以前的样子)。
 */
export type SldValueLook = 'meter' | 'plain'

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
  /**
   * 可自由改宽高的矩形类图元(2026-09-22,设备框):给了这个函数就按**实际宽高重画**图形,
   * 而不是把 `body` 拉伸——拉伸会把线宽也拉扁(横 3 倍宽的框,竖边 6px、横边 2px)。
   * 端口坐标仍按 w / h 的比例缩放(边中点还是边中点),所以端口逻辑不用另写一套。
   */
  freeBody?: (w: number, h: number, style?: SldFreeBodyStyle) => string
  /**
   * 开关的「状态色」画法(2026-09-23,现场要求合闸红色实心 / 分闸绿色实心 / 灰色 = 通信异常):
   * 断路器类给了这个,状态色模式下改画 `body`(只剩引线等不动的部分)+ 一块实心方块 `block`,方块按状态上色;
   * 没给的开关(隔离刀、接地刀)保持刀闸形状,只把动触头(stateBody)按状态上色。
   */
  stateBlock?: { body: string; x: number; y: number; w: number; h: number }
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
  /** state = 节点开关状态;label = 数值 / 状态标签;online = 节点在线灯 */
  from: 'state' | 'label' | 'online'
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
    | 'bad-scale'
    | 'bad-size'
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
