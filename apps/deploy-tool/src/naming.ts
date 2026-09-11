// 名称显示约定(2026-09-11 YY):部署工具里网关、设备、测点一律「中文(英文)」——中文在前,英文用全角括号包住;
// 没有中文就只显示英文。所有显示处都走这里,改格式只改这一个文件。
// 中文从哪来:设备 / 网关只取 TB 设备的「标签」(label,工程人员维护的;镜像 231 台里 209 台是中文名),不看「说明」;
// 测点取「遥测单位名称匹配接口」字典(k.cn)或人工填的中文业务名。

const CN = /[一-龥]/

/** 字符串里有没有汉字 */
export const hasCn = (s?: string | null): boolean => !!s && CN.test(s)

/** 「中文(英文)」;没有中文(或中文就是英文本身)只回英文 */
export function dual(cn: string | null | undefined, en: string): string {
  const c = (cn ?? '').trim()
  return c && c !== en && hasCn(c) ? `${c}（${en}）` : en
}

/** 测点键名 → 中文名(查不到回 '');编辑器里由 EditorApp provide、BindingRow inject */
export type KeyCnFn = (key: string) => string

/** 测点中文字典:key → { name, unit, type }(TB 资产「遥测单位名称匹配接口」的服务端属性) */
export type KeyDict = Record<string, { name: string; unit?: string; type?: string }>

/** 这个资产是不是测点中文字典 */
export const isKeyDictAsset = (a: { name: string; type?: string }): boolean =>
  a.type === '单位名称匹配表' || a.name === '遥测单位名称匹配接口'

/** 字典资产的服务端属性 → KeyDict(值可能是 JSON 串;没有 name 的条目跳过) */
export function parseKeyDict(attrs: { key: string; value: unknown }[]): KeyDict {
  const dict: KeyDict = {}
  for (const a of attrs ?? []) {
    try {
      const v = (typeof a.value === 'string' ? JSON.parse(a.value) : a.value) as {
        name?: string
        unit?: string
        type?: string
      } | null
      if (v?.name) dict[a.key] = { name: v.name, unit: v.unit || '', type: v.type || '' }
    } catch {
      /* 单条坏数据跳过 */
    }
  }
  return dict
}

const AGG_CN: Record<string, string> = { Avg: '均值', Min: '最小', Max: '最大', Sum: '求和' }
const WIN_CN: Record<string, string> = { '5m': '5分钟', '15m': '15分钟', '1h': '1小时', '1d': '1天' }
const REV_CN: Record<string, string> = {
  IncomeDaily: '放电收入·当日累计',
  CostDaily: '充电成本·当日累计',
  Income: '放电收入',
  Cost: '充电成本',
  Daily: '净收益·当日累计',
}

/**
 * 测点中文名:字典直查;派生测点按规则合成(PAvg5m → 有功功率 · 均值(5分钟)、PUsed1h、收益、totalP → 全站合计 · 有功功率);
 * 带输出前缀的(calc_PAvg5m)去掉前缀再认。查不到回 ''。
 */
export function keyCnFrom(dict: KeyDict, key: string): string {
  if (!key) return ''
  const direct = dict[key]?.name
  if (direct) return direct
  const k = key.startsWith('calc_') ? key.slice(5) : key
  if (k !== key && dict[k]?.name) return dict[k]!.name
  const base = (x: string) => dict[x]?.name || x
  let m = k.match(/^(.*?)(Avg|Min|Max|Sum)(5m|15m|1h|1d)$/)
  if (m) return `${base(m[1]!)} · ${AGG_CN[m[2]!]}(${WIN_CN[m[3]!]})`
  m = k.match(/^(.*?)(Used|Energy)(5m|15m|1h|1d)$/)
  if (m) return `${base(m[1]!)} · ${m[2] === 'Used' ? '区间用量' : '积分电量'}(${WIN_CN[m[3]!]})`
  m = k.match(/^(.*?)(IncomeDaily|CostDaily|Income|Cost|Daily)$/)
  if (m) return `收益 · ${REV_CN[m[2]!]}`
  if (k.startsWith('total') && dict[k.slice(5)]?.name) return `全站合计 · ${dict[k.slice(5)]!.name}`
  return ''
}

/**
 * 设备 / 网关的中文名:只取 TB 设备的「标签」(label)——工程人员维护的是标签;「说明」(additionalInfo.description)
 * 不作名称来源(2026-09-11 现场反馈:原来读说明,和工程人员填的对不上)。标签不含汉字 → ''。
 */
export function deviceCn(d: { label?: string | null }): string {
  return hasCn(d.label) ? (d.label as string).trim() : ''
}
