// live 用例公用:凭据只从环境变量 / 向上找到的 .env.local 读(TB_BASE / TB_USER / TB_PASSWORD / KZ_BASE),不入库、不打印。
import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

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
/** kz 扩展服务:与 TB 同机 8099(第三轮回填);路径 /kzserver 由 LegacyDataSource 拼 */
export const KZ_BASE = process.env.KZ_BASE || TB_BASE.replace(/:\d+$/, ':8099')
export const TB_USER = process.env.TB_USER || ''
const TB_PASSWORD = process.env.TB_PASSWORD || ''
/** 没凭据时整组用例 skip(而不是失败) */
export const hasCreds = !!(TB_USER && TB_PASSWORD)

/** 登录拿 JWT;token 只在返回值里,不打印 */
export async function loginToken(): Promise<string> {
  const r = await fetch(`${TB_BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: TB_USER, password: TB_PASSWORD }),
  })
  if (!r.ok) throw new Error(`登录失败 HTTP ${r.status}`)
  return ((await r.json()) as { token: string }).token
}

/** 镜像上的固定实体(docs/联调环境.md §3):按名查 id,换站点时改这里 */
export const MIRROR = {
  ied: 'SSP1_GP1_IED1',
  aggAsset: 'xrs-mirror-test-agg',
  /** 基站储能项目1(kz 收益趋势接口的 stationId,旧 siteConfig 的报表槽位用过) */
  revenueStationId: '84a690c0-7381-11f1-8007-51b9f7714bbe',
}

export async function entityId(token: string, type: 'DEVICE' | 'ASSET', name: string): Promise<string> {
  const url =
    type === 'DEVICE'
      ? `${TB_BASE}/api/tenant/devices?deviceName=${encodeURIComponent(name)}`
      : `${TB_BASE}/api/tenant/assets?assetName=${encodeURIComponent(name)}`
  const r = await fetch(url, { headers: { 'X-Authorization': `Bearer ${token}` } })
  if (!r.ok) throw new Error(`${type} ${name} → HTTP ${r.status}`)
  return ((await r.json()) as { id: { id: string } }).id.id
}
