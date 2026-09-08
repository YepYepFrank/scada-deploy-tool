// ADR-003 决定 3 的「执行」(二期):按迁移表 migrations/<站点>.rename.json 把旧 key 的历史复制到新 key,
// 可选删掉旧 CF 与旧 key 数据;页面文件里对旧 key 的绑定改名(纯函数,CLI 落盘)。
// 复制只补「新 key 首点之前」的区间:新 key 上线后两边都在写,重叠段以新 key 为准,不覆盖。
import type { RenameEntry } from '../core/prefix'
import { findAsset, findDevice, listCfs, type TbApi } from './api'
import type { PagePayload } from '../page/types'
import { eachBinding, extEntityOf, hasEntity } from '../page/types'

export interface ApplyRenameOptions {
  /** false = 只统计不写(默认) */
  apply?: boolean
  /** 复制完成后删旧 CF(同名)与旧 key 的全部数据 */
  deleteOld?: boolean
  /** 每次 GET 的点数上限 / 每次 POST 的点数 */
  pageSize?: number
  batchSize?: number
  /** 只迁到这个时刻之前(缺省 = 新 key 首点;新 key 没数据则到现在) */
  now?: number
  /** 只迁这个时刻之后的旧点(缺省 0 = 全部);TB 有 TTL 时没必要搬会被清掉的老数据 */
  from?: number
  report?: (line: string) => void
}
export interface MigrateRowResult {
  row: RenameEntry
  entityId: string | null
  /** 复制 / 计划复制的点数 */
  points: number
  /** 复制区间 [from, to];没点时 null */
  range: { from: number; to: number } | null
  /** 新 key 首点(复制的上界);null = 新 key 还没数据 */
  newFirstTs: number | null
  deletedCf: boolean
  deletedOld: boolean
  skipped?: string
}

type Point = { ts: number; value: unknown }
const num = (v: unknown) => (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)) ? Number(v) : v)

async function firstTs(api: TbApi, type: string, id: string, key: string): Promise<number | null> {
  const r = await api(
    `/api/plugins/telemetry/${type}/${id}/values/timeseries?keys=${encodeURIComponent(key)}&startTs=0&endTs=${Date.now()}&limit=1&orderBy=ASC`
  )
  const p = r?.[key]?.[0]
  return p ? Number(p.ts) : null
}

/** 升序分页取 [startTs, endTs] 的点(endTs 不含) */
async function* readPoints(
  api: TbApi,
  type: string,
  id: string,
  key: string,
  startTs: number,
  endTs: number,
  pageSize: number
) {
  let from = startTs
  while (from < endTs) {
    const r = await api(
      `/api/plugins/telemetry/${type}/${id}/values/timeseries?keys=${encodeURIComponent(key)}&startTs=${from}&endTs=${endTs - 1}&limit=${pageSize}&orderBy=ASC`
    )
    const pts: Point[] = (r?.[key] ?? []).map((p: { ts: number | string; value: unknown }) => ({
      ts: Number(p.ts),
      value: p.value,
    }))
    if (!pts.length) return
    yield pts
    if (pts.length < pageSize) return
    from = pts[pts.length - 1]!.ts + 1
  }
}

export async function applyRenameTable(
  api: TbApi,
  rows: RenameEntry[],
  opts: ApplyRenameOptions = {}
): Promise<MigrateRowResult[]> {
  const pageSize = opts.pageSize ?? 5000
  const batchSize = opts.batchSize ?? 1000
  const now = opts.now ?? Date.now()
  const log = opts.report ?? (() => {})
  const out: MigrateRowResult[] = []
  const idCache = new Map<string, string | null>()
  for (const row of rows) {
    const ck = `${row.entityType}|${row.entity}`
    if (!idCache.has(ck)) {
      const e = row.entityType === 'DEVICE' ? await findDevice(api, row.entity) : await findAsset(api, row.entity)
      idCache.set(ck, e?.id?.id ?? null)
    }
    const id = idCache.get(ck) ?? null
    const res: MigrateRowResult = {
      row,
      entityId: id,
      points: 0,
      range: null,
      newFirstTs: null,
      deletedCf: false,
      deletedOld: false,
    }
    out.push(res)
    if (!id) {
      res.skipped = `${row.entityType} ${row.entity} 在 TB 中不存在`
      log(`✗ ${row.entity}.${row.old}:${res.skipped}`)
      continue
    }
    res.newFirstTs = await firstTs(api, row.entityType, id, row.new)
    const upper = res.newFirstTs ?? now
    let batch: { ts: number; values: Record<string, unknown> }[] = []
    const flush = async () => {
      if (!batch.length) return
      if (opts.apply) await api(`/api/plugins/telemetry/${row.entityType}/${id}/timeseries/ANY`, batch)
      batch = []
    }
    for await (const pts of readPoints(api, row.entityType, id, row.old, opts.from ?? 0, upper, pageSize)) {
      for (const p of pts) {
        res.points++
        res.range = { from: res.range?.from ?? p.ts, to: p.ts }
        batch.push({ ts: p.ts, values: { [row.new]: num(p.value) } })
        if (batch.length >= batchSize) await flush()
      }
    }
    await flush()
    const span = res.range
      ? `${new Date(res.range.from).toISOString().slice(0, 16)} → ${new Date(res.range.to).toISOString().slice(0, 16)}`
      : '无'
    log(
      `${opts.apply ? '✓' : '·'} ${row.entity}.${row.old} → ${row.new}:${res.points} 点(${span}${res.newFirstTs ? ',止于新 key 首点' : ''})${opts.apply ? '' : ' [dry-run]'}`
    )
    if (opts.deleteOld && opts.apply) {
      const cfs = await listCfs(api, row.entityType, id)
      const cf = cfs.find(c => c.name === row.old)
      if (cf) {
        await api(`/api/calculatedField/${cf.id.id}`, undefined, 'DELETE')
        res.deletedCf = true
      }
      await api(
        `/api/plugins/telemetry/${row.entityType}/${id}/timeseries/delete?keys=${encodeURIComponent(row.old)}&deleteAllDataForKeys=true`,
        undefined,
        'DELETE'
      )
      res.deletedOld = true
      log(`  已删旧 key ${row.old} 的数据${cf ? ' 与同名 CF' : ''}`)
    }
  }
  return out
}

export interface PageKeyChange {
  at: string
  entity: string
  old: string
  new: string
}
/** 页面文件里对旧 key 的绑定改成新 key(按实体名对上;ts.key / ts-history.keys / ext.params.keys)。不改原对象。 */
export function rewritePageKeys(
  page: PagePayload,
  rows: RenameEntry[]
): { page: PagePayload; changes: PageKeyChange[] } {
  const map = new Map<string, string>()
  for (const r of rows) map.set(`${r.entityType}|${r.entity}|${r.old}`, r.new)
  if (!map.size) return { page, changes: [] }
  const copy = JSON.parse(JSON.stringify(page)) as PagePayload
  const changes: PageKeyChange[] = []
  const rename = (type: string, name: string | undefined, key: string, at: string) => {
    const nk = name ? map.get(`${type}|${name}|${key}`) : undefined
    if (nk) changes.push({ at, entity: name!, old: key, new: nk })
    return nk ?? key
  }
  for (const w of copy.widgets)
    for (const { at, binding: b } of eachBinding(w)) {
      if (hasEntity(b)) {
        if (b.mode === 'ts' || b.mode === 'attr') b.key = rename(b.entity.type, b.entity.name, b.key, at)
        else if (b.mode === 'ts-history') b.keys = b.keys.map(k => rename(b.entity.type, b.entity.name, k, at))
      } else {
        const e = extEntityOf(b)
        if (e && b.mode === 'ext' && Array.isArray(b.params.keys))
          b.params.keys = b.params.keys.map(k => rename(e.type, e.name, k, at))
      }
    }
  return { page: copy, changes }
}
