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
      ...(claimed(g) ? { self: toDevice(g, null, o) } : {}),
      devices: [],
    })
  for (const d of devices) {
    if (d.isGateway || !claimed(d)) continue
    const gw = d.gwId ? gwById.get(d.gwId) : undefined
    if (gw) groups.get(gw.name)!.devices.push(toDevice(d, gw.name, o))
    else orphans.push(toDevice(d, null, o))
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

/** 字段里的点值 `设备||测点` */
export function splitPointValue(v: string | undefined): { device: string; key: string } | null {
  if (!v || !v.includes('||')) return null
  const i = v.indexOf('||')
  return { device: v.slice(0, i), key: v.slice(i + 2) }
}
export const joinPointValue = (device: string, key: string): string => `${device}||${key}`

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
