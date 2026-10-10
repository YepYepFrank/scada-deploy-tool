/**
 * 第 3 步「数据源」面板的数据整理(2026-09-23 YY:下拉太难用,改成点字段后右侧弹面板点选;
 * 分组按硬件组织结构 站 → 网关 → 设备 → 测点)。纯函数,不碰 Vue,单测直接调。
 *
 * - 只列第 2 步认领了测点的设备(与原来的下拉口径一致);网关自己认领了测点也能选;
 * - 设备按 lastConnectedGateway 挂到网关下,没挂网关的归「直连 / 未归网关设备」,放最后;
 * - 测点行带中文名、遥测 / 遥信(按平台测点字典)、单位、最近值。
 */

/** 第 2 步设备列表里的一台(Provisioner 的 devices 元素,只取这里用到的字段) */
export interface StepDevice {
  name: string
  cn?: string
  tbId?: string
  profile?: string
  isGateway?: boolean
  /** 所属网关的 TB id(additionalInfo.lastConnectedGateway) */
  gwId?: string | null
  keys: Array<{ key: string; label?: string; unit?: string; claimed?: boolean; latest?: unknown; cn?: string }>
}

export interface SourcePoint {
  key: string
  /** 选中后填回去的值;不给 = `设备||key`(属性、资产上的结果要带标记,见 formatPointValue) */
  value?: string
  /** 右栏里的分区:测点(缺省)/ 属性 / 运算结果(2026-10-10) */
  section?: string
  /** 「中文(英文)」 */
  text: string
  /** 第 3 步:遥测 / 遥信(按测点字典);第 4 步:数值 / 开关量 / 文本(按最近值);不知道为空 */
  kind: string
  unit: string
  latest: string
  /** 小标记,如「待发布」「运算结果」(第 4 步:本站配置的运算输出) */
  badge?: string
}

export interface SourceDevice {
  name: string
  /** 「中文(英文)」 */
  label: string
  profile: string
  /** 所属网关的设备名;null = 直连 / 未归网关 */
  gateway: string | null
  points: SourcePoint[]
  /** 设备模式下的附注,如「可用 3/4 项」 */
  note?: string
  /** 第 4 步:平台实体(name 字段放的是实体 id,重名的设备 / 资产也分得开) */
  ref?: { type: 'DEVICE' | 'ASSET'; id: string; name: string }
  /** 测点按需读(打开这台设备时才去平台拉) */
  lazy?: boolean
  /** 资产的层级缩进(站点资产 → 子资产) */
  depth?: number
}

export interface SourceGroup {
  id: string
  label: string
  /** 网关自己认领了测点时,它本身也是一台可选的设备 */
  self?: SourceDevice
  devices: SourceDevice[]
}

export interface BuildOptions {
  /** 每台设备额外列的(如本站运算在这台设备上的结果),排在认领测点后面 */
  extra?: (name: string) => SourcePoint[]
  /** 测点中文名(Provisioner 的 keyCn) */
  keyCn: (k: StepDevice['keys'][number]) => string
  /** 「中文(英文)」 */
  dual: (cn: string | null | undefined, en: string) => string
  /** 测点字典:key → { unit, type: 'YX' | 'YC' … } */
  dict?: Record<string, { unit?: string; type?: string } | undefined>
  /** 只列这些设备(常用方案只列具备所需测点的);不给 = 全部认领设备 */
  only?: ReadonlySet<string>
  /** 设备附注 */
  note?: (name: string) => string | undefined
}

/** key 模式的一项:各设备的同名测点 */
export interface KeyOption {
  key: string
  text: string
  /** 如「8/10 台」 */
  note?: string
  /** 遥测 / 遥信(按测点字典;开关变位告警只列遥信) */
  kind?: string
  /** 分区:测点(缺省)/ 属性 / 运算结果 */
  section?: string
}

/** 四则运算的「常数」项(值与旧配置里的常数项一致) */
export const CONST_VALUE = '__const__'

export const ORPHAN_GROUP_ID = 'group:direct'
export const ORPHAN_GROUP_LABEL = '直连 / 未归网关设备'

const short = (v: unknown): string => {
  if (v === undefined || v === null || v === '') return ''
  const s = typeof v === 'object' ? JSON.stringify(v) : String(v)
  return s.length > 12 ? s.slice(0, 11) + '…' : s
}

const kindOf = (type: string | undefined): string => (type === 'YX' ? '遥信' : type === 'YC' ? '遥测' : '')

function toDevice(d: StepDevice, gateway: string | null, o: BuildOptions): SourceDevice {
  return {
    name: d.name,
    label: o.dual(d.cn, d.name),
    profile: d.profile ?? '',
    gateway,
    points: d.keys
      .filter(k => k.claimed)
      .map(k => ({
        key: k.key,
        text: o.dual(o.keyCn(k), k.key),
        kind: kindOf(o.dict?.[k.key]?.type),
        unit: k.unit || o.dict?.[k.key]?.unit || '',
        latest: short(k.latest),
      })),
    ...(o.note?.(d.name) ? { note: o.note(d.name) } : {}),
  }
}
const withExtra = (dev: SourceDevice, o: BuildOptions): SourceDevice => {
  const more = o.extra?.(dev.name) ?? []
  return more.length ? { ...dev, points: [...dev.points, ...more] } : dev
}

const byLabel = (a: { label: string }, b: { label: string }) => a.label.localeCompare(b.label, 'zh-CN')

/** 站 → 网关 → 设备:网关按名排,网关下设备按名排,直连设备一组放最后;空网关不列 */
export function buildSourceGroups(devices: readonly StepDevice[], o: BuildOptions): SourceGroup[] {
  const claimed = (d: StepDevice) => d.keys.some(k => k.claimed) && (!o.only || o.only.has(d.name))
  const gateways = devices.filter(d => d.isGateway)
  const gwById = new Map(gateways.filter(g => g.tbId).map(g => [g.tbId!, g]))
  const groups = new Map<string, SourceGroup>()
  const orphans: SourceDevice[] = []
  for (const g of gateways)
    groups.set(g.name, {
      id: `gw:${g.name}`,
      label: o.dual(g.cn, g.name),
      ...(claimed(g) ? { self: withExtra(toDevice(g, null, o), o) } : {}),
      devices: [],
    })
  for (const d of devices) {
    if (d.isGateway || !claimed(d)) continue
    const gw = d.gwId ? gwById.get(d.gwId) : undefined
    if (gw) groups.get(gw.name)!.devices.push(withExtra(toDevice(d, gw.name, o), o))
    else orphans.push(withExtra(toDevice(d, null, o), o))
  }
  const out = [...groups.values()].filter(g => g.self || g.devices.length).sort(byLabel)
  for (const g of out) g.devices.sort(byLabel)
  if (orphans.length) out.push({ id: ORPHAN_GROUP_ID, label: ORPHAN_GROUP_LABEL, devices: orphans.sort(byLabel) })
  return out
}

/** 所有可选设备(含网关本体),按树的顺序 */
export const allSourceDevices = (groups: readonly SourceGroup[]): SourceDevice[] =>
  groups.flatMap(g => (g.self ? [g.self, ...g.devices] : g.devices))

export const findSourceDevice = (groups: readonly SourceGroup[], name: string): SourceDevice | undefined =>
  allSourceDevices(groups).find(d => d.name === name)

/** 设备所在的组 id(打开面板时展开它) */
export const groupOfDevice = (groups: readonly SourceGroup[], name: string): string | undefined =>
  groups.find(g => g.self?.name === name || g.devices.some(d => d.name === name))?.id

const hit = (text: string, q: string) => text.toLowerCase().includes(q)

export interface SearchHit {
  device: SourceDevice
  point: SourcePoint
}

/**
 * 跨设备搜测点:测点的中文名 / key 命中,或设备名命中(那就列它的全部测点)。
 * 最多 limit 条,免得几百台设备的站一次渲染上万行。
 */
export function searchPoints(groups: readonly SourceGroup[], q: string, limit = 200): SearchHit[] {
  const t = q.trim().toLowerCase()
  if (!t) return []
  const out: SearchHit[] = []
  for (const device of allSourceDevices(groups)) {
    const devHit = hit(device.label, t)
    for (const point of device.points) {
      if (devHit || hit(point.text, t)) out.push({ device, point })
      if (out.length >= limit) return out
    }
  }
  return out
}

/** 搜索时左侧树只留:设备名命中、或有测点命中的设备;网关名命中则整组保留 */
export function filterGroups(groups: readonly SourceGroup[], q: string, withPoints = true): SourceGroup[] {
  const t = q.trim().toLowerCase()
  if (!t) return groups.slice()
  const keep = (d: SourceDevice) => hit(d.label, t) || (withPoints && d.points.some(p => hit(p.text, t)))
  return groups.flatMap(g => {
    if (hit(g.label, t)) return [g]
    const self = g.self && keep(g.self) ? g.self : undefined
    const devices = g.devices.filter(keep)
    return self || devices.length ? [{ ...g, ...(self ? { self } : { self: undefined }), devices }] : []
  })
}

/** TB 属性范围 */
export type AttrScope = 'SERVER_SCOPE' | 'SHARED_SCOPE' | 'CLIENT_SCOPE'
export const ATTR_SCOPE_TEXT: Record<AttrScope, string> = {
  SERVER_SCOPE: '服务端属性',
  SHARED_SCOPE: '共享属性',
  CLIENT_SCOPE: '客户端属性',
}
/** 面板「类型」一栏放得下的短名(分区标题已经写了「属性」) */
const ATTR_SCOPE_SHORT: Record<AttrScope, string> = {
  SERVER_SCOPE: '服务端',
  SHARED_SCOPE: '共享',
  CLIENT_SCOPE: '客户端',
}

/**
 * 字段里的点值。基本形是 `设备||测点`(设备的最新遥测);2026-10-10 起可以再带标记段:
 *  - `||@attr:SERVER_SCOPE`:取这台设备的属性;
 *  - `||@asset`:`设备` 位置放的是结果资产名,取资产上的运算结果。
 * 与编译器的 KeyRef 一一对应(attr / entityType)。
 */
export interface PointRef {
  device: string
  key: string
  attr?: AttrScope
  entityType?: 'ASSET'
}
export function splitPointValue(v: string | undefined): PointRef | null {
  if (!v || !v.includes('||')) return null
  const [device, key = '', ...flags] = v.split('||')
  const r: PointRef = { device: device!, key }
  for (const f of flags) {
    if (f.startsWith('@attr:')) r.attr = f.slice(6) as AttrScope
    else if (f === '@asset') r.entityType = 'ASSET'
  }
  return r
}
export const joinPointValue = (device: string, key: string): string => `${device}||${key}`
export const formatPointValue = (r: PointRef): string =>
  joinPointValue(r.device, r.key) + (r.attr ? `||@attr:${r.attr}` : '') + (r.entityType === 'ASSET' ? '||@asset' : '')

/** 设备模板 / 全站汇聚这种只有 key 的值:属性写成 `key||@attr:范围`,普通测点就是裸 key */
export function splitKeyValue(v: string | undefined): { key: string; attr?: AttrScope } {
  if (!v) return { key: '' }
  const [key = '', ...flags] = v.split('||')
  const attr = flags.find(f => f.startsWith('@attr:'))?.slice(6) as AttrScope | undefined
  return attr ? { key, attr } : { key }
}
export const formatKeyValue = (r: { key: string; attr?: AttrScope }): string =>
  r.attr ? `${r.key}||@attr:${r.attr}` : r.key

/** TB 自己维护的设备属性(在线状态、活动时间)与本工具的内部属性,不给当运算输入 */
const SYSTEM_ATTR = /^(active|last\w*Time|inactivity\w*)$|__day$|^almState_/

/** 平台读回的属性行 → 面板行;只留数值型(运算只能算数),系统属性不列 */
export function attrPoints(
  device: string,
  rows: Array<{ scope: AttrScope; key: string; value: unknown }>,
  short: (v: unknown) => string = v => String(v)
): SourcePoint[] {
  return rows
    .filter(r => !SYSTEM_ATTR.test(r.key))
    .filter(
      r =>
        typeof r.value === 'number' ||
        (typeof r.value === 'string' && r.value.trim() !== '' && Number.isFinite(Number(r.value)))
    )
    .sort((a, b) => a.key.localeCompare(b.key))
    .map(r => ({
      key: r.key,
      value: formatPointValue({ device, key: r.key, attr: r.scope }),
      section: '属性',
      text: r.key,
      kind: ATTR_SCOPE_SHORT[r.scope],
      unit: '',
      latest: short(r.value),
    }))
}

/** 本站运算的结果(编译器 outputInventory 的一行,或第 4 步的 DeclaredKey) */
export interface ResultKey {
  entityType: 'DEVICE' | 'ASSET'
  entity: string
  key: string
  kind: string
}
/** 「类型」一栏:结果出自哪类运算(分区标题已经写了「运算结果」) */
const RESULT_KIND_TEXT: Record<string, string> = {
  cf: '即时',
  agg: '汇聚',
  rollup: '统计',
  cascade: '归档',
  revenue: '收益',
}
/** 结果 → 面板行(分区「运算结果」);分层汇聚的分组键(`__p0`)是内部中间量,不列 */
export function resultPoints(
  results: readonly ResultKey[],
  entityType: 'DEVICE' | 'ASSET',
  entity: string,
  text: (key: string) => string
): SourcePoint[] {
  return results
    .filter(r => r.entityType === entityType && r.entity === entity && !/__p\d+$/.test(r.key))
    .map(r => ({
      key: r.key,
      value: formatPointValue({
        device: entity,
        key: r.key,
        ...(entityType === 'ASSET' ? { entityType: 'ASSET' as const } : {}),
      }),
      section: '运算结果',
      text: text(r.key),
      kind: RESULT_KIND_TEXT[r.kind] ?? '结果',
      unit: '',
      latest: '',
    }))
}

export const RESULT_GROUP_ID = 'group:results'
/** 结果资产(跨设备即时计算 / 全站汇聚 / 收益的结果所在)一组,放最后 */
export function resultAssetGroup(results: readonly ResultKey[], text: (key: string) => string): SourceGroup | null {
  const assets = [...new Set(results.filter(r => r.entityType === 'ASSET').map(r => r.entity))].sort()
  const devices = assets
    .map(a => ({
      name: a,
      label: a,
      profile: '结果资产',
      gateway: null,
      points: resultPoints(results, 'ASSET', a, text),
    }))
    .filter(d => d.points.length)
  return devices.length ? { id: RESULT_GROUP_ID, label: '运算结果资产', devices } : null
}

/* ───────────── 第 4 步:从元数据树(站 → 网关 → 设备 / 资产)整理 ───────────── */

/** 元数据树节点(meta/MetaNode 的结构;这里只用到这些字段) */
export interface MetaLike {
  id: string
  name: string
  kind: string
  label?: string
  profile?: string
  entity?: { type: 'DEVICE' | 'ASSET'; id: string; name?: string }
  children: MetaLike[]
}

/** 第 4 步:打开某台设备时读它的测点 / 属性 */
export type PointsLoader = (device: SourceDevice) => Promise<SourcePoint[]>

/**
 * 元数据树 → 面板分组:每个网关一组(网关本体可选),「直连 / 未归网关设备」一组,「资产」一组(按包含关系缩进)。
 * 设备的 name 放实体 id(值为 `实体id||key`),测点标记为按需读取。
 */
export function metaToSourceGroups(
  root: MetaLike | null | undefined,
  dual: (cn: string | null | undefined, en: string) => string
): SourceGroup[] {
  if (!root) return []
  const toDev = (n: MetaLike, depth = 0): SourceDevice => ({
    name: n.entity!.id,
    label: dual(n.label, n.name),
    profile: n.profile ?? '',
    gateway: null,
    points: [],
    ref: { type: n.entity!.type, id: n.entity!.id, name: n.entity!.name || n.name },
    lazy: true,
    ...(depth ? { depth } : {}),
  })
  const flat = (list: MetaLike[], depth: number): SourceDevice[] =>
    list.flatMap(n => [...(n.entity ? [toDev(n, depth)] : []), ...flat(n.children, n.entity ? depth + 1 : depth)])
  const out: SourceGroup[] = []
  for (const c of root.children) {
    if (c.kind === 'gateway' && c.entity)
      out.push({ id: `gw:${c.id}`, label: dual(c.label, c.name), self: toDev(c), devices: flat(c.children, 0) })
    else if (c.entity) out.push({ id: `one:${c.id}`, label: dual(c.label, c.name), self: toDev(c), devices: [] })
    else {
      const devices = flat(c.children, 0)
      if (devices.length) out.push({ id: c.id, label: c.name, devices })
    }
  }
  return out
}
