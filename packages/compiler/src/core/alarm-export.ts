// ADR-001 决定 3(二期导出):把站点声明里的阈值告警导出成同事的 JSON 格式——
// 「告警模板数组」+「告警设备清单」,写入目标是资产 JIZHAN_ALARM_CONFIG 的服务端属性(第三轮回填)。
// 纯函数:不连网;entityId / labelName 由调用方按需传入(CLI 连 TB 后解析)。
import type { Computation, TbsiteConfig } from '../types'
import { OP_JS } from './constants'

/** 同事的告警模板(第二轮回填 1.3 样例的字段,原样) */
export interface JizhanAlarmTemplate {
  title: string
  alarm_severity: string
  operator: string
  key: string
  value: number
}
/** 同事的告警设备清单条目(「用于根据省级 / 站点级订阅告警设备」) */
export interface JizhanAlarmDevice {
  entityId: string
  entityName: string
  labelName: string
}
export interface AlarmExport {
  alarm_config: JizhanAlarmTemplate[]
  alarm_devices: JizhanAlarmDevice[]
  /** 两套格式对不上的地方(只提示,不阻塞) */
  notes: string[]
}

/** 写入目标(高潮 2026-09-06:「资产名 JIZHAN_ALARM_CONFIG,服务端属性 alarm_config,如果没有新建」) */
export const ALARM_CONFIG_ASSET = 'JIZHAN_ALARM_CONFIG'
export const ALARM_CONFIG_ATTR = 'alarm_config'
/** 设备清单属性名来自他们的 KEY 清单(alarm_config / alarm_devices / base_info) */
export const ALARM_DEVICES_ATTR = 'alarm_devices'

export interface AlarmExportOptions {
  /** 设备名 → TB id;没给的设备 entityId 留空并记 note */
  deviceIds?: Record<string, string>
  /** 设备名 → TB label;没给时用站点声明里的 label,再退回设备名 */
  labels?: Record<string, string>
}

const devicesOf = (a: Computation): string[] => (a.devices?.length ? a.devices : a.device ? [a.device] : [])

export function exportAlarmConfig(
  cfg: TbsiteConfig,
  computations: Computation[],
  opts: AlarmExportOptions = {}
): AlarmExport {
  const alarms = computations.filter(c => c.template === 'alarm.threshold' && c.key && c.condition)
  const notes: string[] = []
  const alarm_config: JizhanAlarmTemplate[] = []
  const seen = new Set<string>()
  const deviceOrder: string[] = []
  const perRuleDevices: { title: string; devices: string[] }[] = []
  for (const a of alarms) {
    const key = a.key as string
    const operator = OP_JS[a.condition!.op]
    const value = a.condition!.value
    const title = a.name || `${key} ${operator} ${value}`
    const tpl: JizhanAlarmTemplate = { title, alarm_severity: a.severity || 'WARNING', operator, key, value }
    const sig = JSON.stringify(tpl)
    if (!seen.has(sig)) {
      seen.add(sig)
      alarm_config.push(tpl)
    }
    const devs = devicesOf(a)
    perRuleDevices.push({ title, devices: devs })
    for (const d of devs) if (!deviceOrder.includes(d)) deviceOrder.push(d)
    if (a.trigger === 'edge')
      notes.push(`「${title}」是边沿触发(值变了才报一次);同事格式没有这个字段,由他们的判定节点决定`)
    if (a.message) notes.push(`「${title}」的文案「${a.message}」同事格式不带,已省略`)
  }
  const declLabel = (name: string) => {
    const d = cfg.devices.find(x => x.name === name)
    const l = d && typeof d.label === 'string' ? d.label : ''
    return l
  }
  const alarm_devices: JizhanAlarmDevice[] = deviceOrder.map(name => ({
    entityId: opts.deviceIds?.[name] ?? '',
    entityName: name,
    labelName: opts.labels?.[name] || declLabel(name) || name,
  }))
  const noId = alarm_devices.filter(d => !d.entityId).map(d => d.entityName)
  if (noId.length)
    notes.push(`${noId.length} 台设备没有 TB id(离线导出):${noId.slice(0, 5).join(', ')}${noId.length > 5 ? ' …' : ''}`)
  // 同事格式是「模板 × 设备清单」全乘:某条规则只覆盖部分设备时,他们那边会对清单里所有设备生效
  const union = new Set(deviceOrder)
  for (const r of perRuleDevices)
    if (r.devices.length && r.devices.length !== union.size)
      notes.push(
        `「${r.title}」只声明在 ${r.devices.length}/${union.size} 台设备上;同事格式会对清单里全部 ${union.size} 台生效`
      )
  if (!alarms.length) notes.push('站点声明里没有阈值告警,导出为空')
  return { alarm_config, alarm_devices, notes }
}
