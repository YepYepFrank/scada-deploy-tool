/**
 * 独立大屏的 token 续期(T3.8 长会话)。
 *
 * TB CE 4.3.1 实测(镜像 2026-09-09):`/api/auth/login` 回 `{ token, refreshToken }`,
 * access token **2.5 小时**、refresh token **7 天**;`POST /api/auth/token { refreshToken }`
 * 换回一对**全新的** token,而且新 refresh token 的 `iat`/`exp` 从刷新那一刻重新起算
 * ——也就是说它是**滚动**的:只要 7 天内续过一次,大屏就不用重新登录。
 * (旧的 refresh token 刷新后仍然可用,不是一次性的,所以并发刷新不会把自己锁死。)
 *
 * 大屏是挂墙长开的,数据走 WS,可能几小时一个 REST 请求都没有 —— 所以除了「按需刷新」,
 * 调用方还要定时叫一次 `freshToken()` 把滚动窗口续下去,否则第 8 天就掉登录了。
 *
 * 纯逻辑,不碰 Vue 也不碰 storage:会话怎么存、过期了跳哪儿,都由调用方给回调。
 */

export interface TokenPair {
  base: string
  token: string
  refreshToken: string
}

export interface TokenKeeperOptions {
  /** 当前会话;没登录回 null */
  get: () => TokenPair | null
  /** 刷新成功:**必须把新的 refreshToken 一起存下**,否则滚动窗口断在这里 */
  onRefreshed: (token: string, refreshToken: string) => void
  /** 续不下去了(refresh token 也废了 / 被吊销):调用方负责回登录页 */
  onExpired: (reason: string) => void
  fetchImpl?: typeof fetch
  now?: () => number
  /** 提前量:避开客户端时钟偏差与请求耗时,默认 60 秒 */
  skewMs?: number
}

/** JWT 的 exp,毫秒。解不出来回 0(当作已过期)——宁可多刷一次,也不要拿着废 token 去请求。 */
export function expOf(token: string): number {
  try {
    const part = token.split('.')[1]
    if (!part) return 0
    const json = atob(part.replace(/-/g, '+').replace(/_/g, '/'))
    const claims = JSON.parse(json) as { exp?: number }
    return typeof claims.exp === 'number' ? claims.exp * 1000 : 0
  } catch {
    return 0
  }
}

export class TokenKeeper {
  private refreshing: Promise<string> | null = null
  private readonly fetchImpl: typeof fetch
  private readonly now: () => number
  private readonly skewMs: number

  constructor(private readonly o: TokenKeeperOptions) {
    this.fetchImpl = o.fetchImpl ?? ((...a: Parameters<typeof fetch>) => fetch(...a))
    this.now = o.now ?? (() => Date.now())
    this.skewMs = o.skewMs ?? 60_000
  }

  /** 拿一个没过期的 access token;快到期就先换。并发调用共用同一次刷新。 */
  async freshToken(): Promise<string> {
    const s = this.o.get()
    if (!s) throw new Error('未登录')
    if (this.now() < expOf(s.token) - this.skewMs) return s.token
    return this.refresh()
  }

  /** 强制刷一次,只回成败:给「REST 收到 401」和「心跳」用,不抛。 */
  async tryRefresh(): Promise<boolean> {
    try {
      await this.refresh()
      return true
    } catch {
      return false
    }
  }

  /** 退出登录时清掉在途的刷新,免得它刷完又把会话写回去 */
  reset(): void {
    this.refreshing = null
  }

  private refresh(): Promise<string> {
    if (this.refreshing) return this.refreshing
    const run = (async () => {
      const s = this.o.get()
      if (!s?.refreshToken) throw new Error('没有 refresh token,需要重新登录')
      let r: Response
      try {
        r = await this.fetchImpl(`${s.base}/api/auth/token`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refreshToken: s.refreshToken }),
        })
      } catch (e) {
        // 网络不通不等于登录失效:不通知 onExpired,让调用方按失败重试
        throw new Error(`刷新登录失败:${(e as Error).message}`)
      }
      if (!r.ok) {
        const why = r.status === 401 ? '登录已过期(超过 7 天未续期或已被吊销)' : `刷新登录失败 HTTP ${r.status}`
        if (r.status === 401 || r.status === 403) this.o.onExpired(why)
        throw new Error(why)
      }
      const j = (await r.json()) as { token?: string; refreshToken?: string }
      if (!j.token || !j.refreshToken) throw new Error('刷新登录失败:返回里没有 token')
      this.o.onRefreshed(j.token, j.refreshToken)
      return j.token
    })()
    this.refreshing = run
    void run
      .catch(() => {})
      .then(() => {
        if (this.refreshing === run) this.refreshing = null
      })
    return run
  }
}
