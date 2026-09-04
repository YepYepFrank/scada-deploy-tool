/** 测试用 MockDataSource:记录每次调用,可手动推送;退订计数与订阅计数对账。 */
import type {
  DataSource,
  EntityRef,
  TsUpdate,
  AttrUpdate,
  AlarmInfo,
  ConnectionStatus,
  TsPoint,
  ExtQuery,
} from '@grid/tb-client'

export interface Call {
  method: 'subscribeTs' | 'subscribeAttr' | 'subscribeAlarms' | 'getHistory' | 'getLatest' | 'ext'
  entity?: EntityRef
  keys?: string[]
  scope?: string
  types?: string[] | undefined
  window?: string
  agg?: string
  query?: ExtQuery
}

export function createMockDataSource(opts: { withExt?: boolean; history?: Record<string, TsPoint[]> } = {}) {
  const calls: Call[] = []
  const tsCbs = new Map<string, Array<(u: TsUpdate[]) => void>>()
  const attrCbs = new Map<string, Array<(u: AttrUpdate[]) => void>>()
  const alarmCbs: Array<(a: AlarmInfo[]) => void> = []
  const statusCbs: Array<(s: ConnectionStatus) => void> = []
  let unsubscribed = 0
  let seq = 10_000 // 推送用单调递增 ts,避免同一毫秒被去重
  let status: ConnectionStatus = 'live'

  const keyOf = (e: EntityRef, k: string) => `${e.type}:${e.id}:${k}`

  const ds: DataSource & {
    calls: Call[]
    unsubscribed: () => number
    pushTs: (e: EntityRef, k: string, v: TsPoint['value']) => void
    pushAttr: (e: EntityRef, k: string, v: unknown) => void
    pushAlarms: (a: AlarmInfo[]) => void
    setStatus: (s: ConnectionStatus) => void
  } = {
    get status() {
      return status
    },
    onStatus(cb) {
      statusCbs.push(cb)
      return () => {
        const i = statusCbs.indexOf(cb)
        if (i >= 0) statusCbs.splice(i, 1)
      }
    },
    subscribeTs(entity, keys, cb) {
      calls.push({ method: 'subscribeTs', entity, keys })
      for (const k of keys)
        (tsCbs.get(keyOf(entity, k)) ?? tsCbs.set(keyOf(entity, k), []).get(keyOf(entity, k))!).push(cb)
      // 首包:最新值 1
      cb(keys.map(k => ({ key: k, points: [{ ts: 1000, value: 1 }] })))
      return () => {
        unsubscribed++
        for (const k of keys) {
          const arr = tsCbs.get(keyOf(entity, k)) ?? []
          const i = arr.indexOf(cb)
          if (i >= 0) arr.splice(i, 1)
        }
      }
    },
    subscribeAttr(entity, scope, keys, cb) {
      calls.push({ method: 'subscribeAttr', entity, keys, scope })
      for (const k of keys)
        (attrCbs.get(keyOf(entity, k)) ?? attrCbs.set(keyOf(entity, k), []).get(keyOf(entity, k))!).push(cb)
      cb(keys.map(k => ({ scope, key: k, ts: 1000, value: 'v0' })))
      return () => {
        unsubscribed++
      }
    },
    subscribeAlarms(entity, types, cb) {
      calls.push({ method: 'subscribeAlarms', entity, types })
      alarmCbs.push(cb)
      cb([])
      return () => {
        unsubscribed++
      }
    },
    async getHistory(entity, keys, window, agg) {
      calls.push({ method: 'getHistory', entity, keys, window, agg })
      return Object.fromEntries(
        keys.map(k => [
          k,
          opts.history?.[k] ?? [
            { ts: 1, value: 10 },
            { ts: 2, value: 20 },
          ],
        ])
      )
    },
    async getLatest(entity, keys) {
      calls.push({ method: 'getLatest', entity, keys })
      return Object.fromEntries(keys.map(k => [k, { ts: 1000, value: 1 }]))
    },
    ...(opts.withExt
      ? {
          async ext(query: ExtQuery) {
            calls.push({ method: 'ext', query })
            return {
              series: {
                [String(query.params.metric ?? 'ext')]: [
                  { ts: 1, value: 100 },
                  { ts: 2, value: 200 },
                ],
              },
            }
          },
        }
      : {}),
    calls,
    unsubscribed: () => unsubscribed,
    pushTs(e, k, v) {
      for (const cb of tsCbs.get(keyOf(e, k)) ?? []) cb([{ key: k, points: [{ ts: ++seq, value: v }] }])
    },
    pushAttr(e, k, v) {
      for (const cb of attrCbs.get(keyOf(e, k)) ?? []) cb([{ scope: 'SERVER_SCOPE', key: k, ts: ++seq, value: v }])
    },
    pushAlarms(a) {
      for (const cb of alarmCbs) cb(a)
    },
    setStatus(s) {
      status = s
      for (const cb of statusCbs) cb(s)
    },
  }
  return ds
}
