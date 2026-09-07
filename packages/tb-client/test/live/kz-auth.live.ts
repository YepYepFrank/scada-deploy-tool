// live:kz `tskv/**` 的 token 校验(联调环境待办 ⑤)。
// 2026-09-07 实测 tskv/** 只判 header 非空(biz/** 正常);高潮同日确认是配置错误、会改成与 /biz 相同策略。
// 修复前这组必然红,所以只在 KZ_AUTH_FIXED=1 时跑:KZ_AUTH_FIXED=1 pnpm -F @grid/tb-client test:live
import { beforeAll, describe, expect, it } from 'vitest'
import { LegacyDataSource } from '../../src/index'
import { entityId, hasCreds, KZ_BASE, loginToken, MIRROR, TB_BASE } from './env'

const enabled = hasCreds && process.env.KZ_AUTH_FIXED === '1'

describe.skipIf(!enabled)(`kz tskv/** 鉴权(live @ ${KZ_BASE},KZ_AUTH_FIXED=1)`, () => {
  let ied: { type: 'DEVICE'; id: string }
  let token: string
  const query = () => ({ source: 'kz' as const, window: '1h' as const, interval: '1m' as const, params: { entity: ied, keys: ['P'] } })
  const ds = (getToken: () => string) => new LegacyDataSource({ baseUrl: TB_BASE, getToken, kzBaseUrl: KZ_BASE })

  beforeAll(async () => {
    token = await loginToken()
    ied = { type: 'DEVICE', id: await entityId(token, 'DEVICE', MIRROR.ied) }
  })

  it('有效租户 token → 正常返回', async () => {
    const r = await ds(() => token).ext(query())
    expect(r.series.P!.length).toBeGreaterThan(0)
  })

  it('非 JWT 的假 token → 拒绝(与 biz/** 一致:code 401 token失效)', async () => {
    await expect(ds(() => 'nope').ext(query())).rejects.toThrow(/token|401/i)
  })

  it('篡改 payload + 假签名的 JWT → 拒绝', async () => {
    const [h] = token.split('.')
    const payload = Buffer.from(JSON.stringify({ sub: 'x', scopes: ['TENANT_ADMIN'], exp: 4102444800 })).toString('base64url')
    const forged = `${h}.${payload}.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA`
    await expect(ds(() => forged).ext(query())).rejects.toThrow(/token|401/i)
  })

  it('过期 JWT(原签名,exp 改到 2001)→ 拒绝', async () => {
    const [h, p, s] = token.split('.')
    const body = JSON.parse(Buffer.from(p!, 'base64url').toString('utf8')) as Record<string, unknown>
    body.exp = 1_000_000_000
    const expired = `${h}.${Buffer.from(JSON.stringify(body)).toString('base64url')}.${s}`
    await expect(ds(() => expired).ext(query())).rejects.toThrow(/token|401/i)
  })

  // 第二步(按实体归属过滤:客户 token 读未分配的设备应被拒)高潮未承诺,先记 todo
  it.todo('客户 token 读未分配给它的设备 → 拒绝(实体归属过滤)')
})
