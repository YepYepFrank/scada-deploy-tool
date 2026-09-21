/**
 * 编辑器的 TB 连接与元数据树状态(composable + reactive,不引入 Pinia)。
 * 凭据只在内存里;dev 时可用 VITE_TB_USER / VITE_TB_TENANT_USER 预填(与渲染器 /dev 页一致)。
 */
import { createTbSession } from '../api/tb-session'
import { computed, reactive, shallowRef } from 'vue'
import { buildMetaTree, countEntities, MetaClient, type MetaNode } from './MetaNode'
import { isKeyDictAsset, keyCnFrom, parseKeyDict, type KeyDict } from '../naming'

export const IDENTITIES = [
  { id: 'customer', label: '客户视角', user: import.meta.env.VITE_TB_USER, pass: import.meta.env.VITE_TB_PASSWORD },
  {
    id: 'tenant',
    label: '租户视角',
    user: import.meta.env.VITE_TB_TENANT_USER,
    pass: import.meta.env.VITE_TB_TENANT_PASSWORD,
  },
].filter(i => i.user && i.pass) as { id: string; label: string; user: string; pass: string }[]

/** 向导等外部壳已登录的会话:编辑器直接采用,不再让用户登录一次 */
export interface EditorSession {
  base: string
  token: string
  /**
   * 向导给的「要一个没过期的 token」(2026-09-21)。有它就每次请求前问一次;
   * 没有(旧调用方)才退回用上面那个字符串。
   */
  getToken?: () => Promise<string>
  /** 向导在第 3 步建完结果资产后 +1:编辑器据此重读实体树 */
  rev?: number
  user: string
  siteName: string
  authority?: string
}

export function useMeta() {
  const conn = reactive({
    base: '/tbm',
    identity: IDENTITIES[0]?.id ?? '',
    user: IDENTITIES[0]?.user ?? '',
    pass: IDENTITIES[0]?.pass ?? '',
    token: '',
    authority: '',
    busy: false,
    msg: '',
    siteName: '',
  })
  const tree = shallowRef<MetaNode | null>(null)
  const client = shallowRef<MetaClient | null>(null)
  /** 测点中文字典(2026-09-11):绑定选择器里测点显示「中文(英文)」;读不到(如客户账号看不到字典资产)就只显示英文 */
  const keyDict = shallowRef<KeyDict>({})
  const keyCn = (key: string) => keyCnFrom(keyDict.value, key)

  /**
   * 会话续期(2026-09-21,见 api/tb-session.ts):TB 的 access token 2.5 小时过期。
   * - 嵌在向导里(adopt):token 归向导管,这里每次请求前向它要(`external`);
   * - 独立打开编辑器(connect):自己登录的,自己保管 refresh token 续期(`own`)。
   */
  let external: (() => Promise<string>) | null = null
  let adoptedRev: number | undefined
  const own = createTbSession({
    onToken: token => {
      conn.token = token
    },
    onExpired: reason => {
      conn.token = ''
      conn.msg = `${reason},请重新登录`
    },
  })
  async function currentToken(): Promise<string> {
    try {
      if (external) return (conn.token = await external())
      if (own.has()) return await own.freshToken()
    } catch {
      /* 换不到就用手上这个去试,让请求自己报 401,错误信息更直接 */
    }
    return conn.token
  }

  /** 与编译器 TbApi 同签名:(url, data?, method?);data 为 undefined/null 不发 body */
  const api = async (
    url: string,
    data?: unknown,
    method?: 'GET' | 'POST' | 'DELETE',
    retried = false
  ): Promise<unknown> => {
    const isLogin = url === '/api/auth/login'
    const token = isLogin ? '' : await currentToken()
    const r = await fetch(conn.base + url, {
      method: method ?? (data !== undefined && data !== null ? 'POST' : 'GET'),
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { 'X-Authorization': `Bearer ${token}` } : {}),
      },
      body: data !== undefined && data !== null ? JSON.stringify(data) : undefined,
    })
    if (r.status === 401 && !isLogin && !retried && !external && own.has() && (await own.tryRefresh()))
      return api(url, data, method, true)
    if (!r.ok) throw new Error(`${url.split('?')[0]} → HTTP ${r.status}`)
    const t = await r.text()
    return t ? JSON.parse(t) : null
  }

  function pickIdentity() {
    const i = IDENTITIES.find(x => x.id === conn.identity)
    if (i) {
      conn.user = i.user
      conn.pass = i.pass
    }
  }

  async function connect() {
    conn.busy = true
    conn.msg = '登录中…'
    try {
      conn.token = ''
      external = null
      const login = (await api('/api/auth/login', { username: conn.user, password: conn.pass })) as {
        token: string
        refreshToken: string
      }
      conn.token = login.token
      own.set({ base: conn.base, token: login.token, refreshToken: login.refreshToken })
    } catch (e) {
      conn.msg = '失败:' + (e instanceof Error ? e.message : String(e))
      tree.value = null
      client.value = null
      conn.busy = false
      return
    }
    await loadTree()
  }
  /** 采用外部会话(向导第 1 步已登录):只拉元数据树,不登录 */
  async function adopt(s: EditorSession) {
    // 只是 token 换新了(向导那边 2.5 小时续一次):记下新值就行,**不要重读元数据树**——
    // 否则每次续期编辑器都要转一圈,绑定选择器里展开到一半的树也会被收起来
    const sameSession =
      !!tree.value &&
      conn.base === s.base &&
      conn.user === s.user &&
      conn.siteName === s.siteName &&
      adoptedRev === s.rev
    conn.base = s.base
    conn.token = s.token
    external = s.getToken ?? null
    own.set(null)
    conn.user = s.user
    conn.siteName = s.siteName
    conn.authority = s.authority ?? ''
    conn.pass = ''
    adoptedRev = s.rev
    if (!sameSession) await loadTree()
  }
  async function loadTree() {
    conn.busy = true
    conn.msg = '读取元数据…'
    try {
      const c = new MetaClient(api)
      client.value = c
      const me = await c.me()
      conn.authority = me.authority
      const [devices, assets] = await Promise.all([c.devices(me), c.assets(me)])
      const contains = await c.assetContains(assets)
      keyDict.value = {}
      const dictAsset = assets.find(isKeyDictAsset)
      if (dictAsset)
        try {
          keyDict.value = parseKeyDict(
            ((await api(`/api/plugins/telemetry/ASSET/${dictAsset.id.id}/values/attributes/SERVER_SCOPE`)) as {
              key: string
              value: unknown
            }[]) ?? []
          )
        } catch {
          /* 字典读不到只影响中文显示 */
        }
      tree.value = buildMetaTree(conn.siteName || '站点', devices, assets, contains)
      conn.msg = `${me.authority} · ${devices.length} 台设备 · ${assets.length} 个资产(${contains.length} 条 Contains)`
    } catch (e) {
      conn.msg = '失败:' + (e instanceof Error ? e.message : String(e))
      tree.value = null
      client.value = null
    } finally {
      conn.busy = false
    }
  }
  async function refresh() {
    client.value?.clear()
    await connect()
  }

  return {
    conn,
    identities: IDENTITIES,
    tree,
    client,
    connected: computed(() => !!client.value && !!tree.value),
    entityCount: computed(() => (tree.value ? countEntities(tree.value) : 0)),
    pickIdentity,
    connect,
    adopt,
    refresh,
    api,
    /** 要一个没过期的 token(预览的数据源重连时用);续不上就回手上这个,让请求自己报 401 */
    getToken: currentToken,
    keyCn,
  }
}

export type Meta = ReturnType<typeof useMeta>
