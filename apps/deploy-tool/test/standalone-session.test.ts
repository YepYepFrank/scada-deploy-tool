// T3.8 长会话:独立大屏的 token 续期。TB 实测值见 src/standalone/session.ts 头注释
// (access 2.5 小时 / refresh 7 天 / refresh 滚动)。
import { describe, expect, it, vi } from 'vitest'
import { expOf, TokenKeeper, type TokenPair } from '../src/standalone/session'

/**
 * 造一个 exp 在 `Date.now() + inMs` 的 JWT(只有 payload 是真的,签名无所谓)。
 * `jti` 是递增序号:同一毫秒里造出来的两张 token 也要能区分,否则「换没换新的」根本断言不了。
 */
let jti = 0
function jwt(inMs: number, now = Date.now()): string {
  const payload = Buffer.from(JSON.stringify({ exp: Math.floor((now + inMs) / 1000), jti: ++jti })).toString(
    'base64url'
  )
  return `head.${payload}.sig`
}

const H = 3_600_000

function setup(opts: { session?: Partial<TokenPair>; fetchImpl?: typeof fetch; now?: () => number } = {}) {
  let session: TokenPair | null = {
    base: 'http://tb',
    token: jwt(2.5 * H),
    refreshToken: jwt(7 * 24 * H),
    ...opts.session,
  }
  const expired: string[] = []
  const keeper = new TokenKeeper({
    get: () => session,
    onRefreshed: (token, refreshToken) => {
      session = { ...session!, token, refreshToken }
    },
    onExpired: r => expired.push(r),
    fetchImpl: opts.fetchImpl,
    now: opts.now,
  })
  return { keeper, expired, get: () => session, clear: () => (session = null) }
}

/** 每次刷新回一对全新 token(与真 TB 一致:refresh 也换新的) */
const okRefresh = (log: unknown[] = []) =>
  vi.fn(async (_url: unknown, init?: RequestInit) => {
    log.push(JSON.parse(String(init!.body)))
    return {
      ok: true,
      status: 200,
      json: async () => ({ token: jwt(2.5 * H), refreshToken: jwt(7 * 24 * H) }),
    } as unknown as Response
  }) as unknown as typeof fetch

describe('expOf', () => {
  it('取得出 exp;取不出来一律当作已过期(宁可多刷一次)', () => {
    const now = Date.now()
    expect(expOf(jwt(H, now))).toBeCloseTo(Math.floor((now + H) / 1000) * 1000, -3)
    for (const bad of ['', 'x', 'a.b', 'a.@@@.c', 'a.' + Buffer.from('{}').toString('base64url') + '.c'])
      expect(expOf(bad)).toBe(0)
  })
})

describe('TokenKeeper', () => {
  it('token 还早:直接用,不发刷新请求', async () => {
    const f = okRefresh()
    const { keeper } = setup({ fetchImpl: f })
    const before = await keeper.freshToken()
    expect(await keeper.freshToken()).toBe(before)
    expect(f).not.toHaveBeenCalled()
  })

  it('快到期(进入提前量)就换新的,并且把新的 refreshToken 一起存下 —— 滚动窗口靠这个续', async () => {
    const log: unknown[] = []
    const old = { token: jwt(30_000), refreshToken: jwt(7 * 24 * H) } // 30 秒后到期,提前量 60 秒
    const { keeper, get } = setup({ session: old, fetchImpl: okRefresh(log) })
    const t = await keeper.freshToken()
    expect(t).not.toBe(old.token)
    expect(get()!.token).toBe(t)
    // 关键:refreshToken 也换了。只存 access token 的话,7 天后大屏就掉登录
    expect(get()!.refreshToken).not.toBe(old.refreshToken)
    expect(log).toEqual([{ refreshToken: old.refreshToken }])
  })

  it('已经过期也一样能换(挂了几小时的大屏重新活过来)', async () => {
    const { keeper } = setup({ session: { token: jwt(-2 * H) }, fetchImpl: okRefresh() })
    await expect(keeper.freshToken()).resolves.toMatch(/^head\./)
  })

  it('并发调用只发一次刷新请求(REST 与 WS 重连可能同时来)', async () => {
    let resolveIt: (v: unknown) => void = () => {}
    const gate = new Promise(r => (resolveIt = r))
    const f = vi.fn(async () => {
      await gate
      return { ok: true, status: 200, json: async () => ({ token: jwt(2.5 * H), refreshToken: jwt(7 * 24 * H) }) }
    }) as unknown as typeof fetch
    const { keeper } = setup({ session: { token: jwt(-1) }, fetchImpl: f })
    const all = Promise.all([keeper.freshToken(), keeper.freshToken(), keeper.freshToken()])
    resolveIt(null)
    const [a, b, c] = await all
    expect(f).toHaveBeenCalledTimes(1)
    expect(a).toBe(b)
    expect(b).toBe(c)
    // 刷完之后再来一次是新的一轮,不会复用上一次的 promise
    await keeper.freshToken()
    expect(f).toHaveBeenCalledTimes(1) // 新 token 还早,压根不用刷
  })

  it('refresh token 也废了(401):通知调用方回登录页,并说清原因', async () => {
    const f = vi.fn(async () => ({ ok: false, status: 401, json: async () => ({}) })) as unknown as typeof fetch
    const { keeper, expired } = setup({ session: { token: jwt(-1) }, fetchImpl: f })
    await expect(keeper.freshToken()).rejects.toThrow(/登录已过期/)
    expect(expired).toHaveLength(1)
    expect(expired[0]).toContain('7 天')
    expect(await keeper.tryRefresh()).toBe(false)
  })

  it('网络不通不算登录失效:抛错但不把人踢回登录页', async () => {
    const f = vi.fn(async () => {
      throw new Error('Failed to fetch')
    }) as unknown as typeof fetch
    const { keeper, expired } = setup({ session: { token: jwt(-1) }, fetchImpl: f })
    await expect(keeper.freshToken()).rejects.toThrow(/刷新登录失败/)
    expect(expired).toEqual([])
    // 网络恢复后能自己接上
    const { keeper: k2 } = setup({ session: { token: jwt(-1) }, fetchImpl: okRefresh() })
    await expect(k2.freshToken()).resolves.toBeTruthy()
  })

  it('会话里没有 refreshToken(旧版本存下来的)/ 没登录:明确报错,不静默', async () => {
    const f = vi.fn() as unknown as typeof fetch
    const { keeper } = setup({ session: { token: jwt(-1), refreshToken: '' }, fetchImpl: f })
    await expect(keeper.freshToken()).rejects.toThrow(/没有 refresh token/)
    expect(f).not.toHaveBeenCalled()
    const { keeper: k2, clear } = setup({ fetchImpl: f })
    clear()
    await expect(k2.freshToken()).rejects.toThrow(/未登录/)
  })

  it('返回体缺字段也当失败,不会把 undefined 存进会话', async () => {
    const f = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ token: 'x' }),
    })) as unknown as typeof fetch
    const { keeper, get } = setup({ session: { token: jwt(-1) }, fetchImpl: f })
    await expect(keeper.freshToken()).rejects.toThrow(/没有 token/)
    expect(get()!.token).not.toBe('x')
  })

  it('reset() 之后在途刷新不再被复用(退出登录用)', async () => {
    const f = okRefresh()
    const { keeper } = setup({ session: { token: jwt(-1) }, fetchImpl: f })
    const p = keeper.freshToken()
    keeper.reset()
    await p
    await keeper.freshToken()
    expect(f).toHaveBeenCalledTimes(1) // 第二次时 token 已经是新的,不用再刷
  })
})
