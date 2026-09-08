// live:kz `tskv/**` 的 token 校验(联调环境待办 ⑤)。
// 2026-09-07 实测 tskv/** 只判 header 非空(biz/** 正常);高潮改成与 /biz 相同策略,2026-09-08 新 jar 部署到镜像后本组 4/4 通过。
// 现在随 test:live 常跑;若现场 kz 是旧版本,这组会红——那就是部署错了版本。
import { beforeAll, describe, expect, it } from 'vitest'
import { LegacyDataSource } from '../../src/index'
import { entityId, hasCreds, KZ_BASE, loginToken, MIRROR, TB_BASE } from './env'

describe.skipIf(!hasCreds)(`kz tskv/** 鉴权(live @ ${KZ_BASE})`, () => {
  let ied: { type: 'DEVICE'; id: string }
  let token: string
  const query = () => ({
    source: 'kz' as const,
    window: '1h' as const,
    interval: '1m' as const,
    params: { entity: ied, keys: ['P'] },
  })
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
    const payload = Buffer.from(JSON.stringify({ sub: 'x', scopes: ['TENANT_ADMIN'], exp: 4102444800 })).toString(
      'base64url'
    )
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

  // 第二步(按实体归属过滤):2026-09-08 实测新版仍不做——客户 token 读未分配设备返回 code 200(见 docs/联调记录/kz-更新部署-2026-09-08.md);高潮未承诺,先记 todo
  it.todo('客户 token 读未分配给它的设备 → 拒绝(实体归属过滤)')
})
