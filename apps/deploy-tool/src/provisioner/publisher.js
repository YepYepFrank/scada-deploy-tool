// 浏览器内发布器 — 与 tb-compiler/tbsite_compile.py 同一套 TB REST 调用。
// publish(cfg, api, report) 按步骤执行,report(stepId, status, detail) 汇报进度。

const WINDOW_SECONDS = { '5m': 300, '15m': 900, '1h': 3600 }
const AGG_SUFFIX = { avg: 'Avg', min: 'Min', max: 'Max', sum: 'Sum' }
const OP_JS = { gt: '>', lt: '<', gte: '>=', lte: '<=', eq: '==', ne: '!=' }

const AGG_JS = `
var out = {};
var spec = %SPEC%;
function series(key) {
    var raw = metadata[key];
    if (!raw) return [];
    var arr = JSON.parse(raw);
    return arr.map(function (p) { return parseFloat(p.value); })
              .filter(function (v) { return !isNaN(v); });
}
function agg(keys, suffix, fn) {
    keys.forEach(function (k) {
        var v = series(k);
        if (v.length) out[k + suffix] = Math.round(fn(v) * 10000) / 10000;
    });
}
agg(spec.avg, spec.sfx.avg, function (v) { return v.reduce(function (a, b) { return a + b; }, 0) / v.length; });
agg(spec.min, spec.sfx.min, function (v) { return Math.min.apply(null, v); });
agg(spec.max, spec.sfx.max, function (v) { return Math.max.apply(null, v); });
agg(spec.sum || [], spec.sfx.sum, function (v) { return v.reduce(function (a, b) { return a + b; }, 0); });
Object.keys(spec.delta).forEach(function (k) {
    var v = series(k);
    if (v.length > 1) out[spec.delta[k]] = Math.round((v[v.length - 1] - v[0]) * 10000) / 10000;
});
// 功率(W) -> 电量(kWh):梯形积分
Object.keys(spec.integrate || {}).forEach(function (k) {
    var raw = metadata[k];
    if (!raw) return;
    var pts = JSON.parse(raw)
        .map(function (p) { return [parseInt(p.ts), parseFloat(p.value)]; })
        .filter(function (p) { return !isNaN(p[0]) && !isNaN(p[1]); })
        .sort(function (a, b) { return a[0] - b[0]; });
    if (pts.length < 2) return;
    var wh = 0;
    for (var i = 1; i < pts.length; i++) {
        var dtH = (pts[i][0] - pts[i - 1][0]) / 3600000;
        if (dtH > 0) wh += (pts[i][1] + pts[i - 1][1]) / 2 * dtH;
    }
    out[spec.integrate[k]] = Math.round(wh / 1000 * 10000) / 10000;
});
if (Object.keys(out).length === 0) return { msg: msg, metadata: metadata, msgType: msgType };
return { msg: out, metadata: metadata, msgType: 'POST_TELEMETRY_REQUEST' };
`

// ── 设备模板展开(tbsite/v2)────────────────────────────────
// 模板 = 选择器(profiles/prefixes)+ 一组不绑定具体设备的运算项。
// 展开:对每台匹配且具备所需测点的已认领设备实例化;告警项跨设备合并为一条规则(devices 列表)。
export function matchSelector(dev, sel) {
  if (sel.profiles?.length && !sel.profiles.includes(dev.profile || dev.type)) return false
  if (sel.prefixes?.length && !sel.prefixes.some((p) => p && dev.name.startsWith(p))) return false
  return true
}

function itemKeys(item) {
  if (item.template === 'alarm.threshold') return [item.key]
  if (item.template === 'window.aggregate' || item.template === 'window.cascade') return item.keys || []
  if (item.template === 'expr.add' || item.template === 'expr.subtract')
    return Object.values(item.inputs || {}).map((r) => r.key)
  return [item.key]
}

export function expandTemplates(cfg) {
  const out = []
  const notes = []
  for (const t of cfg.deviceTemplates || []) {
    const matched = (cfg.devices || []).filter((d) => matchSelector(d, t.selector || {}))
    if (!matched.length) { notes.push(`模板「${t.name}」没有匹配到任何已认领设备`); continue }
    for (const item of t.items || []) {
      const need = itemKeys(item)
      const capable = matched.filter((d) => need.every((k) => (d.keys || []).some((x) => x.key === k)))
      const skipped = matched.length - capable.length
      if (skipped > 0)
        notes.push(`模板「${t.name}」·「${item.name || item.output || item.key}」:${skipped} 台设备缺少所需测点,已跳过`)
      if (!capable.length) continue
      if (item.template === 'alarm.threshold') {
        out.push({ ...JSON.parse(JSON.stringify(item)),
          device: capable[0].name, devices: capable.map((d) => d.name), _tpl: t.name })
      } else if (item.template === 'expr.add' || item.template === 'expr.subtract') {
        for (const d of capable)
          out.push({ template: item.template, device: d.name, output: item.output, _tpl: t.name,
            inputs: Object.fromEntries(Object.entries(item.inputs).map(([p, r]) => [p, { device: d.name, key: r.key }])) })
      } else {
        for (const d of capable)
          out.push({ ...JSON.parse(JSON.stringify(item)), device: d.name, _tpl: t.name })
      }
    }
  }
  return { computations: out, notes }
}

// ── 跨设备汇聚(aggregate.crossEntity → 资产上的 SIMPLE CF)──────
const MAX_CF_ARGS = 10      // 租户档案 maxArgumentsPerCF
const MAX_AGG_MEMBERS = 40  // 4 个分组 CF × 10 参数(单实体 CF 上限 5 = 4 分组 + 1 汇总)

export function resolveAggMembers(cfg, c) {
  return (cfg.devices || []).filter((d) =>
    matchSelector(d, c.selector || {}) && (d.keys || []).some((x) => x.key === c.key))
}

// 返回该汇聚需要建在目标资产上的 CF 清单(可能 1 个,或 分组N + 汇总1)
export function buildAggCfs(c, members, devIds) {
  const ref = (dev) => ({
    refEntityId: { entityType: 'DEVICE', id: devIds[dev] },
    refEntityKey: { type: 'TS_LATEST', key: c.key },
    defaultValue: '0',
  })
  const selfRef = (key) => ({ refEntityKey: { type: 'TS_LATEST', key }, defaultValue: '0' })
  const mk = (name, args, expression) => ({
    type: 'SIMPLE', name, configurationVersion: 1,
    configuration: { type: 'SIMPLE', arguments: args, expression,
      output: { type: 'TIME_SERIES', name, scope: null, decimalsByDefault: 2,
        // processCfs:输出继续触发下游 CF(分层汇总依赖此级联,与生产配置一致)
        strategy: { type: 'IMMEDIATE', ttl: 0, saveTimeSeries: true, saveLatest: true,
                    sendWsUpdate: true, processCfs: true } } },
  })
  const sumExpr = (names) => names.join(' + ')
  const n = members.length
  if (n <= MAX_CF_ARGS) {
    const args = {}
    members.forEach((d, i) => { args[`v${i}`] = ref(d.name) })
    const body = sumExpr(Object.keys(args))
    return [mk(c.output, args, c.agg === 'avg' ? `(${body}) / ${n}` : body)]
  }
  // 分层:每 10 台一个分组求和 CF,再一个汇总 CF
  const out = []
  const partKeys = []
  for (let i = 0; i < n; i += MAX_CF_ARGS) {
    const chunk = members.slice(i, i + MAX_CF_ARGS)
    const pkey = `${c.output}__p${out.length}`
    const args = {}
    chunk.forEach((d, j) => { args[`v${j}`] = ref(d.name) })
    out.push(mk(pkey, args, sumExpr(Object.keys(args))))
    partKeys.push(pkey)
  }
  const fargs = {}
  partKeys.forEach((k, i) => { fargs[`p${i}`] = selfRef(k) })
  const body = sumExpr(Object.keys(fargs))
  out.push(mk(c.output, fargs, c.agg === 'avg' ? `(${body}) / ${n}` : body))
  return out
}

export function validateConfig(cfg) {
  const errs = []
  if (cfg.schema !== 'tbsite/v1' && cfg.schema !== 'tbsite/v2')
    errs.push("schema 必须为 'tbsite/v1' 或 'tbsite/v2'")
  if (!cfg.site?.name) errs.push('站点标识不能为空')
  if (!cfg.devices?.length) errs.push('至少认领一台设备')
  for (const [i, t] of (cfg.deviceTemplates || []).entries()) {
    if (!t.name) errs.push(`设备模板 #${i + 1}: 缺少名称`)
    const sel = t.selector || {}
    if (!sel.profiles?.length && !sel.prefixes?.length)
      errs.push(`设备模板「${t.name || i + 1}」: 选择器为空(需指定类型或名称前缀)`)
  }
  const names = new Set((cfg.devices || []).map((d) => d.name))
  for (const [i, c] of (cfg.computations || []).entries()) {
    const w = `运算 #${i + 1} (${c.template})`
    if (c.template === 'revenue.periodic') {
      for (const fld of ['charge', 'discharge'])
        if (!c[fld]?.device || !c[fld]?.key) errs.push(`${w}: 缺少${fld === 'charge' ? '充' : '放'}电量测点`)
        else if (!names.has(c[fld].device)) errs.push(`${w}: ${c[fld].device} 未认领`)
      if (!c.priceAsset) errs.push(`${w}: 缺少电价配置资产名`)
      if (!c.asset) errs.push(`${w}: 缺少目标资产名`)
      if (!c.output) errs.push(`${w}: 缺少输出测点名`)
      continue
    }
    if (c.template === 'window.cascade') {
      if (!c.keys?.length) errs.push(`${w}: 统计测点不能为空`)
      if (!c.aggs?.length) errs.push(`${w}: 统计量不能为空`)
      continue
    }
    if (c.template === 'aggregate.crossEntity') {
      const sel = c.selector || {}
      if (!sel.profiles?.length && !sel.prefixes?.length) errs.push(`${w}: 成员选择器为空`)
      if (!c.key) errs.push(`${w}: 缺少源测点`)
      if (!c.output) errs.push(`${w}: 缺少输出测点名`)
      if (!c.asset) errs.push(`${w}: 缺少目标资产名`)
      if (!['sum', 'avg'].includes(c.agg)) errs.push(`${w}: 聚合方式必须是 sum/avg`)
      const members = resolveAggMembers(cfg, c)
      if (!members.length) errs.push(`${w}: 没有匹配到任何具备测点 ${c.key} 的已认领设备`)
      if (members.length > MAX_AGG_MEMBERS) errs.push(`${w}: 成员 ${members.length} 台超过上限 ${MAX_AGG_MEMBERS},请按前缀拆成多个汇聚`)
      continue
    }
    if (!names.has(c.device)) errs.push(`${w}: 设备未认领`)
    if (c.template === 'expr.custom') {
      if (!Array.isArray(c.terms) || c.terms.length < 2) errs.push(`${w}: 至少两项`)
      if ((c.ops || []).length !== (c.terms || []).length - 1) errs.push(`${w}: 运算符数量不匹配`)
      for (const t of c.terms || [])
        if (t.kind === 'key' && !names.has(t.device)) errs.push(`${w}: 引用了未认领设备 ${t.device}`)
      if (!c.output) errs.push(`${w}: 缺少输出名`)
    } else if (c.template?.startsWith('expr.') || c.template?.startsWith('formula.')) {
      for (const [pid, ref] of Object.entries(c.inputs || {}))
        if (!names.has(ref.device)) errs.push(`${w}: 输入 ${pid} 引用了未认领设备`)
      if (!c.output) errs.push(`${w}: 缺少输出名`)
    } else if (c.template === 'alarm.threshold') {
      if (!c.name) errs.push(`${w}: 缺少告警名称`)
      if (typeof c.condition?.value !== 'number') errs.push(`${w}: 阈值必须是数字`)
    }
  }
  return errs
}

function tsArg(key, deviceId) {
  const a = { refEntityKey: { type: 'TS_LATEST', key } }
  if (deviceId) a.refEntityId = { entityType: 'DEVICE', id: deviceId }
  return a
}

function buildCf(comp, hostId, devIds) {
  const out = comp.output
  const arg = (ref) => tsArg(ref.key, devIds[ref.device] !== hostId ? devIds[ref.device] : null)
  let type, expression, args
  if (comp.template === 'expr.add' || comp.template === 'expr.subtract') {
    type = 'SIMPLE'
    expression = comp.template === 'expr.add' ? 'a + b' : 'a - b'
    args = { a: arg(comp.inputs.a), b: arg(comp.inputs.b) }
  } else if (comp.template === 'expr.custom') {
    // 从左到右依次计算:每一步都显式加括号
    type = 'SIMPLE'
    args = {}
    let vi = 0
    const token = (t) => {
      if (t.kind === 'const') return String(t.value)
      const name = `v${vi++}`
      args[name] = arg(t)
      return t.abs ? `abs(${name})` : name
    }
    expression = token(comp.terms[0])
    for (let i = 1; i < comp.terms.length; i++) {
      expression = `(${expression}) ${comp.ops[i - 1]} ${token(comp.terms[i])}`
    }
  } else {
    throw new Error(`未知即时派生模板: ${comp.template}`)
  }
  const toAttr = comp.outputMode === 'attr'
  return {
    entityId: { entityType: 'DEVICE', id: hostId },
    type, name: out, configurationVersion: 1,
    configuration: {
      type, arguments: args, expression,
      output: toAttr
        ? { type: 'ATTRIBUTES', name: out, scope: 'SERVER_SCOPE', decimalsByDefault: 2 }
        : { type: 'TIME_SERIES', name: out, scope: null, decimalsByDefault: 2 },
    },
  }
}

async function ensureChain(api, name) {
  const page = await api(`/api/ruleChains?pageSize=100&page=0&textSearch=${encodeURIComponent(name)}`)
  const found = page.data.find((c) => c.name === name)
  if (found) return { id: found.id.id, created: false }
  const created = await api('/api/ruleChain', { name, type: 'CORE', debugMode: false, root: false })
  return { id: created.id.id, created: true }
}

const CASCADE_LEVELS = [
  { id: '5m', seconds: 300, ttl: 7 * 86400 },
  { id: '1h', seconds: 3600, ttl: 90 * 86400 },
  { id: '1d', seconds: 86400, ttl: 0 },
]

const CASCADE_JS = `
var spec = %SPEC%;
function series(key) {
    var raw = metadata[key];
    if (!raw) return [];
    return JSON.parse(raw).map(function (p) { return parseFloat(p.value); })
        .filter(function (v) { return !isNaN(v); });
}
var fns = {
    avg: function (v) { return v.reduce(function (a, b) { return a + b; }, 0) / v.length; },
    min: function (v) { return Math.min.apply(null, v); },
    max: function (v) { return Math.max.apply(null, v); },
    sum: function (v) { return v.reduce(function (a, b) { return a + b; }, 0); },
};
var out = {};
spec.entries.forEach(function (e) {
    var v = series(e.src);
    if (v.length) out[e.out] = Math.round(fns[e.fn](v) * 10000) / 10000;
});
if (Object.keys(out).length === 0) return { msg: msg, metadata: metadata, msgType: msgType };
return { msg: out, metadata: metadata, msgType: 'POST_TELEMETRY_REQUEST' };
`

function rollupMetadata(chainId, groups, devIds, cascades = []) {
  const nodes = []
  const connections = []
  const add = (n) => nodes.push(n) - 1
  const save = add({
    type: 'org.thingsboard.rule.engine.telemetry.TbMsgTimeseriesNode',
    name: 'save rollups', configuration: { defaultTTL: 0 },
    additionalInfo: { layoutX: 1000, layoutY: 300 },
  })
  // 多级归档:每级独立保存节点(分级保留期)
  const saveByTtl = {}
  const saveFor = (ttl) => {
    if (saveByTtl[ttl] === undefined)
      saveByTtl[ttl] = add({
        type: 'org.thingsboard.rule.engine.telemetry.TbMsgTimeseriesNode',
        name: `save ttl=${ttl ? ttl / 86400 + 'd' : '∞'}`,
        configuration: { defaultTTL: ttl },
        additionalInfo: { layoutX: 1300, layoutY: 60 + Object.keys(saveByTtl).length * 100 },
      })
    return saveByTtl[ttl]
  }
  let cy = 900
  for (const c of cascades) {
    CASCADE_LEVELS.forEach((lv, li) => {
      const entries = []
      for (const k of c.keys)
        for (const a of c.aggs) {
          const src = li === 0 ? k : `${k}${AGG_SUFFIX[a]}${CASCADE_LEVELS[li - 1].id}`
          entries.push({ src, out: `${k}${AGG_SUFFIX[a]}${lv.id}`, fn: a })
        }
      const fetchKeys = [...new Set(entries.map((e) => e.src))]
      const g = add({
        type: 'org.thingsboard.rule.engine.debug.TbMsgGeneratorNode',
        name: `tick 级联 ${c.device} @${lv.id}`,
        configuration: { msgCount: 0, periodInSeconds: lv.seconds,
          originatorId: devIds[c.device], originatorType: 'DEVICE', queueName: null,
          jsScript: "return { msg: {}, metadata: { cascade: 'true' }, msgType: 'CASCADE_TICK' };" },
        additionalInfo: { layoutX: 100, layoutY: cy },
      })
      const f = add({
        type: 'org.thingsboard.rule.engine.metadata.TbGetTelemetryNode',
        name: `fetch 级联 ${c.device} @${lv.id}`,
        configuration: { latestTsKeyNames: fetchKeys, fetchMode: 'ALL', orderBy: 'ASC',
          aggregation: 'NONE', limit: 1000, useMetadataIntervalPatterns: false,
          startInterval: lv.seconds, startIntervalTimeUnit: 'SECONDS',
          endInterval: 1, endIntervalTimeUnit: 'SECONDS' },
        additionalInfo: { layoutX: 400, layoutY: cy },
      })
      const a = add({
        type: 'org.thingsboard.rule.engine.transform.TbTransformMsgNode',
        name: `级联汇算 ${c.device} @${lv.id}`,
        configuration: { scriptLang: 'JS',
          jsScript: CASCADE_JS.replace('%SPEC%', JSON.stringify({ entries })) },
        additionalInfo: { layoutX: 700, layoutY: cy },
      })
      connections.push({ fromIndex: g, toIndex: f, type: 'Success' },
        { fromIndex: f, toIndex: a, type: 'Success' },
        { fromIndex: a, toIndex: saveFor(lv.ttl), type: 'Success' })
      cy += 120
    })
  }
  let i = 0
  for (const [gk, spec] of Object.entries(groups)) {
    const [device, window] = gk.split('@@')
    const y = 80 + i++ * 120
    const period = WINDOW_SECONDS[window]
    const sfx = { avg: 'Avg' + window, min: 'Min' + window, max: 'Max' + window }
    const fetch = [...new Set([...spec.avg, ...spec.min, ...spec.max,
      ...Object.keys(spec.delta), ...Object.keys(spec.integrate || {})])].sort()
    const g = add({
      type: 'org.thingsboard.rule.engine.debug.TbMsgGeneratorNode',
      name: `tick ${device} @${window}`,
      configuration: {
        msgCount: 0, periodInSeconds: period,
        originatorId: devIds[device], originatorType: 'DEVICE', queueName: null,
        jsScript: "var msg = {}; var metadata = { rollup: 'true' }; var msgType = 'ROLLUP_TICK'; return { msg: msg, metadata: metadata, msgType: msgType };",
      },
      additionalInfo: { layoutX: 100, layoutY: y },
    })
    const f = add({
      type: 'org.thingsboard.rule.engine.metadata.TbGetTelemetryNode',
      name: `fetch ${device} @${window}`,
      configuration: {
        latestTsKeyNames: fetch, fetchMode: 'ALL', orderBy: 'ASC', aggregation: 'NONE',
        limit: 1000, useMetadataIntervalPatterns: false,
        startInterval: period, startIntervalTimeUnit: 'SECONDS',
        endInterval: 1, endIntervalTimeUnit: 'SECONDS',
      },
      additionalInfo: { layoutX: 400, layoutY: y },
    })
    const a = add({
      type: 'org.thingsboard.rule.engine.transform.TbTransformMsgNode',
      name: `aggregate ${device} @${window}`,
      configuration: {
        scriptLang: 'JS',
        jsScript: AGG_JS.replace('%SPEC%', JSON.stringify({ ...spec, sfx })),
      },
      additionalInfo: { layoutX: 700, layoutY: y },
    })
    connections.push({ fromIndex: g, toIndex: f, type: 'Success' },
      { fromIndex: f, toIndex: a, type: 'Success' },
      { fromIndex: a, toIndex: save, type: 'Success' })
  }
  return { ruleChainId: { entityType: 'RULE_CHAIN', id: chainId },
    firstNodeIndex: null, nodes, connections, ruleChainConnections: null }
}

function alarmMetadata(chainId, alarms) {
  const nodes = []
  const connections = []
  const add = (n) => nodes.push(n) - 1
  const entry = add({
    type: 'org.thingsboard.rule.engine.filter.TbJsFilterNode',
    name: 'entry', configuration: { scriptLang: 'JS', jsScript: 'return true;' },
    additionalInfo: { layoutX: 40, layoutY: 40 },
  })
  alarms.forEach((a, i) => {
    const y = 120 + i * 140
    const op = OP_JS[a.condition.op]
    const val = a.condition.value
    const alarmType = a.name || `${a.key} 阈值告警`
    const msgText = a.message.replace(/'/g, "\\'")
    // 模板展开的告警携带 devices 列表(一条规则覆盖多台同类设备);单设备时退化为一元列表
    const devList = a.devices?.length ? a.devices : [a.device]
    const relScript = devList.length === 1
      ? `return metadata.deviceName === '${devList[0]}' && typeof msg['${a.key}'] !== 'undefined';`
      : `return ${JSON.stringify(devList)}.indexOf(metadata.deviceName) >= 0 && typeof msg['${a.key}'] !== 'undefined';`
    const rel = add({
      type: 'org.thingsboard.rule.engine.filter.TbJsFilterNode',
      name: `关于 ${devList.length === 1 ? devList[0] : devList.length + ' 台设备'}.${a.key}?`,
      configuration: { scriptLang: 'JS', jsScript: relScript },
      additionalInfo: { layoutX: 60, layoutY: y },
    })
    const thr = add({
      type: 'org.thingsboard.rule.engine.filter.TbJsFilterNode',
      name: `${a.key} ${op} ${val}?`,
      configuration: { scriptLang: 'JS', jsScript: `return Number(msg['${a.key}']) ${op} ${val};` },
      additionalInfo: { layoutX: 380, layoutY: y },
    })
    // 文案中的 {value} 在触发时替换为实时值
    const msgExpr = "'" + msgText.split('{value}').join(`' + msg['${a.key}'] + '`) + "'"
    const create = add({
      type: 'org.thingsboard.rule.engine.action.TbCreateAlarmNode',
      name: `告警: ${alarmType}`,
      configuration: {
        alarmType, severity: a.severity, propagate: false,
        useMessageAlarmData: false, overwriteAlarmDetails: false, dynamicSeverity: false,
        scriptLang: 'JS',
        alarmDetailsBuildJs:
          `var details = {}; details.message = ${msgExpr}; details.key = '${a.key}'; ` +
          `details.value = msg['${a.key}']; details.threshold = ${val}; return details;`,
      },
      additionalInfo: { layoutX: 700, layoutY: y - 30 },
    })
    const clear = add({
      type: 'org.thingsboard.rule.engine.action.TbClearAlarmNode',
      name: `清除: ${alarmType}`,
      configuration: { alarmType, scriptLang: 'JS',
        alarmDetailsBuildJs: 'var details = {}; return details;' },
      additionalInfo: { layoutX: 700, layoutY: y + 60 },
    })
    if (a.trigger === 'edge') {
      // 变化才触发:上次状态存为设备服务端属性,状态翻转时才走 create/clear,并回写新状态
      const stateAttr = `almState_${a.key}_${a.condition.op}`.replace(/[^\w]/g, '_')
      const getSt = add({
        type: 'org.thingsboard.rule.engine.metadata.TbGetAttributesNode',
        name: `取上次状态`,
        configuration: { tellFailureIfAbsent: false, fetchTo: 'METADATA',
          clientAttributeNames: [], sharedAttributeNames: [],
          serverAttributeNames: [stateAttr], latestTsKeyNames: [], getLatestValueWithTs: false },
        additionalInfo: { layoutX: 240, layoutY: y },
      })
      const prep = add({
        type: 'org.thingsboard.rule.engine.transform.TbTransformMsgNode',
        name: `判定变化 ${alarmType}`,
        configuration: { scriptLang: 'JS', jsScript:
          `var cond = Number(msg['${a.key}']) ${op} ${val}; ` +
          `metadata.cond = String(cond); ` +
          `metadata.changed = String(String(cond) !== metadata.ss_${stateAttr}); ` +
          `return { msg: msg, metadata: metadata, msgType: msgType };` },
        additionalInfo: { layoutX: 400, layoutY: y },
      })
      const chg = add({
        type: 'org.thingsboard.rule.engine.filter.TbJsFilterNode',
        name: `状态翻转?`,
        configuration: { scriptLang: 'JS', jsScript: "return metadata.changed === 'true';" },
        additionalInfo: { layoutX: 540, layoutY: y },
      })
      const saveSt = add({
        type: 'org.thingsboard.rule.engine.transform.TbTransformMsgNode',
        name: `写状态 ${alarmType}`,
        configuration: { scriptLang: 'JS', jsScript:
          `var m = {}; m['${stateAttr}'] = metadata.cond === 'true'; ` +
          `return { msg: m, metadata: metadata, msgType: 'POST_ATTRIBUTES_REQUEST' };` },
        additionalInfo: { layoutX: 900, layoutY: y + 30 },
      })
      const attrSave = add({
        type: 'org.thingsboard.rule.engine.telemetry.TbMsgAttributesNode',
        name: `存状态属性`,
        configuration: { processingSettings: { type: 'ON_EVERY_MESSAGE' },
          scope: 'SERVER_SCOPE', notifyDevice: false,
          sendAttributesUpdatedNotification: false, updateAttributesOnlyOnValueChange: true },
        additionalInfo: { layoutX: 1050, layoutY: y + 30 },
      })
      connections.push({ fromIndex: entry, toIndex: rel, type: 'True' },
        { fromIndex: rel, toIndex: getSt, type: 'True' },
        { fromIndex: getSt, toIndex: prep, type: 'Success' },
        { fromIndex: prep, toIndex: chg, type: 'Success' },
        { fromIndex: chg, toIndex: thr, type: 'True' },
        { fromIndex: thr, toIndex: create, type: 'True' },
        { fromIndex: thr, toIndex: clear, type: 'False' },
        { fromIndex: create, toIndex: saveSt, type: 'Created' },
        { fromIndex: create, toIndex: saveSt, type: 'Updated' },
        { fromIndex: clear, toIndex: saveSt, type: 'Cleared' },
        { fromIndex: clear, toIndex: saveSt, type: 'False' },
        { fromIndex: saveSt, toIndex: attrSave, type: 'Success' })
    } else {
      connections.push({ fromIndex: entry, toIndex: rel, type: 'True' },
        { fromIndex: rel, toIndex: thr, type: 'True' },
        { fromIndex: thr, toIndex: create, type: 'True' },
        { fromIndex: thr, toIndex: clear, type: 'False' })
    }
  })
  return { ruleChainId: { entityType: 'RULE_CHAIN', id: chainId },
    firstNodeIndex: entry, nodes, connections, ruleChainConnections: null }
}

// ── 分时电价收益(revenue.periodic → 独立规则链)──────────────
const REVENUE_JS = `
var spec = %SPEC%;
function delta(key) {
    var raw = metadata[key];
    if (!raw) return 0;
    var pts = JSON.parse(raw)
        .map(function (p) { return [parseInt(p.ts), parseFloat(p.value)]; })
        .filter(function (p) { return !isNaN(p[0]) && !isNaN(p[1]); })
        .sort(function (a, b) { return a[0] - b[0]; });
    if (pts.length < 2) return 0;
    var d = pts[pts.length - 1][1] - pts[0][1];
    return d > 0 ? d : 0; // 累计量回退(模拟数据抖动)按 0 计
}
var cfg = {};
try { cfg = JSON.parse(metadata.ss_electricityPrice || '{}'); } catch (e) {}
var prices = cfg.prices || [];
var hour = new Date(Date.now() + 8 * 3600000).getUTCHours(); // 东八区时段(TB 服务器可能是 UTC)
var price = prices.length === 24 ? parseFloat(prices[hour]) : 0;
var charge = delta(spec.chargeKey);
var discharge = delta(spec.dischargeKey);
var out = {};
out[spec.output] = Math.round((discharge - charge) * price * 10000) / 10000;
out[spec.output + 'Income'] = Math.round(discharge * price * 10000) / 10000;
out[spec.output + 'Cost'] = Math.round(charge * price * 10000) / 10000;
return { msg: out, metadata: metadata, msgType: 'POST_TELEMETRY_REQUEST' };
`

function revenueMetadata(chainId, revs, devIds, assetIds = {}) {
  const nodes = []
  const connections = []
  const add = (n) => nodes.push(n) - 1
  revs.forEach((c, i) => {
    const y = 80 + i * 140
    const period = WINDOW_SECONDS[c.window] || 3600
    const gen = add({
      type: 'org.thingsboard.rule.engine.debug.TbMsgGeneratorNode',
      name: `tick 收益 ${c.output}`,
      configuration: { msgCount: 0, periodInSeconds: period,
        originatorId: devIds[c.charge.device], originatorType: 'DEVICE', queueName: null,
        jsScript: "return { msg: {}, metadata: { revenue: 'true' }, msgType: 'REVENUE_TICK' };" },
      additionalInfo: { layoutX: 60, layoutY: y },
    })
    const fetch = add({
      type: 'org.thingsboard.rule.engine.metadata.TbGetTelemetryNode',
      name: `取电量 ${c.output}`,
      configuration: {
        latestTsKeyNames: [...new Set([c.charge.key, c.discharge.key])],
        fetchMode: 'ALL', orderBy: 'ASC', aggregation: 'NONE', limit: 1000,
        useMetadataIntervalPatterns: false,
        startInterval: period, startIntervalTimeUnit: 'SECONDS',
        endInterval: 1, endIntervalTimeUnit: 'SECONDS',
      },
      additionalInfo: { layoutX: 280, layoutY: y },
    })
    const toPrice = add({
      type: 'org.thingsboard.rule.engine.transform.TbChangeOriginatorNode',
      name: `切到电价资产`,
      configuration: { originatorSource: 'ENTITY', entityType: 'ASSET',
        entityNamePattern: c.priceAsset,
        relationsQuery: { direction: 'FROM', maxLevel: 1,
          filters: [{ relationType: 'Contains', entityTypes: [], negate: false }],
          fetchLastLevelOnly: false } },
      additionalInfo: { layoutX: 500, layoutY: y },
    })
    const attrs = add({
      type: 'org.thingsboard.rule.engine.metadata.TbGetAttributesNode',
      name: `取电价配置`,
      configuration: { tellFailureIfAbsent: true, fetchTo: 'METADATA',
        clientAttributeNames: [], sharedAttributeNames: [],
        serverAttributeNames: ['electricityPrice'], latestTsKeyNames: [],
        getLatestValueWithTs: false },
      additionalInfo: { layoutX: 700, layoutY: y },
    })
    const calc = add({
      type: 'org.thingsboard.rule.engine.transform.TbTransformMsgNode',
      name: `算收益 ${c.output}`,
      configuration: { scriptLang: 'JS',
        jsScript: REVENUE_JS.replace('%SPEC%', JSON.stringify(
          { chargeKey: c.charge.key, dischargeKey: c.discharge.key, output: c.output })) },
      additionalInfo: { layoutX: 900, layoutY: y },
    })
    const toOut = add({
      type: 'org.thingsboard.rule.engine.transform.TbChangeOriginatorNode',
      name: `切到收益资产`,
      configuration: { originatorSource: 'ENTITY', entityType: 'ASSET',
        entityNamePattern: c.asset,
        relationsQuery: { direction: 'FROM', maxLevel: 1,
          filters: [{ relationType: 'Contains', entityTypes: [], negate: false }],
          fetchLastLevelOnly: false } },
      additionalInfo: { layoutX: 1100, layoutY: y },
    })
    const save = add({
      type: 'org.thingsboard.rule.engine.telemetry.TbMsgTimeseriesNode',
      name: `存收益 ${c.output}`,
      configuration: { defaultTTL: 0 },
      additionalInfo: { layoutX: 1300, layoutY: y },
    })
    connections.push(
      { fromIndex: gen, toIndex: fetch, type: 'Success' },
      { fromIndex: fetch, toIndex: toPrice, type: 'Success' },
      { fromIndex: toPrice, toIndex: attrs, type: 'Success' },
      { fromIndex: attrs, toIndex: calc, type: 'Success' },
      { fromIndex: calc, toIndex: toOut, type: 'Success' },
      { fromIndex: toOut, toIndex: save, type: 'Success' })
    // 每日收益:滚动 24h 求和净收益/收入/成本 → <output>Daily 系列(注:非自然日对齐)
    if (assetIds[c.asset]) {
      // 当日累计口径:生成器随基础周期触发,每拍算出"东八区今日 0 点"作为取数窗口起点,
      // 输出为今日累计(零点自动归零);取数窗口通过元数据时间戳模式动态传入
      const dGen = add({
        type: 'org.thingsboard.rule.engine.debug.TbMsgGeneratorNode',
        name: `tick 日收益 ${c.output}`,
        configuration: { msgCount: 0, periodInSeconds: period,
          originatorId: assetIds[c.asset], originatorType: 'ASSET', queueName: null,
          jsScript: "var now = Date.now(); var tz = 8 * 3600000; " +
            "var dayStart = Math.floor((now + tz) / 86400000) * 86400000 - tz; " +
            "return { msg: {}, metadata: { revenueDaily: 'true', dayStartTs: String(dayStart), dayEndTs: String(now) }, msgType: 'REVENUE_DAILY_TICK' };" },
        additionalInfo: { layoutX: 60, layoutY: y + 70 },
      })
      const dFetch = add({
        type: 'org.thingsboard.rule.engine.metadata.TbGetTelemetryNode',
        name: `取当日收益 ${c.output}`,
        configuration: { latestTsKeyNames: [c.output, c.output + 'Income', c.output + 'Cost'],
          fetchMode: 'ALL', orderBy: 'ASC', aggregation: 'NONE', limit: 1000,
          useMetadataIntervalPatterns: true,
          startIntervalPattern: '${dayStartTs}', endIntervalPattern: '${dayEndTs}',
          startInterval: 86400, startIntervalTimeUnit: 'SECONDS',
          endInterval: 1, endIntervalTimeUnit: 'SECONDS' },
        additionalInfo: { layoutX: 280, layoutY: y + 70 },
      })
      const dCalc = add({
        type: 'org.thingsboard.rule.engine.transform.TbTransformMsgNode',
        name: `算日收益 ${c.output}`,
        configuration: { scriptLang: 'JS',
          jsScript: CASCADE_JS.replace('%SPEC%', JSON.stringify({ entries:
            [c.output, c.output + 'Income', c.output + 'Cost']
              .map((k) => ({ src: k, out: k + 'Daily', fn: 'sum' })) })) },
        additionalInfo: { layoutX: 500, layoutY: y + 70 },
      })
      const dSave = add({
        type: 'org.thingsboard.rule.engine.telemetry.TbMsgTimeseriesNode',
        name: `存日收益 ${c.output}`, configuration: { defaultTTL: 0 },
        additionalInfo: { layoutX: 720, layoutY: y + 70 },
      })
      connections.push({ fromIndex: dGen, toIndex: dFetch, type: 'Success' },
        { fromIndex: dFetch, toIndex: dCalc, type: 'Success' },
        { fromIndex: dCalc, toIndex: dSave, type: 'Success' })
    }
  })
  return { ruleChainId: { entityType: 'RULE_CHAIN', id: chainId },
    firstNodeIndex: null, nodes, connections, ruleChainConnections: null }
}

async function wireRootChain(api, alarmChainId, siteName) {
  const flowName = `site alarms flow · ${siteName}` // 每站点独立转发节点,多站点互不覆盖
  const page = await api('/api/ruleChains?pageSize=100&page=0')
  const root = page.data.find((c) => c.root)
  if (!root) throw new Error('未找到 Root 规则链')
  const meta = await api(`/api/ruleChain/${root.id.id}/metadata`)
  const flow = meta.nodes.find((n) => n.name === flowName)
  if (flow) {
    if (flow.configuration.ruleChainId === alarmChainId) return '转发已就位'
    flow.configuration.ruleChainId = alarmChainId
  } else {
    const switchI = meta.nodes.findIndex((n) => n.type.endsWith('TbMsgTypeSwitchNode'))
    if (switchI < 0) throw new Error('Root 链缺少 Message Type Switch 节点')
    meta.nodes.push({
      type: 'org.thingsboard.rule.engine.flow.TbRuleChainInputNode',
      name: flowName,
      configuration: { ruleChainId: alarmChainId, forwardMsgToDefaultRuleChain: false },
      additionalInfo: { layoutX: 900, layoutY: 600 },
    })
    meta.connections = meta.connections || []
    meta.connections.push({ fromIndex: switchI, toIndex: meta.nodes.length - 1, type: 'Post telemetry' })
  }
  await api('/api/ruleChain/metadata', meta)
  return 'Root 链已接线'
}

// ── 主流程:report(stepId, 'run'|'ok'|'err', detail) ──────────────
// 返回失败清单 [{step, device?, output?, error}];为空即全部成功。
// retry = { steps:[...], cf:[{device,output}], agg:[output] } 时只重发失败项,
// 不在 steps 里的步骤直接跳过(上次已成功;所有写入幂等,重跑也安全)。
export async function publish(cfg, devIds, api, report, publishedBy = '', retry = null) {
  const failures = []
  const stepOn = (id) => !retry || retry.steps.includes(id)
  // 1. 校验 + 模板展开
  report('validate', 'run')
  const errs = validateConfig(cfg)
  if (errs.length) { report('validate', 'err', errs.join(';')); throw new Error('校验失败') }
  const expanded = expandTemplates(cfg)
  const originalCfg = cfg // 站点配置保存原始声明(不含展开产物),恢复时才不会出现冗余条目
  // 展开结果并入运算清单(模板项在前,便于同名输出被手工项覆盖时以手工项为准)
  cfg = { ...cfg, computations: [...expanded.computations, ...(cfg.computations || [])] }
  const vDetail = `${cfg.devices.length} 设备 · ${cfg.computations.length} 运算` +
    (expanded.computations.length ? `(模板展开 ${expanded.computations.length} 条)` : '') +
    (expanded.notes.length ? ` · ${expanded.notes.join('; ')}` : '')
  report('validate', 'ok', vDetail)

  // 2. 设备核对
  report('devices', 'run')
  try {
    for (const d of cfg.devices) {
      if (!devIds[d.name]) throw new Error(`设备 ${d.name} 在 TB 中不存在`)
    }
    report('devices', 'ok', `${cfg.devices.length} 台全部就绪`)
  } catch (e) { report('devices', 'err', e.message); throw e }

  // 3. 计算字段 — 逐条容错:单台设备失败不拖垮整批
  const allCfComps = cfg.computations.filter((c) => c.template.startsWith('expr.') || c.template.startsWith('formula.'))
  report('cf', 'run')
  if (!stepOn('cf')) report('cf', 'ok', '跳过(上次已成功)')
  else {
    let cfComps = allCfComps
    if (retry?.cf?.length) { // 只重发上次失败的条目
      const want = new Set(retry.cf.map((x) => `${x.device}@@${x.output}`))
      cfComps = allCfComps.filter((c) => want.has(`${c.device}@@${c.output}`))
    }
    let created = 0, updated = 0, failed = 0
    const cfCache = {} // hostId → 既有 CF 列表(一台只查一次)
    for (const c of cfComps) {
      try {
        const hostId = devIds[c.device]
        const body = buildCf(c, hostId, devIds)
        cfCache[hostId] ||= (await api(`/api/DEVICE/${hostId}/calculatedFields?pageSize=100&page=0`)).data
        const existing = cfCache[hostId].find((x) => x.name === c.output)
        if (existing) { body.id = existing.id; updated++ } else created++
        const saved = await api('/api/calculatedField', body)
        if (!existing && saved?.id) cfCache[hostId].push({ id: saved.id, name: c.output })
        report('cf', 'run', `${created + updated + failed}/${cfComps.length} · ${c.device}`)
      } catch (e) {
        failed++
        failures.push({ step: 'cf', device: c.device, output: c.output, error: e.message })
      }
    }
    const detail = cfComps.length
      ? `新建 ${created} · 更新 ${updated}` + (failed ? ` · 失败 ${failed}(见下方失败清单)` : '') +
        (retry?.cf?.length ? ` · 重试范围 ${cfComps.length} 条` : '')
      : '无'
    report('cf', failed ? 'err' : 'ok', detail)
  }

  // 3b. 跨设备汇聚 → 独立虚拟资产上的 CF(逐项容错:单项失败不拖垮其余汇聚)
  report('agg', 'run')
  if (!stepOn('agg')) report('agg', 'ok', '跳过(上次已成功)')
  else {
    let aggs = cfg.computations.filter((c) => c.template === 'aggregate.crossEntity')
    if (retry?.agg?.length) aggs = aggs.filter((c) => retry.agg.includes(c.output))
    if (aggs.length) {
      let cfCount = 0, aggFailed = 0
      for (const c of aggs) {
        try {
          const members = resolveAggMembers(cfg, c)
          const page = await api(`/api/tenant/assets?pageSize=100&page=0&textSearch=${encodeURIComponent(c.asset)}`)
          let asset = page.data.find((a) => a.name === c.asset)
          if (!asset) asset = await api('/api/asset', { name: c.asset, type: 'tbsite-agg' })
          await api(`/api/customer/public/asset/${asset.id.id}`, {})
          for (const m of members)
            await api('/api/relation', {
              from: { entityType: 'ASSET', id: asset.id.id },
              to: { entityType: 'DEVICE', id: devIds[m.name] },
              type: 'Contains', typeGroup: 'COMMON',
            })
          const existing = (await api(`/api/ASSET/${asset.id.id}/calculatedFields?pageSize=100&page=0`)).data
          const bodies = buildAggCfs(c, members, devIds)
          const layered = bodies.length > 1
          // CF 只在创建时初始化计算——分层时汇总 CF 须等分组遥测落库后删除重建
          for (const body of (layered ? bodies.slice(0, -1) : bodies)) {
            body.entityId = { entityType: 'ASSET', id: asset.id.id }
            const ex = existing.find((x) => x.name === body.name)
            if (ex) body.id = ex.id
            await api('/api/calculatedField', body)
            cfCount++
          }
          if (layered) {
            await new Promise((r) => setTimeout(r, 3000))
            const final = bodies[bodies.length - 1]
            final.entityId = { entityType: 'ASSET', id: asset.id.id }
            const ex = existing.find((x) => x.name === final.name)
            if (ex) await api(`/api/calculatedField/${ex.id.id}`, null, 'DELETE')
            await api('/api/calculatedField', final)
            cfCount++
          }
        } catch (e) {
          aggFailed++
          failures.push({ step: 'agg', output: c.output, error: e.message })
        }
      }
      report('agg', aggFailed ? 'err' : 'ok',
        `${aggs.length - aggFailed} 项汇聚 · ${cfCount} 个资产计算字段` +
        (aggFailed ? ` · 失败 ${aggFailed}(见下方失败清单)` : ''))
    } else report('agg', 'ok', '无')
  }

  // 3c. 分时电价收益 → 独立规则链 + 收益资产
  report('revenue', 'run')
  if (!stepOn('revenue')) report('revenue', 'ok', '跳过(上次已成功)')
  else try {
    const revs = cfg.computations.filter((c) => c.template === 'revenue.periodic')
    if (revs.length) {
      const assetIds = {}
      for (const c of revs) {
        const page = await api(`/api/tenant/assets?pageSize=100&page=0&textSearch=${encodeURIComponent(c.asset)}`)
        let asset = page.data.find((a) => a.name === c.asset)
        if (!asset) asset = await api('/api/asset', { name: c.asset, type: 'tbsite-agg' })
        await api(`/api/customer/public/asset/${asset.id.id}`, {})
        assetIds[c.asset] = asset.id.id
      }
      const name = `Site Revenue · ${cfg.site.name}`
      const { id, created } = await ensureChain(api, name)
      await api('/api/ruleChain/metadata', revenueMetadata(id, revs, devIds, assetIds))
      report('revenue', 'ok', `${revs.length} 项收益统计 → ${name}` +
        (created ? '(新建定时链需 TB 重启后才开始跑)' : ''))
    } else report('revenue', 'ok', '无')
  } catch (e) { report('revenue', 'err', e.message); failures.push({ step: 'revenue', error: e.message }) }

  // 4. 聚合链
  report('rollup', 'run')
  if (!stepOn('rollup')) report('rollup', 'ok', '跳过(上次已成功)')
  else try {
    const groups = {}
    const blank = () => ({ avg: [], min: [], max: [], sum: [], delta: {}, integrate: {} })
    for (const c of cfg.computations) {
      if (c.template === 'window.aggregate') {
        const g = (groups[`${c.device}@@${c.window}`] ||= blank())
        for (const a of c.aggs) for (const k of c.keys) if (!g[a].includes(k)) g[a].push(k)
      } else if (c.template === 'window.delta') {
        const g = (groups[`${c.device}@@${c.window}`] ||= blank())
        g.delta[c.key] = c.output
      } else if (c.template === 'window.integrate') {
        const g = (groups[`${c.device}@@${c.window}`] ||= blank())
        g.integrate[c.key] = c.output
      }
    }
    const cascades = cfg.computations.filter((c) => c.template === 'window.cascade')
    if (Object.keys(groups).length || cascades.length) {
      const name = cfg.rollup?.chainName || `Site Rollups · ${cfg.site.name}`
      const { id, created } = await ensureChain(api, name)
      await api('/api/ruleChain/metadata', rollupMetadata(id, groups, devIds, cascades))
      report('rollup', 'ok', `${Object.keys(groups).length} 条流水线 · ${cascades.length} 项多级归档 → ${name}` +
        (created ? '(新建定时链需 TB 重启后才开始跑)' : ''))
    } else report('rollup', 'ok', '无')
  } catch (e) { report('rollup', 'err', e.message); failures.push({ step: 'rollup', error: e.message }) }

  // 5. 告警链
  report('alarm', 'run')
  if (!stepOn('alarm')) report('alarm', 'ok', '跳过(上次已成功)')
  else try {
    const alarms = cfg.computations.filter((c) => c.template === 'alarm.threshold')
    if (alarms.length) {
      const name = cfg.alarm?.chainName || `Site Alarms · ${cfg.site.name}`
      const { id } = await ensureChain(api, name)
      await api('/api/ruleChain/metadata', alarmMetadata(id, alarms))
      const wired = await wireRootChain(api, id, cfg.site.name)
      report('alarm', 'ok', `${alarms.length} 条规则 · ${wired}`)
    } else report('alarm', 'ok', '无')
  } catch (e) { report('alarm', 'err', e.message); failures.push({ step: 'alarm', error: e.message }) }

  // 6. 站点配置写入 + 公开
  report('asset', 'run')
  if (!stepOn('asset')) { report('asset', 'ok', '跳过(上次已成功)'); return failures }
  try {
    const page = await api(`/api/tenant/assets?pageSize=100&page=0&textSearch=${encodeURIComponent(cfg.site.name)}`)
    let asset = page.data.find((a) => a.name === cfg.site.name)
    if (!asset) asset = await api('/api/asset', { name: cfg.site.name, type: 'tbsite' })
    // 发布历史:上一版配置入栈,保留最近 10 版(约 <300KB,属性存储可承受)
    let history = []
    try {
      const attrs = await api(`/api/plugins/telemetry/ASSET/${asset.id.id}/values/attributes/SERVER_SCOPE?keys=siteConfig,siteConfigHistory`)
      const prev = attrs.find((a) => a.key === 'siteConfig')?.value
      const rawHist = attrs.find((a) => a.key === 'siteConfigHistory')?.value
      history = (typeof rawHist === 'string' ? JSON.parse(rawHist) : rawHist) || []
      if (prev) {
        const prevCfg = typeof prev === 'string' ? JSON.parse(prev) : prev
        history.unshift({ ts: Date.now(), by: publishedBy, cfg: prevCfg })
        history = history.slice(0, 10)
      }
    } catch { /* 历史读取失败不阻塞发布 */ }
    await api(`/api/plugins/telemetry/ASSET/${asset.id.id}/attributes/SERVER_SCOPE`,
              { siteConfig: originalCfg, siteConfigHistory: history })
    await api(`/api/customer/public/asset/${asset.id.id}`, {})
    report('asset', 'ok', `资产 ${cfg.site.name} · 已公开 · 历史 ${history.length} 版`)
  } catch (e) { report('asset', 'err', e.message); failures.push({ step: 'asset', error: e.message }) }
  return failures
}

// ── 站点清理:删除本站点生成的 CF / 规则链 / Root 转发节点 / 站点资产 ──
// 只清理"当前配置声明过的东西",不碰任何存量对象。
export async function cleanup(cfg, devIds, api, report) {
  const log = []
  const expanded = expandTemplates(cfg)
  const comps = [...expanded.computations, ...(cfg.computations || [])]
  // 1. 计算字段
  const outputsByDev = {}
  for (const c of comps)
    if (c.template?.startsWith('expr.') || c.template?.startsWith('formula.'))
      (outputsByDev[c.device] ||= new Set()).add(c.output)
  let cfDel = 0
  for (const [dev, outs] of Object.entries(outputsByDev)) {
    const hostId = devIds[dev]
    if (!hostId) continue
    try {
      const list = (await api(`/api/DEVICE/${hostId}/calculatedFields?pageSize=100&page=0`)).data
      for (const f of list)
        if (outs.has(f.name)) { await api(`/api/calculatedField/${f.id.id}`, null, 'DELETE'); cfDel++ }
    } catch (e) { log.push(`CF ${dev}: ${e.message}`) }
  }
  report?.('cleanup', 'run', `已删计算字段 ${cfDel}`)
  // 2. Root 链上的本站点转发节点
  const flowName = `site alarms flow · ${cfg.site.name}`
  try {
    const page = await api('/api/ruleChains?pageSize=100&page=0')
    const root = page.data.find((c) => c.root)
    const meta = await api(`/api/ruleChain/${root.id.id}/metadata`)
    const idx = meta.nodes.findIndex((n) => n.name === flowName)
    if (idx >= 0) {
      meta.nodes.splice(idx, 1)
      meta.connections = (meta.connections || [])
        .filter((c) => c.fromIndex !== idx && c.toIndex !== idx)
        .map((c) => ({ ...c,
          fromIndex: c.fromIndex > idx ? c.fromIndex - 1 : c.fromIndex,
          toIndex: c.toIndex > idx ? c.toIndex - 1 : c.toIndex }))
      if (meta.firstNodeIndex > idx) meta.firstNodeIndex--
      await api('/api/ruleChain/metadata', meta)
      log.push('Root 转发节点已摘除')
    }
    // 3. 站点规则链
    for (const name of [cfg.alarm?.chainName || `Site Alarms · ${cfg.site.name}`,
                        cfg.rollup?.chainName || `Site Rollups · ${cfg.site.name}`,
                        `Site Revenue · ${cfg.site.name}`]) {
      const found = page.data.find((c) => c.name === name && !c.root)
      if (found) { await api(`/api/ruleChain/${found.id.id}`, null, 'DELETE'); log.push(`已删规则链 ${name}`) }
    }
  } catch (e) { log.push(`规则链清理: ${e.message}`) }
  // 4. 汇聚/收益资产(工具创建的 tbsite-agg 类型,连同其上的 CF 一并删除)
  for (const c of comps.filter((x) => x.template === 'aggregate.crossEntity' || x.template === 'revenue.periodic')) {
    try {
      const assets = (await api(`/api/tenant/assets?pageSize=100&page=0&textSearch=${encodeURIComponent(c.asset)}`)).data
      const a = assets.find((x) => x.name === c.asset && x.type === 'tbsite-agg')
      if (a) { await api(`/api/asset/${a.id.id}`, null, 'DELETE'); log.push(`已删汇聚资产 ${c.asset}`) }
    } catch (e) { log.push(`汇聚资产 ${c.asset}: ${e.message}`) }
  }
  // 5. 站点资产
  try {
    const assets = (await api(`/api/tenant/assets?pageSize=100&page=0&textSearch=${encodeURIComponent(cfg.site.name)}`)).data
    const asset = assets.find((a) => a.name === cfg.site.name && a.type === 'tbsite')
    if (asset) { await api(`/api/asset/${asset.id.id}`, null, 'DELETE'); log.push('站点资产已删除') }
  } catch (e) { log.push(`资产清理: ${e.message}`) }
  return `计算字段 ×${cfDel}` + (log.length ? ' · ' + log.join(' · ') : '')
}
