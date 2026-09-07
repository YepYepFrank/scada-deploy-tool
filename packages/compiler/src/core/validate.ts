import type { TbsiteConfig } from '../types'
import { MAX_AGG_MEMBERS } from './constants'
import { resolveAggMembers } from './aggregate'

/** 配置校验:返回错误清单,空即通过。只看结构与引用,不查 TB。 */
export function validateConfig(cfg: TbsiteConfig): string[] {
  const errs: string[] = []
  if (cfg.schema !== 'tbsite/v1' && cfg.schema !== 'tbsite/v2') errs.push("schema 必须为 'tbsite/v1' 或 'tbsite/v2'")
  if (!cfg.site?.name) errs.push('站点标识不能为空')
  if (!cfg.devices?.length) errs.push('至少认领一台设备')
  if (
    cfg.outputPrefix !== undefined &&
    (typeof cfg.outputPrefix !== 'string' || !/^[A-Za-z][A-Za-z0-9_]*$/.test(cfg.outputPrefix))
  )
    errs.push("outputPrefix 须为字母开头的英文标识(如 'calc_')")
  for (const [i, t] of (cfg.deviceTemplates || []).entries()) {
    if (!t.name) errs.push(`设备模板 #${i + 1}: 缺少名称`)
    const sel = t.selector || {}
    if (!sel.profiles?.length && !sel.prefixes?.length)
      errs.push(`设备模板「${t.name || i + 1}」: 选择器为空(需指定类型或名称前缀)`)
  }
  const names = new Set((cfg.devices || []).map(d => d.name))
  for (const [i, c] of (cfg.computations || []).entries()) {
    const w = `运算 #${i + 1} (${c.template})`
    if (c.template === 'revenue.periodic') {
      for (const fld of ['charge', 'discharge'] as const) {
        const ref = c[fld]
        if (!ref?.device || !ref?.key) errs.push(`${w}: 缺少${fld === 'charge' ? '充' : '放'}电量测点`)
        else if (!names.has(ref.device)) errs.push(`${w}: ${ref.device} 未认领`)
      }
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
      if (!['sum', 'avg'].includes(c.agg as string)) errs.push(`${w}: 聚合方式必须是 sum/avg`)
      const members = resolveAggMembers(cfg, c)
      if (!members.length) errs.push(`${w}: 没有匹配到任何具备测点 ${c.key} 的已认领设备`)
      if (members.length > MAX_AGG_MEMBERS)
        errs.push(`${w}: 成员 ${members.length} 台超过上限 ${MAX_AGG_MEMBERS},请按前缀拆成多个汇聚`)
      continue
    }
    if (!names.has(c.device as string)) errs.push(`${w}: 设备未认领`)
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
