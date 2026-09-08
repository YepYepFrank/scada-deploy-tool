// 写入器依赖的 TB REST 抽象:与向导里的 api(url, data, method) 同签名,可 mock。
// GET 无 body;有 data 默认 POST;DELETE 显式传 method。

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type TbApi = (url: string, data?: unknown, method?: 'GET' | 'POST' | 'DELETE') => Promise<any>

export type StepId =
  'validate' | 'devices' | 'cf' | 'agg' | 'revenue' | 'rollup' | 'alarm' | 'asset' | 'health' | 'cleanup'
export type StepStatus = 'run' | 'ok' | 'err'
export type Reporter = (step: StepId, status: StepStatus, detail?: string) => void

export interface PublishFailure {
  step: StepId
  device?: string
  output?: string
  error: string
}

/** 只重发上次失败项:不在 steps 里的步骤直接跳过(所有写入幂等,重跑也安全) */
export interface RetryScope {
  steps: StepId[]
  cf?: { device: string; output: string }[]
  agg?: string[]
}

const q = (s: string) => encodeURIComponent(s)

export async function findDevice(api: TbApi, name: string) {
  const page = await api(`/api/tenant/devices?pageSize=100&page=0&textSearch=${q(name)}`)
  return (page?.data || []).find((d: { name: string }) => d.name === name) ?? null
}

/** 名称 → 设备 id;缺失的名字放进 missing */
export async function resolveDeviceIds(api: TbApi, names: string[]) {
  const devIds: Record<string, string> = {}
  const missing: string[] = []
  for (const name of names) {
    const d = await findDevice(api, name)
    if (d) devIds[name] = d.id.id
    else missing.push(name)
  }
  return { devIds, missing }
}

export async function findAsset(api: TbApi, name: string) {
  const page = await api(`/api/tenant/assets?pageSize=100&page=0&textSearch=${q(name)}`)
  return (page?.data || []).find((a: { name: string }) => a.name === name) ?? null
}

/** 按名找资产,没有则建;返回 {id, created} */
export async function ensureAsset(api: TbApi, name: string, type: string): Promise<{ id: string; created: boolean }> {
  const found = await findAsset(api, name)
  if (found) return { id: found.id.id, created: false }
  const created = await api('/api/asset', { name, type })
  return { id: created.id.id, created: true }
}

export async function ensureChain(api: TbApi, name: string): Promise<{ id: string; created: boolean }> {
  const page = await api(`/api/ruleChains?pageSize=100&page=0&textSearch=${q(name)}`)
  const found = (page?.data || []).find((c: { name: string }) => c.name === name)
  if (found) return { id: found.id.id, created: false }
  const created = await api('/api/ruleChain', { name, type: 'CORE', debugMode: false, root: false })
  return { id: created.id.id, created: true }
}

export const listCfs = async (api: TbApi, entityType: 'DEVICE' | 'ASSET', id: string) =>
  ((await api(`/api/${entityType}/${id}/calculatedFields?pageSize=100&page=0`))?.data || []) as {
    id: { id: string }
    name: string
  }[]
