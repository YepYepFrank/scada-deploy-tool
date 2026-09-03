// 前端布局模板 — 向导(组态编辑)与站点视图(实际渲染)共享的唯一定义。
// stats: 指标槽位(数字卡/告警状态卡/仪表盘);grid: 图表槽位,span 为占列数(共 2 列)。
// triple: 三栏监控屏专用结构(左右侧栏 + 中间主视区);main 为预留区,不可配置。
// 告警横幅区是每个模板自带的,自动显示所有触发中的告警,无需配置。

export const LAYOUT_TEMPLATES = {
  console: {
    name: '态势总览台',
    desc: '四个指标位 + 双列四图,适合站点全景监控',
    stats: ['s1', 's2', 's3', 's4'],
    grid: [
      { id: 'g1', span: 1 },
      { id: 'g2', span: 1 },
      { id: 'g3', span: 1 },
      { id: 'g4', span: 1 },
    ],
  },
  monitor3: {
    name: '三栏监控屏',
    desc: '左右各三块面板 + 中间主视区(预留)与双图,复刻生产单站大屏结构',
    stats: [],
    // 全部按图表位处理;渲染时按 triple 分栏
    grid: [
      { id: 'l1', span: 1 }, { id: 'l2', span: 1 }, { id: 'l3', span: 1 },
      { id: 'c1', span: 1 }, { id: 'c2', span: 1 },
      { id: 'r1', span: 1 }, { id: 'r2', span: 1 }, { id: 'r3', span: 1 },
    ],
    triple: {
      left: ['l1', 'l2', 'l3'],
      center: ['c1', 'c2'], // 主视区下方双图
      right: ['r1', 'r2', 'r3'],
      reservedLabel: '主视区 · 预留(后续接入系统图/地图)',
    },
  },
  // 旧「重点监控屏」:已被三栏监控屏取代,向导不再提供,但历史配置仍可渲染
  focus: {
    name: '重点监控屏',
    desc: '三个指标位 + 一张通栏主图 + 两张半宽副图(旧模板)',
    legacy: true,
    stats: ['s1', 's2', 's3'],
    grid: [
      { id: 'g1', span: 2 },
      { id: 'g2', span: 1 },
      { id: 'g3', span: 1 },
    ],
  },
}

// 槽位可选的展示形式
export const STAT_SLOT_CARDS = [
  { id: 'stat', label: '数字卡片' },
  { id: 'gauge', label: '仪表盘(占比)' },
  { id: 'alarm', label: '告警状态卡' },
]
export const GRID_SLOT_CARDS = [
  { id: 'line', label: '折线图' },
  { id: 'bar', label: '柱状图' },
  { id: 'multi', label: '多序列折线(可加测点)' },
  { id: 'combo', label: '双轴组合图(主+副轴)' },
  { id: 'overview', label: '多指标概览卡' },
  { id: 'gauge', label: '仪表盘(占比)' },
  { id: 'alarmlist', label: '告警滚动列表' },
  { id: 'map', label: '地图轨迹' },
]
