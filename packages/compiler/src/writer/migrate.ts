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
  /**
   * 固定每行的复制上界(`cutoverKey(row)` → ts),重试时必传上一轮的值。
   *
   * 不传就每次现算「新 key 当前首点」。第一批点搬进去之后这个时刻已经变早,重试时会把
   * 刚搬进去的第一个点当成新 key 的原始起点,余下历史全被跳过(审查 R4)。CLI 会把上一轮
   * 算出的上界写进 `migrations/<站点>.migrate-state.json`,下次自动带上。
   */
  cutover?: Record<string, number>
  report?: (line: string) => void
}

/** 迁移状态文件里给每行做键:同一实体的同一对新旧 key 才算同一行 */
export const cutoverKey = (row: RenameEntry) => `${row.entityType}|${row.entity}|${row.old}|${row.new}`

/**
 * 删旧数据前的完整性核对(全部只读)。
 *
 * 分两段看:
 * - 上界之前:这一段该由复制补齐,所以新 key 的点数不能少于旧 key。
 * - 上界之后:新旧两个 key 本来就并行写过一阵(重叠段以新 key 为准、不复制),
 *   正常情况下同一个运算换个名字写,两边点数相当;要是新 key 明显更稀,
 *   说明这个「上界」不是真的切换点,而是中断重试时被已搬进去的点带偏了(审查 R4)。
 */
export interface MigrateVerify {
  /** 上界之前的旧点数 */
  oldInRange: number
  /** 同一区间里新 key 现有的点数 */
  newInRange: number
  /** 上界之后的旧点数(重叠段) */
  oldBeyond: number
  /** 上界之后新 key 的点数 */
  newBeyond: number
  complete: boolean
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
  /** 上界是调用方钉住的(来自状态文件),而不是本轮现算的 */
  cutoverPinned: boolean
  deletedCf: boolean
  deletedOld: boolean
  /** deleteOld 时做的完整性核对 */
  verified?: MigrateVerify
  /** 核对没过所以没删旧 key,原因写在这里 */
  deleteSkipped?: string
  /** 本行出错(不影响其它行) */
  error?: string
  skipped?: string
}

type Point = { ts: number; value: unknown }
const num = (v: unknown) => (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)) ? Number(v) : v)

/** 数一个区间里有多少点(只读,分页;endTs 不含) */
async function countPoints(
  api: TbApi,
  type: string,
  id: string,
  key: string,
  startTs: number,
  endTs: number,
  pageSize: number
): Promise<number> {
  if (endTs <= startTs) return 0
  let n = 0
  for await (const pts of readPoints(api, type, id, key, startTs, endTs, pageSize)) n += pts.length
  return n
}

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
      cutoverPinned: false,
      deletedCf: false,
      deletedOld: false,
    }
    out.push(res)
    if (!id) {
      res.skipped = `${row.entityType} ${row.entity} 在 TB 中不存在`
      log(`✗ ${row.entity}.${row.old}:${res.skipped}`)
      continue
    }
    // 一行出错不拖垮其余行,也绝不让它走到删除那一步
    try {
      const pinned = opts.cutover?.[cutoverKey(row)]
      res.cutoverPinned = pinned !== undefined
      res.newFirstTs = pinned ?? (await firstTs(api, row.entityType, id, row.new))
      const upper = res.newFirstTs ?? now
      const from = opts.from ?? 0
      let batch: { ts: number; values: Record<string, unknown> }[] = []
      const flush = async () => {
        if (!batch.length) return
        if (opts.apply) await api(`/api/plugins/telemetry/${row.entityType}/${id}/timeseries/ANY`, batch)
        batch = []
      }
      for await (const pts of readPoints(api, row.entityType, id, row.old, from, upper, pageSize)) {
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
        `${opts.apply ? '✓' : '·'} ${row.entity}.${row.old} → ${row.new}:${res.points} 点(${span}${res.newFirstTs ? ',止于新 key 首点' : ''}${res.cutoverPinned ? ',上界取自状态文件' : ''})${opts.apply ? '' : ' [dry-run]'}`
      )

      if (opts.deleteOld && opts.apply) {
        // 删之前核对一次,两段都要过(审查 R4):中断重试且没带上一轮的上界时,上界会缩到
        // 「已搬进去的第一个点」,那时上界之后的新 key 是空的,newBeyond 明显少于 oldBeyond,这里就拦住了。
        const [oldInRange, newInRange, oldBeyond, newBeyond] = await Promise.all([
          countPoints(api, row.entityType, id, row.old, from, upper, pageSize),
          countPoints(api, row.entityType, id, row.new, from, upper, pageSize),
          countPoints(api, row.entityType, id, row.old, upper, now + 1, pageSize),
          countPoints(api, row.entityType, id, row.new, upper, now + 1, pageSize),
        ])
        const complete = newInRange >= oldInRange && newBeyond >= oldBeyond
        res.verified = { oldInRange, newInRange, oldBeyond, newBeyond, complete }
        if (!complete) {
          res.deleteSkipped =
            newInRange < oldInRange
              ? `上界之前旧 ${oldInRange} 点、新 key 只有 ${newInRange} 点,复制不完整,不删旧 key`
              : `上界 ${new Date(upper).toISOString().slice(0, 16)} 之后旧 ${oldBeyond} 点、新 key 只有 ${newBeyond} 点` +
                `(多半是上次中断后重试、没带上一轮的复制上界,上界被已搬进去的点带偏了),不删旧 key`
          log(`  ✗ ${res.deleteSkipped}`)
        } else {
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
          log(`  已删旧 key ${row.old} 的数据${cf ? ' 与同名 CF' : ''}(核对:旧 ${oldInRange} 点已在新 key)`)
        }
      }
    } catch (e) {
      res.error = e instanceof Error ? e.message : String(e)
      log(`✗ ${row.entity}.${row.old} → ${row.new}:${res.error}(本行中断,旧数据未删;重试请带上状态文件)`)
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
