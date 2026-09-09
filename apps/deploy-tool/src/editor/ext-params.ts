/**
 * ext(kz)绑定参数的形状(契约 §4.3b,第三轮回填 2026-09-06 冻结)。两种查询,
 * tbClient(与 `LegacyDataSource.ext`)按 `params.keys` 是不是数组分派:
 *
 *   通用归档历史 `{ entity, keys, agg?, startTs?, endTs? }` → GET  /kzserver/tskv/{桶}/telemetry/…
 *   收益趋势     `{ stationId, metric? }`                   → POST /kzserver/biz/power/stationRevenueTrend
 *
 * 本文件只做形状判定与静态检查(不连网),给绑定编辑表单和校验层共用 —— 两边同一份规则,
 * 免得「编辑器让填、校验层不认」或反过来。
 *
 * `stationId` 是 kz 的站点标识,实测等于 TB 里 **`gateway` 类型设备的 id**
 * (镜像:`bs_1_ems` `84a690c0…` 有收益数据;非网关设备 kz 报「该站点下无设备」),
 * 所以站点也能从元数据树里点选,不必手抄 UUID。
 */
import type { EntityRef } from '@grid/tb-client'
import { KZ_AGGS, KZ_BUCKETS } from '@grid/tb-client'

export type ExtParams = Record<string, unknown>

/**
 * 一条 ext 绑定里我们关心的部分。入参一律收 `unknown`:调用方常常拿着 `Binding` 联合类型
 * 或半成品对象,收窄成具体接口反而要处处断言(而且全可选的接口会触发 TS 的弱类型检查)。
 */
interface ExtLike {
  source?: unknown
  window?: unknown
  interval?: unknown
  params?: unknown
}
const asExt = (b: unknown): ExtLike => (b && typeof b === 'object' ? (b as ExtLike) : {})

/** `history` 通用归档历史 · `revenue` 收益趋势 · `unknown` 两者都不像(新建 / 手写坏了) */
export type ExtKind = 'history' | 'revenue' | 'unknown'

/** 一期只有 kz */
export const EXT_SOURCES = ['kz'] as const

export const EXT_KIND_LABEL: Record<Exclude<ExtKind, 'unknown'>, string> = {
  history: '归档历史(任意实体 + 测点)',
  revenue: '收益趋势(站点逐日 / 逐月)',
}

/** 收益趋势的三条序列;一条绑定只画一条,所以必须选一个 */
export const EXT_METRICS = [
  { value: 'inc', label: '放电收益' },
  { value: 'cost', label: '充电成本' },
  { value: 'net', label: '净收益' },
] as const

/** 归档历史的聚合,取 tb-client 那一份 */
export const EXT_AGGS = [...KZ_AGGS] as string[]
const AGG_LABEL: Record<string, string> = { AVG: '平均', MAX: '最大', MIN: '最小', ZD: '增量(ZD)' }
export const aggLabel = (a: string) => (AGG_LABEL[a] ? `${a} · ${AGG_LABEL[a]}` : a)

/** kz 支持的粒度 */
export const EXT_INTERVALS = Object.keys(KZ_BUCKETS) as string[]

const obj = (v: unknown): ExtParams => (v && typeof v === 'object' && !Array.isArray(v) ? (v as ExtParams) : {})

/** 判定分支:**与 tbClient 的分派条件一字不差**(`Array.isArray(params.keys)` 优先) */
export function extKind(b: unknown): ExtKind {
  const p = obj(asExt(b).params)
  if (Array.isArray(p.keys)) return 'history'
  if ('stationId' in p) return 'revenue'
  return 'unknown'
}

export const extEntity = (b: unknown): EntityRef | undefined => {
  const e = obj(asExt(b).params).entity as EntityRef | undefined
  return e && typeof e === 'object' ? e : undefined
}
export const extKeys = (b: unknown): string[] => (obj(asExt(b).params).keys as unknown[] | undefined)?.map(String) ?? []
export const extStationId = (b: unknown): string => String(obj(asExt(b).params).stationId ?? '')
export const extMetric = (b: unknown): string => String(obj(asExt(b).params).metric ?? '')
export const extAgg = (b: unknown): string => String(obj(asExt(b).params).agg ?? '')

/** 换查询类型:换一套最小合法 params(保留能保留的实体) */
export function emptyExtParams(kind: Exclude<ExtKind, 'unknown'>, entity?: EntityRef): ExtParams {
  return kind === 'history'
    ? { entity: entity ?? { type: 'DEVICE', id: '', name: '' }, keys: [] }
    : { stationId: entity?.type === 'DEVICE' ? entity.id : '' }
}

/** 填完整了没有(给 checkSlot / 校验层的「未填完整」用) */
export function extComplete(b: unknown): boolean {
  if (!asExt(b).source) return false
  switch (extKind(b)) {
    case 'history': {
      const e = extEntity(b)
      const ks = extKeys(b).filter(Boolean)
      return !!e?.type && !!e.id && ks.length > 0
    }
    case 'revenue':
      return !!extStationId(b)
    default:
      return false
  }
}

export interface ExtIssue {
  level: 'error' | 'warning'
  /** 相对绑定的子路径,拼到 `/widgets/<id>/bindings/<slot>` 后面 */
  sub: string
  message: string
}

/**
 * 静态检查(不连 TB)。存在性(实体在不在、key 在不在)在校验层第 ② 层另做。
 *
 * 「只画第一条序列」是渲染器的既定行为(`binding-resolver` 取 `Object.values(series)[0]`),
 * 与 ts-history 的审查 R3 同一回事:多写的会被悄悄丢掉,所以这里拦住。
 */
export function checkExt(b: unknown): ExtIssue[] {
  const e = asExt(b)
  const out: ExtIssue[] = []
  const src = String(e.source ?? '')
  if (!src) out.push({ level: 'error', sub: '/source', message: '外部源未填(一期填 kz)' })
  else if (!(EXT_SOURCES as readonly string[]).includes(src))
    out.push({ level: 'error', sub: '/source', message: `不支持的外部源「${src}」:一期只有 kz` })

  const interval = e.interval === undefined || e.interval === '' ? '' : String(e.interval)
  if (interval && !EXT_INTERVALS.includes(interval))
    out.push({
      level: 'error',
      sub: '/interval',
      message: `kz 不支持的粒度「${interval}」,可选 ${EXT_INTERVALS.join(' / ')}`,
    })

  switch (extKind(b)) {
    case 'history': {
      const ent = extEntity(b)
      if (!ent?.type || !ent.id)
        out.push({ level: 'error', sub: '/params/entity', message: '归档历史要选实体(params.entity 缺 type / id)' })
      const ks = extKeys(b).filter(Boolean)
      if (!ks.length)
        out.push({ level: 'error', sub: '/params/keys', message: '归档历史要选一个测点(params.keys 为空)' })
      else if (ks.length > 1)
        out.push({
          level: 'error',
          sub: '/params/keys',
          message:
            `一条 kz 归档绑定只画一条序列,只会用第一个测点「${ks[0]}」,` +
            `${ks.slice(1).join('、')} 会被丢掉。要画多条曲线,请在这个槽位「+ 添加一条」绑定。`,
        })
      const agg = extAgg(b)
      if (agg && !EXT_AGGS.includes(agg))
        out.push({
          level: 'error',
          sub: '/params/agg',
          message: `kz 不支持的聚合「${agg}」,可选 ${EXT_AGGS.join(' / ')}`,
        })
      if (interval === '1y')
        out.push({
          level: 'warning',
          sub: '/interval',
          message: 'kz 的年桶只回单点,图上基本看不出东西;长窗口建议用 1M(逐月)',
        })
      break
    }
    case 'revenue': {
      if (!extStationId(b))
        out.push({
          level: 'error',
          sub: '/params/stationId',
          message: '收益趋势要选站点(kz 的站点 = TB 里的 gateway 设备)',
        })
      const m = extMetric(b)
      if (!m)
        out.push({
          level: 'warning',
          sub: '/params/metric',
          message: `收益趋势有 ${EXT_METRICS.map(x => x.label).join(' / ')} 三条序列,一条绑定只画一条 —— 没选指标就默认画「${EXT_METRICS[0].label}」`,
        })
      else if (!EXT_METRICS.some(x => x.value === m))
        out.push({
          level: 'error',
          sub: '/params/metric',
          message: `未知指标「${m}」,可选 ${EXT_METRICS.map(x => `${x.value}(${x.label})`).join(' / ')}`,
        })
      break
    }
    default:
      out.push({
        level: 'error',
        sub: '/params',
        message: 'params 既不是归档历史 { entity, keys } 也不是收益趋势 { stationId },kz 无法分派',
      })
  }
  return out
}
