// 运算模板库 — 现场人员只挑模板、填参数,内部实现由编译器负责。
// 与编译器 (tb-compiler/tbsite_compile.py) 共享的契约:template id + params 形状。

export const WINDOWS = [
  { id: '5m', label: '5 分钟', seconds: 300 },
  { id: '15m', label: '15 分钟', seconds: 900 },
  { id: '1h', label: '1 小时', seconds: 3600 },
]

// 模板分类 — 供部署人员按业务场景查找
export const CATEGORIES = {
  elec:   { name: '电气运算', desc: '实时派生:由现有测点即时算出新测点' },
  energy: { name: '电量统计', desc: '周期统计:定时汇总并落库为历史数据' },
  alarm:  { name: '告警监视', desc: '越限/状态监视:自动产生与清除平台告警' },
  site:   { name: '全站汇聚', desc: '跨设备汇总:同名测点求和/平均,结果存入独立虚拟资产(如 全站总有功功率)' },
}

export const TEMPLATES = {
  'expr.add': {
    name: '两量相加',
    kind: 'cf',
    category: 'elec',
    desc: 'A + B,输出为新测点。两个输入可以来自不同设备。',
    params: [
      { id: 'a', label: '输入 A', type: 'key' },
      { id: 'b', label: '输入 B', type: 'key' },
    ],
    needsOutput: true,
  },
  'expr.subtract': {
    name: '两量相减',
    kind: 'cf',
    category: 'elec',
    desc: 'A − B。典型用途:净功率 = 负载 − 光伏。',
    params: [
      { id: 'a', label: '被减数 A', type: 'key' },
      { id: 'b', label: '减数 B', type: 'key' },
    ],
    needsOutput: true,
  },
  'expr.custom': {
    name: '自定义四则运算',
    kind: 'cf',
    category: 'elec',
    custom: true,
    desc: '多个测点/常数的连续加减乘除,按从左到右依次计算(如 A + B + C ÷ 3 表示先求和再除)。测点全部下拉选择,可跨设备;每项可勾选取绝对值。',
    params: [],
    needsOutput: true,
  },
  'window.integrate': {
    name: '功率积分电量',
    kind: 'rollup',
    category: 'energy',
    desc: '对功率测点(W)按时间积分,得到该周期的电量(kWh)。梯形法,自动处理采样间隔。',
    params: [
      { id: 'key', label: '功率测点 (W)', type: 'key' },
      { id: 'window', label: '周期', type: 'window' },
    ],
    needsOutput: true,
  },
  'window.aggregate': {
    name: '周期统计',
    kind: 'rollup',
    category: 'energy',
    desc: '按固定周期计算所选测点的均值 / 最小 / 最大,结果落库为新测点(如 temperatureAvg5m)。',
    params: [
      { id: 'keys', label: '统计测点(可多选)', type: 'keys' },
      { id: 'aggs', label: '统计量', type: 'aggs' },
      { id: 'window', label: '周期', type: 'window' },
    ],
  },
  'alarm.threshold': {
    name: '阈值告警',
    kind: 'alarm',
    category: 'alarm',
    desc: '测点越过阈值时产生平台告警,数值回落自动清除;在「展示配置」里可为它选择横幅或状态卡片等呈现方式。',
    params: [
      { id: 'name', label: '告警名称', type: 'alarmName' },
      { id: 'key', label: '监测测点', type: 'key' },
      { id: 'op', label: '条件', type: 'alarmOp' },
      { id: 'value', label: '阈值', type: 'number' },
      { id: 'severity', label: '级别', type: 'severity' },
      { id: 'trigger', label: '触发模式', type: 'trigger' },
      { id: 'message', label: '告警文案(可用 {value} 代入实时值)', type: 'text' },
    ],
  },
  'aggregate.crossEntity': {
    name: '跨设备汇聚',
    kind: 'agg',
    category: 'site',
    desc: '把一批设备的同名测点实时求和/平均,写入一个独立的虚拟资产测点(对齐平台"实时曲线-*"资产模式)。成员按设备类型/名称前缀圈定,≤40 台。',
    params: [],
    needsOutput: true,
  },
  'revenue.periodic': {
    name: '分时电价收益',
    kind: 'revenue',
    category: 'site',
    desc: '按平台的分时电价配置,周期性统计充/放电量并计算收益(放电收入 − 充电成本),写入虚拟资产。正式使用建议 1 小时周期。简化版,供大屏展示;精确报表仍由归档服务负责。',
    params: [],
    needsOutput: true,
  },
  'window.cascade': {
    name: '多级归档',
    kind: 'rollup',
    cascade: true,
    category: 'energy',
    desc: '一次声明,自动生成 5分钟 → 1小时 → 1天 三级级联统计(逐级汇算),并按级别自动设置保留期(5分钟级保 7 天、小时级保 90 天、天级永久)。注:级别按固定周期滚动,非自然日对齐;自然日/月报表由归档服务负责。',
    params: [],
  },
  'window.delta': {
    name: '区间用量',
    kind: 'rollup',
    category: 'energy',
    desc: '对累计型测点(电量/水量)取周期首尾差,得到"这段时间用了多少"。',
    params: [
      { id: 'key', label: '累计测点', type: 'key' },
      { id: 'window', label: '周期', type: 'window' },
    ],
    needsOutput: true,
  },
}

// 常用方案:一键生成设备模板(选择器 + 条目),现场只需微调阈值
export const PRESETS = [
  {
    id: 'volt', name: '电压越限监控', icon: '⚡',
    desc: '三相电压 Ua/Ub/Uc 越限告警(>250V 警告),缺相的设备自动跳过',
    tplName: '电压越限监控', selector: { profiles: ['IED'], prefixes: [] },
    items: ['Ua', 'Ub', 'Uc'].map((k) => ({
      template: 'alarm.threshold', name: `${k}相电压越限告警`, key: k,
      condition: { op: 'gt', value: 250 }, severity: 'WARNING', trigger: 'level',
      message: `${k}相电压越限:{value} V,请检查`,
    })),
  },
  {
    id: 'power', name: '功率监控统计', icon: '📈',
    desc: '有功功率 P 越限告警(变化才报)+ 多级归档(5分钟/1小时/1天 均值·最大)',
    tplName: '功率监控统计', selector: { profiles: ['IED'], prefixes: [] },
    items: [
      { template: 'alarm.threshold', name: '功率越限告警', key: 'P',
        condition: { op: 'gt', value: 500 }, severity: 'WARNING', trigger: 'edge',
        message: '有功功率越限:{value} kW' },
      { template: 'window.cascade', keys: ['P'], aggs: ['avg', 'max'] },
    ],
  },
  {
    id: 'com', name: '通讯异常告警', icon: '📡',
    desc: '通讯状态 COM ≠ 1 时告警(变化才报,恢复自动清除)',
    tplName: '通讯异常告警', selector: { profiles: ['IED'], prefixes: [] },
    items: [
      { template: 'alarm.threshold', name: '通讯异常告警', key: 'COM',
        condition: { op: 'ne', value: 1 }, severity: 'CRITICAL', trigger: 'edge',
        message: '设备通讯异常,请检查链路' },
    ],
  },
  {
    id: 'cb', name: '开关变位提醒', icon: '🔀',
    desc: '断路器 CB 分合变位时提醒一次(变化才报,不刷屏)',
    tplName: '开关变位提醒', selector: { profiles: ['IED'], prefixes: [] },
    items: [
      { template: 'alarm.threshold', name: '开关变位提醒', key: 'CB',
        condition: { op: 'eq', value: 1 }, severity: 'MINOR', trigger: 'edge',
        message: '开关合闸(CB={value})' },
    ],
  },
]

export const ALARM_TRIGGERS = [
  { id: 'level', label: '持续(条件满足期间保持告警)' },
  { id: 'edge', label: '变化才报(状态翻转时才产生/清除)' },
]

export const ALARM_OPS = [
  { id: 'gt', label: '大于' },
  { id: 'lt', label: '小于' },
  { id: 'gte', label: '大于等于' },
  { id: 'lte', label: '小于等于' },
  { id: 'eq', label: '等于(开关量)' },
  { id: 'ne', label: '不等于(开关量)' },
]

export const ALARM_SEVERITIES = [
  { id: 'WARNING', label: '警告' },
  { id: 'MINOR', label: '提示' },
  { id: 'CRITICAL', label: '严重' },
]

export const AGG_OPTIONS = [
  { id: 'avg', label: '均值' },
  { id: 'min', label: '最小' },
  { id: 'max', label: '最大' },
  { id: 'sum', label: '求和' },
]

// 多级归档的固定级联与分级保留(秒;0=永久)
export const CASCADE_LEVELS = [
  { id: '5m', label: '5 分钟', seconds: 300, ttl: 7 * 86400 },
  { id: '1h', label: '1 小时', seconds: 3600, ttl: 90 * 86400 },
  { id: '1d', label: '1 天', seconds: 86400, ttl: 0 },
]

export const ALARM_CARD_TYPES = [
  { id: 'banner', label: '告警横幅(触发时置顶)' },
  { id: 'badge', label: '状态卡片(常驻,正常/告警)' },
  { id: 'none', label: '不展示' },
]

export const CARD_TYPES = [
  { id: 'stat', label: '数字卡片' },
  { id: 'line', label: '折线图' },
  { id: 'bar', label: '柱状图' },
  { id: 'badge', label: '状态徽章' },
  { id: 'map', label: '地图轨迹' },
  { id: 'none', label: '不展示' },
]
