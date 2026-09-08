// 把 exportAlarmConfig 的结果写到 TB:资产 JIZHAN_ALARM_CONFIG(没有则建)的 SERVER_SCOPE 属性
// alarm_config / alarm_devices。这是同事的资产 / 他们的引擎读的属性,所以默认不覆盖已有内容(--force 才覆盖,并返回旧值供备份)。
import { ALARM_CONFIG_ASSET, ALARM_CONFIG_ATTR, ALARM_DEVICES_ATTR, type AlarmExport } from '../core/alarm-export'
import { ensureAsset, type TbApi } from './api'

export interface WriteAlarmConfigOptions {
  assetName?: string
  /** 新建资产时的 type;同事没说,默认 default */
  assetType?: string
  /** 已有非空 alarm_config 时是否覆盖 */
  force?: boolean
}
export type WriteAlarmConfigResult =
  | { ok: true; assetId: string; created: boolean; previous: Record<string, unknown> | null }
  | { ok: false; reason: 'exists'; assetId: string; existing: Record<string, unknown> }

const nonEmpty = (v: unknown) => {
  if (v == null) return false
  if (typeof v === 'string') return v.trim() !== '' && v.trim() !== '[]'
  if (Array.isArray(v)) return v.length > 0
  return true
}

export async function writeAlarmConfig(
  api: TbApi,
  exp: AlarmExport,
  opts: WriteAlarmConfigOptions = {}
): Promise<WriteAlarmConfigResult> {
  const name = opts.assetName || ALARM_CONFIG_ASSET
  const { id, created } = await ensureAsset(api, name, opts.assetType || 'default')
  const attrs: { key: string; value: unknown }[] =
    (await api(
      `/api/plugins/telemetry/ASSET/${id}/values/attributes/SERVER_SCOPE?keys=${ALARM_CONFIG_ATTR},${ALARM_DEVICES_ATTR}`
    )) || []
  const existing: Record<string, unknown> = {}
  for (const a of attrs) existing[a.key] = a.value
  if (nonEmpty(existing[ALARM_CONFIG_ATTR]) && !opts.force)
    return { ok: false, reason: 'exists', assetId: id, existing }
  await api(`/api/plugins/telemetry/ASSET/${id}/attributes/SERVER_SCOPE`, {
    [ALARM_CONFIG_ATTR]: exp.alarm_config,
    [ALARM_DEVICES_ATTR]: exp.alarm_devices,
  })
  return { ok: true, assetId: id, created, previous: Object.keys(existing).length ? existing : null }
}
