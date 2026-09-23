/**
 * /dev 展示页的样例一次接线图(monitor-3col 的 main 槽位):
 * 两路 10 kV 进线 → 10 kV I / II 段母线(母联常开)→ 两台主变 10 / 0.4 kV → 0.4 kV 母线 → 6 条出线 + 光伏 + 储能。
 * 全部用真实图元 id;测点绑定走 `pt.<id>`,key 与 pointId 同名,随机数据由 sldMockValue 按 key 前缀给。
 */
import type { SldDoc, SldLabel, SldNode, SldWire, SldValueFormat, SldEntityName } from '../src/sld'
import type { EntityRef } from '@grid/tb-client'
import type { WidgetConfig } from '../src/schema/page-config'

const nodes: SldNode[] = []
const wires: SldWire[] = []
const labels: SldLabel[] = []
const points: string[] = []

const CB = { '1': 'closed', '0': 'open' } as const
const dev = (name: string): SldEntityName => ({ type: 'DEVICE', name })
/** 开关节点:state 测点 `SW_<id>` */
function sw(id: string, symbol: string, x: number, y: number, name?: string, entity?: string, rot: 0 | 90 = 0) {
  const pt = `SW_${id}`
  points.push(pt)
  nodes.push({
    id,
    symbol,
    x,
    y,
    rot,
    ...(name ? { name } : {}),
    ...(entity ? { entity: dev(entity) } : {}),
    state: { pt, map: { ...CB } },
  })
}
const node = (n: SldNode) => nodes.push(n)
const wire = (id: string, from: SldWire['from'], to: SldWire['to']) => wires.push({ id, from, to })
const port = (node: string, p = 'a') => ({ node, port: p })
const bus = (b: string, d: number) => ({ bus: b, d })
/** 数值标签:测点 id = key */
function val(pt: string, x: number, y: number, title: string, format: SldValueFormat, color?: string, attach?: string) {
  points.push(pt)
  labels.push({
    id: `l_${pt}`,
    x,
    y,
    kind: 'value',
    pt,
    title,
    format,
    ...(color ? { color } : {}),
    ...(attach ? { attach } : {}),
  })
}
const text = (id: string, x: number, y: number, t: string, size = 12) =>
  labels.push({ id, x, y, kind: 'text', text: t, size })

/* ── 10 kV:两路进线 ── */
for (const [k, x, entity] of [
  ['1', 150, 'PDR1_IN1_IED1'],
  ['2', 850, 'PDR1_IN2_IED1'],
] as const) {
  node({ id: `in${k}`, symbol: 'incoming-arrow', x: x - 10, y: 20, rot: 0, name: `${k}# 进线`, source: { kv: 10 } })
  sw(`qf_in${k}`, 'breaker', x - 20, 60, undefined, entity)
  wire(`w_in${k}`, port(`in${k}`), port(`qf_in${k}`))
  val(`Uab_in${k}`, x + 30, 70, 'Uab', { digits: 2, unit: 'kV' }, 'a')
  val(`Ubc_in${k}`, x + 30, 86, 'Ubc', { digits: 2, unit: 'kV' }, 'b')
  val(`Uca_in${k}`, x + 30, 102, 'Uca', { digits: 2, unit: 'kV' }, 'c')
}
wire('w_in1_bus', port('qf_in1', 'b'), bus('b10a', 90))
wire('w_in2_bus', port('qf_in2', 'b'), bus('b10b', 230))

/* 母联(横放,常开) */
sw('qf_tie', 'breaker', 540, 180, '母联', 'PDR1_TIE_IED1', 90)
wire('w_tie_a', bus('b10a', 460), port('qf_tie', 'b'))
wire('w_tie_b', bus('b10b', 0), port('qf_tie', 'a'))

/* ── 两台主变 ── */
for (const [k, x, b, d, entity] of [
  ['1', 300, 'b10a', 240, 'SSP1_GP1_IED1'],
  ['2', 900, 'b10b', 280, 'PDR1_T2_IED1'],
] as const) {
  sw(`qf_t${k}`, 'breaker', x - 20, 190, undefined, entity)
  wire(`w_t${k}_hv`, bus(b, d), port(`qf_t${k}`))
  node({
    id: `t${k}`,
    symbol: 'transformer-2w',
    x: x - 20,
    y: 270,
    rot: 0,
    name: `${k}# 主变 315kVA`,
    entity: dev(`PDR1_T${k}`),
    portKv: { hv: 10, lv: 0.4 },
  })
  wire(`w_t${k}_a`, port(`qf_t${k}`, 'b'), port(`t${k}`, 'hv'))
  sw(`qf_lv${k}`, 'breaker', x - 20, 370)
  // 2026-09-22:这两台没有位置信号(测点一直没值),配成「没数据按合闸画」,不然整段画成虚线、带电色也传不下去
  nodes[nodes.length - 1]!.state!.fallback = 'closed'
  wire(`w_t${k}_lv`, port(`t${k}`, 'lv'), port(`qf_lv${k}`))
  wire(`w_lv${k}_bus`, port(`qf_lv${k}`, 'b'), bus('b04', x - 60))
  // 主变的名称画在右侧(下方有出线),数值放左侧
  val(`P_t${k}`, x - 110, 294, 'P', { digits: 1, unit: 'kW' }, undefined, `t${k}`)
  val(`Q_t${k}`, x - 110, 310, 'Q', { digits: 1, unit: 'kvar' }, undefined, `t${k}`)
}

/* ── 0.4 kV 出线 ×6 ── */
const FEEDERS = ['办公照明', '通讯机组', 'UPS', '本所空调', '路灯', '备用']
FEEDERS.forEach((name, i) => {
  const x = [90, 170, 370, 460, 650, 740][i]!
  const id = `f${i + 1}`
  sw(`qf_${id}`, 'switch-simple', x - 10, 470, undefined, i === 2 ? 'PDR4_LP1_ATS1' : `PDR4_LP3_${id.toUpperCase()}`)
  node({ id: `arr_${id}`, symbol: 'feeder-arrow', x: x - 10, y: 530, rot: 0, name })
  wire(`w_${id}_a`, bus('b04', x - 60), port(`qf_${id}`))
  wire(`w_${id}_b`, port(`qf_${id}`, 'b'), port(`arr_${id}`))
  val(`P_${id}`, x + 12, 490, 'P', { digits: 1, unit: 'kW' }, undefined, `qf_${id}`)
})

/* ── 光伏 ── */
sw('qf_pv', 'breaker', 960, 470, undefined, 'PDR5_PV_IED1')
node({ id: 'inv', symbol: 'inverter', x: 960, y: 550, rot: 0 })
node({ id: 'pv', symbol: 'pv-array', x: 960, y: 630, rot: 0, name: '光伏 300kW', source: { kv: 0.4 } })
wire('w_pv_a', bus('b04', 920), port('qf_pv'))
wire('w_pv_b', port('qf_pv', 'b'), port('inv'))
wire('w_pv_c', port('inv', 'b'), port('pv'))
val('P_pv', 940, 696, 'P', { digits: 1, unit: 'kW' }) // 逆变器右侧放不下,放到光伏名称下面

/* ── 储能 ── */
sw('qf_bess', 'breaker', 1060, 470, undefined, 'PDR6_BESS_IED1')
node({ id: 'pcs', symbol: 'pcs', x: 1060, y: 550, rot: 0 })
node({ id: 'bat', symbol: 'battery', x: 1060, y: 630, rot: 0, name: '储能 BATTERY' })
wire('w_bess_a', bus('b04', 1020), port('qf_bess'))
wire('w_bess_b', port('qf_bess', 'b'), port('pcs'))
wire('w_bess_c', port('pcs', 'b'), port('bat'))
val('P_bess', 1105, 560, 'P', { digits: 1, unit: 'kW' })
val('SOC_bess', 1105, 576, 'SOC', { digits: 0, unit: '%' })
val('RUN_bess', 1105, 592, '状态', { map: { '0': '停止', '1': '充电', '2': '放电' } })

/* 安全检测状态灯 */
const safePt = 'SAFE_1'
points.push(safePt)
node({
  id: 'safe',
  symbol: 'status-light',
  x: 1110,
  y: 690,
  rot: 0,
  state: { pt: safePt, map: { '1': 'closed', '0': 'open' } },
})
text('t_safe', 1030, 700, '安全检测')

text('t_title', 460, 20, '仙人山服务区微电网系统', 16)

// 在线状态(2026-09-20):有设备的节点各挂一盏灯(测点 ON_<节点 id>),左上角一个整站的状态标签
for (const n of nodes) {
  if (!n.entity) continue
  n.online = { pt: `ON_${n.id}` }
  points.push(n.online.pt)
}
points.push('ON_site')
labels.push({ id: 'l_site', x: 60, y: 24, kind: 'status', pt: 'ON_site', title: '站点', size: 14, bold: true })

/* ── 2026-09-22 新增的几样,顺手在样例里各来一个 ──
   设备框自由改宽高 + 框里一组对齐的数值 + 图元自定义色 + 分组框实线彩框 + 开关「没数据按合闸画」。 */
const PROT_X = 560
const PROT_Y = 610
node({
  id: 'prot1',
  symbol: 'device-box',
  x: PROT_X,
  y: PROT_Y,
  rot: 0,
  size: { w: 240, h: 100 },
  color: '#ff9f43',
})
text('t_prot', PROT_X + 14, PROT_Y + 20, '保护', 13)
// 三列对齐:前缀左对齐、数字右对齐到 colW、单位跟其后。故意用长短不一的前缀
;(
  [
    ['Uab', 'V', 1],
    ['P', 'kW', 2],
    ['Q', 'kVar', 3],
  ] as const
).forEach(([title, unit, i]) => {
  const pt = `PROT_${title}`
  points.push(pt)
  labels.push({
    id: `l_${pt}`,
    x: PROT_X + 14,
    y: PROT_Y + 20 + i * 20,
    kind: 'value',
    pt,
    title,
    format: { unit, digits: 1 },
    colW: 120,
    attach: 'prot1',
  })
})

export const SLD_SAMPLE_DOC: SldDoc = {
  v: 1,
  canvas: { w: 1180, h: 730, grid: 10 },
  nodes,
  buses: [
    { id: 'b10a', x1: 60, y1: 150, x2: 520, y2: 150, name: '10kV I 段', kv: 10 },
    { id: 'b10b', x1: 620, y1: 150, x2: 1100, y2: 150, name: '10kV II 段', kv: 10 },
    { id: 'b04', x1: 60, y1: 440, x2: 1100, y2: 440, name: '0.4kV 母线', kv: 0.4 },
  ],
  wires,
  labels,
  frames: [
    { id: 'fr_hv', x: 40, y: 50, w: 1080, h: 180, title: '10kV 开关站' },
    { id: 'fr_lp3', x: 40, y: 455, w: 500, h: 130, title: 'LP3' },
    { id: 'fr_lp4', x: 600, y: 455, w: 220, h: 130, title: 'LP4' },
    { id: 'fr_pv', x: 930, y: 455, w: 90, h: 260, title: '光伏系统' },
    { id: 'fr_bess', x: 1030, y: 455, w: 140, h: 220, title: '储能系统' },
    // 边框颜色 / 粗细 / 实线(2026-09-22)
    { id: 'fr_prot', x: 550, y: 580, w: 260, h: 140, title: '保护柜', color: '#ff9f43', width: 2, solid: true },
  ],
}

/** 给 sld 组件的配置:每个测点一条 ts 绑定(key = pointId),告警绑站点资产 */
export function sldSampleWidget(id: string, slot: string, entity: EntityRef, site: EntityRef): WidgetConfig {
  const bindings: WidgetConfig['bindings'] = { alarms: [{ mode: 'alarm', entity: site }] }
  for (const pt of new Set(points)) bindings[`pt.${pt}`] = { mode: 'ts', entity, key: pt }
  return { id, slot, type: 'sld', props: { doc: SLD_SAMPLE_DOC, staleSeconds: 60 }, bindings }
}

/* ── 随机数据(/dev「随机数据」模式):开关偶尔变位,数值在合理范围跳动 ── */
const switchState = new Map<string, number>()
const jitter = (base: number, span: number) => Math.round((base + (Math.random() - 0.5) * span) * 100) / 100

const offlineKey = (): string | undefined => points.filter(p => p.startsWith('ON_') && p !== 'ON_site')[1]

/** 样例图的 key → 随机值;不认识的 key 返回 undefined(交给 DevApp 原有的随机规则) */
export function sldMockValue(key: string): number | undefined {
  if (key.startsWith('SW_') || key === safePt) {
    // 母联常开、其余常合;每次推送有小概率变位(保持状态,不是每次都随机)
    const normal = key === 'SW_qf_tie' ? 0 : 1
    let s = switchState.get(key) ?? normal
    if (Math.random() < (s === normal ? 0.03 : 0.3)) s = 1 - s
    switchState.set(key, s)
    return s
  }
  // 在线灯:整站与大多数设备在线;挑一台固定离线(看红灯常亮),免得满屏都是绿的看不出区别
  if (key.startsWith('ON_')) return key === offlineKey() ? 0 : 1
  if (/^U(ab|bc|ca)_/.test(key)) return jitter(10.5, 0.2)
  if (key.startsWith('P_t')) return jitter(180, 60)
  if (key.startsWith('Q_t')) return jitter(40, 20)
  if (key.startsWith('P_f')) return jitter(25, 20)
  if (key === 'P_pv') return jitter(210, 80)
  if (key === 'P_bess') return jitter(-50, 100)
  if (key === 'SOC_bess') return Math.round(jitter(68, 4))
  if (key === 'RUN_bess') return Math.floor(Math.random() * 3)
  return undefined
}
