/**
 * 编辑器的 TB 连接与元数据树状态(composable + reactive,不引入 Pinia)。
 * 凭据只在内存里;dev 时可用 VITE_TB_USER / VITE_TB_TENANT_USER 预填(与渲染器 /dev 页一致)。
 */
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

  /** 与编译器 TbApi 同签名:(url, data?, method?);data 为 undefined/null 不发 body */
  const api = async (url: string, data?: unknown, method?: 'GET' | 'POST' | 'DELETE') => {
    const r = await fetch(conn.base + url, {
      method: method ?? (data !== undefined && data !== null ? 'POST' : 'GET'),
      headers: {
        'Content-Type': 'application/json',
        ...(conn.token ? { 'X-Authorization': `Bearer ${conn.token}` } : {}),
      },
      body: data !== undefined && data !== null ? JSON.stringify(data) : undefined,
    })
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
      conn.token = (
        (await api('/api/auth/login', { username: conn.user, password: conn.pass })) as { token: string }
      ).token
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
    conn.base = s.base
    conn.token = s.token
    conn.user = s.user
    conn.siteName = s.siteName
    conn.authority = s.authority ?? ''
    conn.pass = ''
    await loadTree()
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
    keyCn,
  }
}

export type Meta = ReturnType<typeof useMeta>
