/**
 * 向导 / 编辑器的登录会话续期(api/tb-session.ts)。背景:TB 的 access token 2.5 小时过期,
 * 以前向导登录一次用到底,同事编辑到一半去忙别的、回来实时数据全没。
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { createTbSession } from '../src/api/tb-session'

const jwt = (expInSec: number): string =>
  `h.${btoa(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + expInSec }))}.s`
const okRefresh = (token: string) =>
  vi.fn(async () => new Response(JSON.stringify({ token, refreshToken: jwt(7 * 86400) }), { status: 200 }))

afterEach(() => vi.useRealTimers())

describe('createTbSession', () => {
  it('token 还早:原样给,不打扰 TB', async () => {
    const fetchImpl = okRefresh('new')
    const s = createTbSession({ onToken: vi.fn(), onExpired: vi.fn(), fetchImpl })
    const token = jwt(3600)
    s.set({ base: '/tb', token, refreshToken: 'r' })
    expect(await s.freshToken()).toBe(token)
    expect(fetchImpl).not.toHaveBeenCalled()
    s.dispose()
  })

  it('剩不到 10 分钟就先换:向导会把 token 字符串交给子组件用一阵子,要留足余量', async () => {
    const fresh = jwt(9000)
    const fetchImpl = okRefresh(fresh)
    const onToken = vi.fn()
    const s = createTbSession({ onToken, onExpired: vi.fn(), fetchImpl })
    s.set({ base: '/tb', token: jwt(300), refreshToken: 'r' })
    expect(await s.freshToken()).toBe(fresh)
    expect(fetchImpl).toHaveBeenCalledWith('/tb/api/auth/token', expect.objectContaining({ method: 'POST' }))
    expect(onToken).toHaveBeenCalledWith(fresh) // 新 token 写回界面状态
    s.dispose()
  })

  it('已经过期(去忙了三小时回来):照样换得回来,不用重新登录', async () => {
    const fresh = jwt(9000)
    const s = createTbSession({ onToken: vi.fn(), onExpired: vi.fn(), fetchImpl: okRefresh(fresh) })
    s.set({ base: '/tb', token: jwt(-3600), refreshToken: 'r' })
    expect(await s.freshToken()).toBe(fresh)
    s.dispose()
  })

  it('refresh token 也废了(超过 7 天 / 被吊销):回调 onExpired,之后算未登录', async () => {
    const onExpired = vi.fn()
    const fetchImpl = vi.fn(async () => new Response('', { status: 401 }))
    const s = createTbSession({ onToken: vi.fn(), onExpired, fetchImpl })
    s.set({ base: '/tb', token: jwt(-10), refreshToken: 'r' })
    await expect(s.freshToken()).rejects.toThrow(/过期/)
    expect(onExpired).toHaveBeenCalledTimes(1)
    expect(s.has()).toBe(false)
    s.dispose()
  })

  it('心跳:每 4 分钟看一眼,快到期就自己换(没人发请求的时候也不会悄悄过期)', async () => {
    vi.useFakeTimers()
    const fresh = jwt(9000)
    const fetchImpl = okRefresh(fresh)
    const onToken = vi.fn()
    const s = createTbSession({ onToken, onExpired: vi.fn(), fetchImpl })
    s.set({ base: '/tb', token: jwt(12 * 60), refreshToken: 'r' }) // 还剩 12 分钟:第一次心跳时剩 8 分钟 → 该换了
    await vi.advanceTimersByTimeAsync(4 * 60_000 + 50)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(onToken).toHaveBeenCalledWith(fresh)
    s.dispose()
  })

  it('set(null)(切环境 / 退出):心跳停掉,freshToken 抛「未登录」', async () => {
    vi.useFakeTimers()
    const fetchImpl = okRefresh('x')
    const s = createTbSession({ onToken: vi.fn(), onExpired: vi.fn(), fetchImpl })
    s.set({ base: '/tb', token: jwt(60), refreshToken: 'r' })
    s.set(null)
    await vi.advanceTimersByTimeAsync(10 * 60_000)
    expect(fetchImpl).not.toHaveBeenCalled()
    await expect(s.freshToken()).rejects.toThrow('未登录')
  })
})
