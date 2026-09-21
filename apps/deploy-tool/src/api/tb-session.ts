/**
 * 向导 / 编辑器的 TB 登录会话(2026-09-21)。
 *
 * 起因:同事编辑到一半去忙别的,回来发现工具里的实时数据全没了。排查结果——
 * - TB 的 access token **2.5 小时**过期(CT110 实测 9000 s),refresh token 7 天、滚动续期;
 * - 向导、编辑器、预览从登录那一刻起一直用同一个 token,**从不续期**(只有独立大屏薄壳做了,见 standalone/session.ts);
 * - 预览的数据源 `getToken` 还是个闭包,捕获的是创建那一刻的 token 字符串。
 * 所以登录满 2.5 小时后,REST 一律 401;WebSocket 只要断过一次(电脑休眠 / 锁屏 / 网络抖动 / 代理空闲超时),
 * 重连带的还是那个过期 token,握手被拒,每 3 秒重试一次、永远连不上——页面上看就是「实时数据全没了」。
 *
 * 这里把 TokenKeeper(纯逻辑、已有单测)包成向导用得上的样子:
 * - `freshToken()`:拿一个至少还能用 10 分钟的 token,快到期就先换。REST、WS 重连都走它;
 * - 心跳:每 4 分钟看一眼;页面从后台回到前台、网络恢复时立刻看一眼(休眠期间定时器是停的);
 * - 续不下去(超过 7 天 / 被吊销)才回调 onExpired,由界面提示重新登录。
 * 提前量取 10 分钟而不是薄壳的 60 秒:向导会把 token **字符串**交给子组件用一阵子(编辑器、预览),
 * 要保证交出去的那一刻它还有足够的余量撑到下一次心跳。
 */
import { TokenKeeper, type TokenPair } from '../standalone/session'

const KEEPALIVE_MS = 4 * 60_000
const SKEW_MS = 10 * 60_000

export interface TbSessionOptions {
  /** token 换新了:调用方把它写回自己的响应式状态(界面、子组件据此拿到新值) */
  onToken: (token: string) => void
  /** 续不下去了:调用方回到未登录状态并提示 */
  onExpired: (reason: string) => void
  fetchImpl?: typeof fetch
}

export interface TbSession {
  /** 登录成功后交给它保管;传 null = 退出 / 切环境 */
  set(pair: TokenPair | null): void
  has(): boolean
  /** 拿一个没过期的 token(快到期先换);没登录时抛错 */
  freshToken(): Promise<string>
  /** REST 收到 401 时强制换一次,只回成败 */
  tryRefresh(): Promise<boolean>
  dispose(): void
}

export function createTbSession(opts: TbSessionOptions): TbSession {
  let pair: TokenPair | null = null
  let timer: ReturnType<typeof setInterval> | null = null

  const keeper = new TokenKeeper({
    get: () => pair,
    onRefreshed: (token, refreshToken) => {
      if (!pair) return
      pair = { ...pair, token, refreshToken }
      opts.onToken(token)
    },
    onExpired: reason => {
      pair = null
      stop()
      opts.onExpired(reason)
    },
    skewMs: SKEW_MS,
    ...(opts.fetchImpl ? { fetchImpl: opts.fetchImpl } : {}),
  })

  const tick = (): void => {
    if (pair) void keeper.freshToken().catch(() => {})
  }
  const onVisible = (): void => {
    if (typeof document === 'undefined' || document.visibilityState === 'visible') tick()
  }
  function start(): void {
    if (timer) return
    timer = setInterval(tick, KEEPALIVE_MS)
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisible)
    if (typeof window !== 'undefined') window.addEventListener('online', tick)
  }
  function stop(): void {
    if (timer) clearInterval(timer)
    timer = null
    if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisible)
    if (typeof window !== 'undefined') window.removeEventListener('online', tick)
  }

  return {
    set(next) {
      keeper.reset()
      pair = next
      if (next) start()
      else stop()
    },
    has: () => !!pair,
    freshToken: () => keeper.freshToken(),
    tryRefresh: () => keeper.tryRefresh(),
    dispose() {
      keeper.reset()
      pair = null
      stop()
    },
  }
}
