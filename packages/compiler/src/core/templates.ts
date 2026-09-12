// 设备模板展开(tbsite/v2):模板 = 选择器(profiles / prefixes)+ 一组不绑定具体设备的运算项。
// 对每台匹配且具备所需测点的已认领设备实例化;告警项跨设备合并为一条规则(devices 列表)。
import type { Computation, DeviceDecl, Selector, TbsiteConfig } from '../types'

export function matchSelector(dev: DeviceDecl, sel: Selector): boolean {
  if (sel.profiles?.length && !sel.profiles.includes((dev.profile || dev.type) as string)) return false
  if (sel.prefixes?.length && !sel.prefixes.some(p => p && dev.name.startsWith(p))) return false
  return true
}

/** 运算项需要设备具备的测点 */
export function itemKeys(item: Computation): string[] {
  if (item.template === 'alarm.threshold') return [item.key as string]
  if (item.template === 'window.aggregate' || item.template === 'window.cascade') return item.keys || []
  if (item.template === 'expr.add' || item.template === 'expr.subtract')
    return Object.values(item.inputs || {}).map(r => r.key)
  return [item.key as string]
}

const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x))
const hasKey = (d: DeviceDecl, k: string) => (d.keys || []).some(x => x.key === k)

export function expandTemplates(cfg: TbsiteConfig): { computations: Computation[]; notes: string[] } {
  const out: Computation[] = []
  const notes: string[] = []
  for (const t of cfg.deviceTemplates || []) {
    const matched = (cfg.devices || []).filter(d => matchSelector(d, t.selector || {}))
    if (!matched.length) {
      notes.push(`模板「${t.name}」没有匹配到任何已认领设备`)
      continue
    }
    for (const item of t.items || []) {
      const need = itemKeys(item)
      const capable = matched.filter(d => need.every(k => hasKey(d, k)))
      const skipped = matched.length - capable.length
      if (skipped > 0)
        notes.push(`模板「${t.name}」·「${item.name || item.output || item.key}」:${skipped} 台设备缺少所需测点,已跳过`)
      if (!capable.length) continue
      if (item.template === 'alarm.threshold' || item.template === 'alarm.switch') {
        out.push({ ...clone(item), device: capable[0]!.name, devices: capable.map(d => d.name), _tpl: t.name })
      } else if (item.template === 'expr.add' || item.template === 'expr.subtract') {
        for (const d of capable)
          out.push({
            template: item.template,
            device: d.name,
            output: item.output,
            _tpl: t.name,
            inputs: Object.fromEntries(
              Object.entries(item.inputs || {}).map(([p, r]) => [p, { device: d.name, key: r.key }])
            ),
          })
      } else {
        for (const d of capable) out.push({ ...clone(item), device: d.name, _tpl: t.name })
      }
    }
  }
  return { computations: out, notes }
}
