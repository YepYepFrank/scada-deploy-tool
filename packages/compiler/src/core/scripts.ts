// 规则链 Transform 节点里跑的 JS(TB 内置 JS 引擎,ES5 语法)。%SPEC% 在编译时替换为 JSON。
// 与冻结的 tbsite_compile.py 同源;修改脚本文本会影响 parity 测试。

export const AGG_JS = `
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

/** 带前缀站点用的窗口聚合脚本:输出 key = spec.pfx + 测点 + 后缀(ADR-003);无前缀站点仍用 AGG_JS,parity 不受影响 */
export const AGG_JS_PREFIXED = AGG_JS.replace(
  'if (v.length) out[k + suffix]',
  "if (v.length) out[(spec.pfx || '') + k + suffix]"
)

export const CASCADE_JS = `
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

export const REVENUE_JS = `
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

export const ROLLUP_TICK_JS =
  "var msg = {}; var metadata = { rollup: 'true' }; var msgType = 'ROLLUP_TICK'; return { msg: msg, metadata: metadata, msgType: msgType };"
export const CASCADE_TICK_JS = "return { msg: {}, metadata: { cascade: 'true' }, msgType: 'CASCADE_TICK' };"
export const REVENUE_TICK_JS = "return { msg: {}, metadata: { revenue: 'true' }, msgType: 'REVENUE_TICK' };"
/** 当日累计口径:每拍算出「东八区今日 0 点」作为取数窗口起点,输出今日累计(零点自动归零) */
export const REVENUE_DAILY_TICK_JS =
  'var now = Date.now(); var tz = 8 * 3600000; ' +
  'var dayStart = Math.floor((now + tz) / 86400000) * 86400000 - tz; ' +
  "return { msg: {}, metadata: { revenueDaily: 'true', dayStartTs: String(dayStart), dayEndTs: String(now) }, msgType: 'REVENUE_DAILY_TICK' };"

export const withSpec = (script: string, spec: unknown) => script.replace('%SPEC%', JSON.stringify(spec))
