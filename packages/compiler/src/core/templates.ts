// 设备模板展开(tbsite/v2):模板 = 选择器(profiles / prefixes)+ 一组不绑定具体设备的运算项。
// 对每台匹配且具备所需测点的已认领设备实例化;告警项跨设备合并为一条规则(devices 列表)。
import type { Computation, DeviceDecl, Selector, TbsiteConfig } from '../types'
import { isCfTemplate } from './constants'

export function matchSelector(dev: DeviceDecl, sel: Selector): boolean {
  if (sel.profiles?.length && !sel.profiles.includes((dev.profile || dev.type) as string)) return false
  if (sel.prefixes?.length && !sel.prefixes.some(p => p && dev.name.startsWith(p))) return false
  return true
}

/** 运算项需要设备具备的测点 */
export function itemKeys(item: Computation): string[] {
  if (item.template === 'alarm.threshold') return [item.key as string]
  if (item.template === 'window.aggregate' || item.template === 'window.cascade') return item.keys || []
  // 属性输入不要求设备有同名遥测(属性不在第 2 步认领的测点里;平台上没有这个属性时运算不出数)
  if (item.template === 'expr.add' || item.template === 'expr.subtract')
    return Object.values(item.inputs || {})
      .filter(r => !r.attr)
      .map(r => r.key)
  return [item.key as string]
}

const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x))
const hasKey = (d: DeviceDecl, k: string) => (d.keys || []).some(x => x.key === k)

/** 输出写在设备上的运算项给出的 key(显式 output:即时计算 / 差值 / 积分;派生名不算) */
const deviceOutput = (item: Computation): string | undefined =>
  (isCfTemplate(item.template) || item.template === 'window.delta' || item.template === 'window.integrate') &&
  typeof item.output === 'string' &&
  item.output &&
  !item.asset
    ? item.output
    : undefined

/**
 * 每台设备上「将会有」的运算结果 key(2026-10-10:模板里的运算可以拿别的运算的结果当输入,
 * 如先算 pqSum、再对 pqSum 设阈值告警)。手工运算直接算;模板项按自身所需测点判断能不能落到这台设备,
 * 落得下就把输出记上,反复几轮直到不再增加(模板之间可以接力)。原名与加前缀的名字都记,引用写哪个都认。
 */
function plannedOutputs(cfg: TbsiteConfig, prefix: string): Map<string, Set<string>> {
  const outs = new Map<string, Set<string>>()
  const add = (dev: string, k: string) => {
    const set = outs.get(dev) ?? new Set<string>()
    set.add(k)
    if (prefix && !k.startsWith(prefix)) set.add(prefix + k)
    outs.set(dev, set)
  }
  for (const c of cfg.computations || []) {
    const k = deviceOutput(c)
    if (k && typeof c.device === 'string') add(c.device, k)
  }
  for (let round = 0; round < 5; round++) {
    let grew = false
    for (const t of cfg.deviceTemplates || []) {
      const matched = (cfg.devices || []).filter(d => matchSelector(d, t.selector || {}))
      for (const item of t.items || []) {
        const k = deviceOutput(item)
        if (!k) continue
        for (const d of matched)
          if (!outs.get(d.name)?.has(k) && itemKeys(item).every(n => hasKey(d, n) || outs.get(d.name)?.has(n))) {
            add(d.name, k)
            grew = true
          }
      }
    }
    if (!grew) break
  }
  return outs
}

export function expandTemplates(cfg: TbsiteConfig): { computations: Computation[]; notes: string[] } {
  const out: Computation[] = []
  const notes: string[] = []
  const prefix = typeof cfg.outputPrefix === 'string' ? cfg.outputPrefix : ''
  const planned = plannedOutputs(cfg, prefix)
  const has = (d: DeviceDecl, k: string) => hasKey(d, k) || !!planned.get(d.name)?.has(k)
  for (const t of cfg.deviceTemplates || []) {
    const matched = (cfg.devices || []).filter(d => matchSelector(d, t.selector || {}))
    if (!matched.length) {
      notes.push(`模板「${t.name}」没有匹配到任何已认领设备`)
      continue
    }
    for (const item of t.items || []) {
      const need = itemKeys(item)
      const capable = matched.filter(d => need.every(k => has(d, k)))
      const skipped = matched.length - capable.length
      if (skipped > 0)
        notes.push(`模板「${t.name}」·「${item.name || item.output || item.key}」:${skipped} 台设备缺少所需测点,已跳过`)
      if (!capable.length) continue
      if (item.template === 'alarm.threshold' || item.template === 'alarm.switch') {
        // 同级别的设备合成一条规则;severityByDevice 单独设了级别的拆出去(告警名不变,TB 按设备 + 告警名区分告警)
        const { severityByDevice: byDev, ...rest } = clone(item)
        const bySev = new Map<string, string[]>()
        for (const d of capable) {
          const sev = byDev?.[d.name] || rest.severity || ''
          bySev.set(sev, [...(bySev.get(sev) ?? []), d.name])
        }
        for (const [sev, devs] of bySev)
          out.push({ ...rest, ...(sev ? { severity: sev } : {}), device: devs[0]!, devices: devs, _tpl: t.name })
      } else if (item.template === 'expr.add' || item.template === 'expr.subtract') {
        for (const d of capable)
          out.push({
            template: item.template,
            device: d.name,
            output: item.output,
            _tpl: t.name,
            inputs: Object.fromEntries(
              Object.entries(item.inputs || {}).map(([p, r]) => [
                p,
                { device: d.name, key: r.key, ...(r.attr ? { attr: r.attr } : {}) },
              ])
            ),
          })
      } else {
        for (const d of capable) out.push({ ...clone(item), device: d.name, _tpl: t.name })
      }
    }
  }
  return { computations: out, notes }
}
