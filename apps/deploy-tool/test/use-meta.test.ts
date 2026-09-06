// T3.7 向导接入:useMeta.adopt 采用外部已登录会话(不再登录),直接拉元数据树;connect 登录失败不碰旧树。
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useMeta } from '../src/meta/useMeta'

function fakeFetch(opts: { loginOk?: boolean } = {}) {
  const calls: string[] = []
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
  const impl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input)
    calls.push(`${init?.method ?? 'GET'} ${url}`)
    const auth = (init?.headers as Record<string, string> | undefined)?.['X-Authorization']
    if (url.endsWith('/api/auth/login'))
      return opts.loginOk === false ? json({ message: 'bad' }, 401) : json({ token: 'jwt-login' })
    if (!auth) return json({ message: 'no auth' }, 401)
    if (url.endsWith('/api/auth/user')) return json({ authority: 'TENANT_ADMIN' })
    if (url.includes('/api/tenant/devices'))
      return json({ data: [{ id: { id: 'd1' }, name: 'SSP1_GP1_IED1', type: 'IED' }], hasNext: false })
    if (url.includes('/api/tenant/assets'))
      return json({ data: [{ id: { id: 'a1' }, name: 'xrs-mirror-test', type: 'tbsite' }], hasNext: false })
    if (url.includes('/api/relations')) return json([])
    return json({ message: 'unknown ' + url }, 404)
  })
  return { impl, calls }
}

describe('useMeta', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('adopt:用外部 token 直接拉树,不调登录接口;conn 采用会话字段', async () => {
    const f = fakeFetch()
    vi.stubGlobal('fetch', f.impl)
    const m = useMeta()
    await m.adopt({ base: '/wiz', token: 'jwt-wizard', user: 'tenant@thingsboard.org', siteName: 'xrs-mirror-test' })
    expect(f.calls.some(c => c.includes('/api/auth/login'))).toBe(false)
    expect(f.calls[0]).toBe('GET /wiz/api/auth/user')
    expect(m.conn.token).toBe('jwt-wizard')
    expect(m.conn.authority).toBe('TENANT_ADMIN')
    expect(m.connected.value).toBe(true)
    expect(m.tree.value?.name).toBe('xrs-mirror-test')
    expect(m.entityCount.value).toBe(2)
    expect(m.conn.msg).toContain('1 台设备')
  })

  it('connect:登录失败清空树并给出原因;登录成功后 api 带 token', async () => {
    const bad = fakeFetch({ loginOk: false })
    vi.stubGlobal('fetch', bad.impl)
    const m = useMeta()
    m.conn.base = '/x'
    m.conn.user = 'u'
    m.conn.pass = 'p'
    await m.connect()
    expect(m.connected.value).toBe(false)
    expect(m.conn.msg).toMatch(/失败.*401/)
    const good = fakeFetch()
    vi.stubGlobal('fetch', good.impl)
    await m.connect()
    expect(m.connected.value).toBe(true)
    expect(good.calls[0]).toBe('POST /x/api/auth/login')
    // api 支持 DELETE(回滚用)
    await m.api('/api/asset/zz', null, 'DELETE').catch(() => {})
    expect(good.calls.at(-1)).toBe('DELETE /x/api/asset/zz')
  })
})
