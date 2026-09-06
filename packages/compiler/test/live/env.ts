// live 用例公用:凭据只从环境变量 / 向上找到的 .env.local 读(TB_BASE / TB_USER / TB_PASSWORD),不入库、不打印。
import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import type { TbApi } from '../../src/index'

function loadDotEnv() {
  let dir = resolve(__dirname)
  for (let i = 0; i < 8; i++) {
    const f = resolve(dir, '.env.local')
    if (existsSync(f)) {
      for (const line of readFileSync(f, 'utf8').split(/\r?\n/)) {
        const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line)
        if (m && !(m[1]! in process.env)) process.env[m[1]!] = m[2]!.replace(/^["']|["']$/g, '')
      }
      return f
    }
    const up = dirname(dir)
    if (up === dir) break
    dir = up
  }
  return null
}
loadDotEnv()

export const TB_BASE = process.env.TB_BASE || 'http://192.168.20.61:8080'
export const TB_USER = process.env.TB_USER || ''
const TB_PASSWORD = process.env.TB_PASSWORD || ''
/** 没凭据时整组用例 skip(而不是失败),便于在没 .env.local 的机器上也能 `test:live` 不报错 */
export const hasCreds = !!(TB_USER && TB_PASSWORD)

/** 登录并返回与写入器同签名的 TbApi;token 只在闭包里 */
export async function makeApi(): Promise<TbApi> {
  let token = ''
  const api: TbApi = async (url, data, method) => {
    const m = method ?? (data === undefined ? 'GET' : 'POST')
    const r = await fetch(TB_BASE + url, {
      method: m,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { 'X-Authorization': `Bearer ${token}` } : {}),
      },
      body: data === undefined || data === null ? undefined : JSON.stringify(data),
    })
    const t = await r.text()
    if (!r.ok) throw new Error(`${m} ${url.split('?')[0]} → HTTP ${r.status} ${t.slice(0, 300)}`)
    return t ? JSON.parse(t) : null
  }
  token = (await api('/api/auth/login', { username: TB_USER, password: TB_PASSWORD })).token
  return api
}

export interface ChainSnap {
  id: string
  name: string
  nodes: number
  connections: number
}
export interface SiteSnapshot {
  /** 站点资产 id(不存在为 null) */
  asset: string | null
  /** 名字含 site 的规则链(名 → id / 节点数) */
  chains: ChainSnap[]
  /** Root 链上本站点转发节点是否存在 */
  rootFlow: boolean
  /** Root 链节点总数 */
  rootNodes: number
  /** 各设备上的 CF(name → id) */
  cfs: Record<string, Record<string, string>>
}

/** 读取一个站点在 TB 上的现状,用于「前后零差异」与幂等断言 */
export async function snapshotSite(api: TbApi, site: string, devIds: Record<string, string>): Promise<SiteSnapshot> {
  const page = await api('/api/ruleChains?pageSize=200&page=0')
  const chains: { id: { id: string }; name: string; root?: boolean }[] = page?.data ?? []
  const root = chains.find(c => c.root)
  const rootMeta = root ? await api(`/api/ruleChain/${root.id.id}/metadata`) : { nodes: [] }
  const ours: ChainSnap[] = []
  for (const c of chains.filter(c => !c.root && c.name.endsWith(`· ${site}`))) {
    const m = await api(`/api/ruleChain/${c.id.id}/metadata`)
    ours.push({ id: c.id.id, name: c.name, nodes: m.nodes?.length ?? 0, connections: m.connections?.length ?? 0 })
  }
  ours.sort((a, b) => a.name.localeCompare(b.name))
  const assets: { id: { id: string }; name: string }[] =
    (await api(`/api/tenant/assets?pageSize=50&page=0&textSearch=${encodeURIComponent(site)}`))?.data ?? []
  const asset = assets.find(a => a.name === site)?.id.id ?? null
  const cfs: Record<string, Record<string, string>> = {}
  for (const [dev, id] of Object.entries(devIds)) {
    const list: { id: { id: string }; name: string }[] =
      (await api(`/api/DEVICE/${id}/calculatedFields?pageSize=100&page=0`))?.data ?? []
    cfs[dev] = Object.fromEntries(list.map(f => [f.name, f.id.id]))
  }
  return {
    asset,
    chains: ours,
    rootFlow: (rootMeta.nodes as { name: string }[]).some(n => n.name === `site alarms flow · ${site}`),
    rootNodes: rootMeta.nodes?.length ?? 0,
    cfs,
  }
}
