// 同构测试:TS 版 compile() 与冻结的 Python 版(tbsite_compile.py --plan-json)对同一份站点声明
// 生成的写入计划,规范化后 deepEqual。快照由 scripts/regen-python-plans.mjs 生成并入库,CI 不需要 Python。
//
// 规范化说明(两边都做):
//   · 去掉节点坐标(additionalInfo)与 TS 版独有的 _tpl;
//   · 规则链元数据改成与节点顺序无关的形式:节点按内容排序,连线改写为 [起点节点, 类型, 终点节点];
//     (Python 版先放分组流水线再放级联,JS/TS 版相反,两边节点下标不同但图相同)
//   · 嵌入 JS 脚本去掉 // 注释、压缩空白、去掉 JSON 分隔符后的空格(json.dumps 与 JSON.stringify 不同);
//     latestTsKeyNames 排序(Python 版用 sorted(set))。
// 已知且接受的 Python 版差异(只在读取快照时改写,TS 版行为以 publisher.js 为准):
//   · 告警建 / 清节点名 Python 用测点名,JS/TS 用告警名(alarmType);
//   · 收益链切换资产节点 Python 叫「切到资产 X」,JS/TS 叫「切到电价资产 / 切到收益资产」;
//   · 展开提示文案措辞不同,只比较条数。
import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { compile, placeholderIds, type RuleChainMetadata, type TbsiteConfig, type WritePlan } from '../src/index'

const fixtures = resolve(__dirname, 'fixtures')
const load = (f: string) => JSON.parse(readFileSync(resolve(fixtures, f), 'utf8'))

type Json = null | boolean | number | string | Json[] | { [k: string]: Json }

const stripJs = (s: string) =>
  s
    .split('\n')
    .map(l => l.replace(/(^|\s)\/\/.*$/, '').trim())
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    // Python json.dumps 默认 ", " / ": ",JSON.stringify 无空格
    .replace(/,\s/g, ',')
    .replace(/:\s/g, ':')

function normalize(v: Json, key = ''): Json {
  if (Array.isArray(v)) {
    const arr = v.map(x => normalize(x))
    return key === 'latestTsKeyNames' ? (arr as string[]).sort() : arr
  }
  if (v && typeof v === 'object') {
    const o: { [k: string]: Json } = {}
    for (const k of Object.keys(v).sort()) {
      if (k === 'additionalInfo' || k === '_tpl') continue
      o[k] = normalize(v[k]!, k)
    }
    return o
  }
  if (typeof v === 'string' && (key === 'jsScript' || key === 'alarmDetailsBuildJs')) return stripJs(v)
  return v
}

/** 规则链元数据 → 与下标无关的图 */
function graph(meta: RuleChainMetadata | null) {
  if (!meta) return null
  const canon = meta.nodes.map(n =>
    JSON.stringify(normalize({ type: n.type, name: n.name, configuration: n.configuration as Json }))
  )
  return {
    ruleChainId: meta.ruleChainId,
    first: meta.firstNodeIndex === null ? null : canon[meta.firstNodeIndex],
    nodes: [...canon].sort(),
    edges: meta.connections.map(c => `${canon[c.fromIndex]} -[${c.type}]-> ${canon[c.toIndex]}`).sort(),
  }
}

function canonPlan(p: WritePlan) {
  return normalize({
    site: p.site,
    validation: { errors: p.validation.errors, noteCount: p.validation.notes.length },
    computations: p.computations,
    cfs: p.cfs,
    aggregates: p.aggregates,
    revenue: p.revenue && {
      chainName: p.revenue.chainName,
      assets: p.revenue.assets,
      items: p.revenue.items,
      graph: graph(p.revenue.metadata),
    },
    rollup: p.rollup && {
      chainName: p.rollup.chainName,
      groups: p.rollup.groups,
      cascades: p.rollup.cascades,
      graph: graph(p.rollup.metadata),
    },
    alarm: p.alarm && {
      chainName: p.alarm.chainName,
      rootFlowName: p.alarm.rootFlowName,
      items: p.alarm.items,
      graph: graph(p.alarm.metadata),
    },
    siteAsset: p.siteAsset,
  } as unknown as Json)
}

/** 读取 Python 快照并套用已知差异改写 */
function pythonPlan(name: string): WritePlan {
  const f = resolve(fixtures, `${name}.plan.py.json`)
  if (!existsSync(f)) throw new Error(`缺少快照 ${f}:请运行 pnpm -F @grid/tbsite-compiler regen:py-plans`)
  const p = JSON.parse(readFileSync(f, 'utf8')) as WritePlan
  if (p.alarm)
    for (const n of p.alarm.metadata.nodes) {
      const t = n.configuration.alarmType as string | undefined
      if (t && n.name.startsWith('告警: ')) n.name = `告警: ${t}`
      if (t && n.name.startsWith('清除: ')) n.name = `清除: ${t}`
    }
  if (p.revenue) {
    const priceAssets = new Set(p.revenue.items.map(c => c.priceAsset))
    for (const n of p.revenue.metadata.nodes)
      if (n.name.startsWith('切到资产 '))
        n.name = priceAssets.has(n.configuration.entityNamePattern as string) ? '切到电价资产' : '切到收益资产'
  }
  return p
}

/** 只列出不一致的路径(前 12 条),失败信息比整棵树好读 */
function diffPaths(a: Json, b: Json, path = '$', out: string[] = []): string[] {
  if (out.length >= 12) return out
  const short = (v: Json) => {
    const s = JSON.stringify(v)
    return s === undefined ? 'undefined' : s.length > 160 ? s.slice(0, 160) + '…' : s
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) out.push(`${path}: 长度 ts=${a.length} py=${b.length}`)
    for (let i = 0; i < Math.min(a.length, b.length); i++) diffPaths(a[i]!, b[i]!, `${path}[${i}]`, out)
    return out
  }
  if (a && b && typeof a === 'object' && typeof b === 'object' && !Array.isArray(a) && !Array.isArray(b)) {
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
      if (!(k in a)) out.push(`${path}.${k}: 只在 py:${short(b[k]!)}`)
      else if (!(k in b)) out.push(`${path}.${k}: 只在 ts:${short(a[k]!)}`)
      else diffPaths(a[k]!, b[k]!, `${path}.${k}`, out)
    }
    return out
  }
  if (JSON.stringify(a) !== JSON.stringify(b)) out.push(`${path}: ts=${short(a)} py=${short(b)}`)
  return out
}

describe('parity:TS 版 vs Python 版写入计划', () => {
  for (const name of ['demo-site', 'xrs-mirror-test']) {
    it(name, () => {
      const cfg = load(`${name}.tbsite.json`) as TbsiteConfig
      const ts = compile(cfg, placeholderIds(cfg))
      const py = pythonPlan(name)
      expect(ts.validation.errors).toEqual([])
      const a = canonPlan(ts)
      const b = canonPlan(py)
      expect(diffPaths(a, b)).toEqual([])
      expect(a).toEqual(b)
    })
  }

  it('计划里没有真实 id:全部是占位串', () => {
    const cfg = load('xrs-mirror-test.tbsite.json') as TbsiteConfig
    const { siteAsset: _site, ...rest } = compile(cfg) // 站点资产里存的是原始声明(向导保存时带 tbId),不在此列
    const text = JSON.stringify(rest)
    expect(text).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/)
    expect(text).toMatch(/"dev:/)
    expect(text).toMatch(/"chain:Site Revenue/)
  })
})
