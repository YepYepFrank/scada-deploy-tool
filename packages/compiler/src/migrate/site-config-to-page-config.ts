/**
 * T3.1:既有站点配置(tbsite `layout.pages[].slots`,向导第 4 步的组态)一次性迁成契约 v1 的 PageConfig。
 * 纯函数、无网络:实体名 → id 的映射由调用方给(向导从 TB 解析,脚本从镜像查)。
 *
 * 旧模型:page.template ∈ console | focus | monitor3;slot = { kind, device, key, card, title, extra?, max?, deviceLabel? }
 *   kind:metric(设备遥测)/ agg(汇聚资产遥测,device 字段是资产名)/ alarm(告警名 = key)/ report(kz 报表,device 是站点 id)/ alarmlist
 *   card:stat gauge alarm | line bar multi combo overview gauge alarmlist map
 * 新模型:template ∈ overview-a | monitor-3col;widget = { id, slot, type, props, bindings }
 *
 * 映射(计划 T3.1;两处按注册表现状调整,见 notes):
 *   stat → number-card · gauge → gauge · alarm → alarm-list(types = [告警名];计划写的 status-light 没有 alarm 绑定模式)
 *   line/bar → line(单序列,ts-history,窗口按旧 historyMinutes 规则)· multi → line(N 序列)· combo → dual-axis
 *   overview → overview-card · alarmlist → alarm-list(绑站点资产)· map → 不支持,槽位留空 · report → line(mode:'ext',ADR-004 过渡路线 A)
 *   console → overview-a · focus → overview-a(降级,槽位名相同)· monitor3 → monitor-3col(main 留空)
 * 丢弃:layout.header(标题并入 PageConfig.title)、display(非组态老模式)、slot.deviceLabel。
 */

export interface LegacyRef {
  kind?: string
  device: string
  key: string
}
export interface LegacySlot extends LegacyRef {
  card: string
  title?: string
  extra?: LegacyRef[]
  max?: number
  deviceLabel?: string
}
export interface LegacyPage {
  id: string
  title?: string
  template?: string
  slots?: Record<string, LegacySlot>
}
export interface LegacyLayout {
  header?: { title?: string; subtitle?: string; showClock?: boolean; showDate?: boolean }
  pages?: LegacyPage[]
}
export interface LegacySiteConfig {
  site: { name: string; label?: string }
  devices?: { name: string; keys?: { key: string; label?: string; unit?: string }[] }[]
  layout?: LegacyLayout
  display?: unknown[]
  [k: string]: unknown
}

/** 名称 → TB id。devices 按设备名,assets 按资产名(汇聚资产、站点资产)。 */
export interface EntityIds {
  devices: Record<string, string>
  assets?: Record<string, string>
}

export interface MigrationNote {
  level: 'info' | 'warn' | 'error'
  page?: string
  slot?: string
  message: string
}

/** 与 @grid/scada-renderer 的 PageConfig 结构一致(本包不依赖渲染器,故只描述形状) */
export interface PageConfigLike {
  schemaVersion: 1
  template: string
  title?: string
  widgets: WidgetLike[]
}
export interface WidgetLike {
  id: string
  slot: string
  type: string
  props?: Record<string, unknown>
  bindings: Record<string, unknown>
}
export interface MigratedPage {
  legacyId: string
  legacyTemplate: string
  title: string
  config: PageConfigLike
}
export interface MigrationResult {
  pages: MigratedPage[]
  notes: MigrationNote[]
  /** 解析不到 id 的实体名(页面里对应的 EntityRef.id 为 `unresolved:<名>`,不可发布) */
  unresolved: string[]
}

export interface MigrateOptions {
  /** 站点资产名(默认 cfg.site.name),告警横幅 / 告警列表绑它 */
  siteAssetName?: string
  /** kz 报表槽位的 ext 参数形状待冻结,这里先按 { stationId, metric } */
  reportSource?: string
}

const TEMPLATE_MAP: Record<string, string> = { console: 'overview-a', focus: 'overview-a', monitor3: 'monitor-3col' }
const BANNER_TEMPLATES = new Set(['overview-a', 'monitor-3col'])

/** 旧 SiteView.historyMinutes:5/15 分钟级取 1 天,小时级 7 天,天级 / 日累计 90 天;普通测点 折线 15 分钟 / 柱状 3 小时 */
export function legacyHistoryWindow(key: string, card: string): string {
  if (/Daily$/.test(key) || /1d$/.test(key)) return '90d'
  if (/1h$/.test(key)) return '7d'
  if (/(5m|15m)$/.test(key)) return '24h'
  return card === 'bar' ? '3h' : '15m'
}

export function migrateSiteConfig(cfg: LegacySiteConfig, ids: EntityIds, opts: MigrateOptions = {}): MigrationResult {
  const notes: MigrationNote[] = []
  const unresolved = new Set<string>()
  const siteAssetName = opts.siteAssetName ?? cfg.site.name
  const reportSource = opts.reportSource ?? 'kz'
  const layout = cfg.layout ?? {}

  if (layout.header)
    notes.push({
      level: 'info',
      message: `layout.header 已丢弃(标题「${layout.header.title ?? ''}」并入各页 title;时钟 / 日期由宿主决定)`,
    })
  if (Array.isArray(cfg.display) && cfg.display.length)
    notes.push({ level: 'info', message: `display(${cfg.display.length} 项,非组态老模式)已丢弃;只迁 layout.pages` })

  // 元数据:设备 key 的中文名 / 单位
  const meta = (device: string, key: string) => {
    const k = cfg.devices?.find(d => d.name === device)?.keys?.find(x => x.key === key)
    return { label: k?.label && k.label !== key ? k.label : key, unit: k?.unit ?? '' }
  }
  const entity = (ref: LegacyRef, page: string, slot: string) => {
    const isAsset = ref.kind === 'agg'
    const map = isAsset ? (ids.assets ?? {}) : ids.devices
    const id = map[ref.device]
    if (!id) {
      unresolved.add(ref.device)
      notes.push({
        level: 'error',
        page,
        slot,
        message: `${isAsset ? '资产' : '设备'}「${ref.device}」解析不到 id,发布前需先认领 / 建好`,
      })
    }
    return { type: isAsset ? 'ASSET' : 'DEVICE', id: id ?? `unresolved:${ref.device}`, name: ref.device }
  }
  const siteEntity = (page: string, slot: string) => {
    const id = ids.assets?.[siteAssetName]
    if (!id) {
      unresolved.add(siteAssetName)
      notes.push({
        level: 'warn',
        page,
        slot,
        message: `站点资产「${siteAssetName}」解析不到 id,告警列表暂绑占位;发布前需先建站点资产`,
      })
    }
    return { type: 'ASSET', id: id ?? `unresolved:${siteAssetName}`, name: siteAssetName }
  }
  const tsHistory = (ref: LegacyRef, card: string, page: string, slot: string) => ({
    mode: 'ts-history',
    entity: entity(ref, page, slot),
    keys: [ref.key],
    window: legacyHistoryWindow(ref.key, card),
  })
  const ts = (ref: LegacyRef, page: string, slot: string) => ({
    mode: 'ts',
    entity: entity(ref, page, slot),
    key: ref.key,
  })

  const pages: MigratedPage[] = []
  for (const p of layout.pages ?? []) {
    const legacyTemplate = p.template ?? 'console'
    const template = TEMPLATE_MAP[legacyTemplate]
    const pid = p.id
    if (!template)
      notes.push({ level: 'warn', page: pid, message: `未知旧模板「${legacyTemplate}」,按 overview-a 处理` })
    if (legacyTemplate === 'focus')
      notes.push({
        level: 'info',
        page: pid,
        message: '旧模板 focus(重点监控屏)降级为 overview-a:s1–s3 / g1–g3 原位迁入,g1 不再通栏,s4 / g4 留空',
      })
    if (legacyTemplate === 'monitor3')
      notes.push({
        level: 'info',
        page: pid,
        message: 'monitor3 → monitor-3col:l1–l3 / c1–c2 / r1–r3 原位迁入,main 槽位留空(接线图暂缓,可放 image)',
      })
    const tpl = template ?? 'overview-a'
    const title = [layout.header?.title, p.title].filter(Boolean).join(' · ') || cfg.site.label || cfg.site.name
    const widgets: WidgetLike[] = []
    if (BANNER_TEMPLATES.has(tpl))
      widgets.push({
        id: 'banner',
        slot: 'banner',
        type: 'alarm-list',
        props: { title: '实时告警', compact: true, maxRows: 5 },
        bindings: { alarms: { mode: 'alarm', entity: siteEntity(pid, 'banner') } },
      })

    for (const [slotId, s] of Object.entries(p.slots ?? {})) {
      const w = migrateSlot(slotId, s, pid)
      if (w) widgets.push(w)
    }
    pages.push({ legacyId: pid, legacyTemplate, title, config: { schemaVersion: 1, template: tpl, title, widgets } })
  }
  if (!pages.length) notes.push({ level: 'warn', message: '没有 layout.pages,未产出任何页面' })

  return { pages, notes, unresolved: [...unresolved] }

  function migrateSlot(slotId: string, s: LegacySlot, pid: string): WidgetLike | null {
    const id = `w-${slotId}`
    const title = s.title || s.key
    const m = meta(s.device, s.key)
    const sub = s.device ? `${s.device} · ${s.key}` : ''
    if (s.deviceLabel)
      notes.push({
        level: 'info',
        page: pid,
        slot: slotId,
        message: `deviceLabel「${s.deviceLabel}」已丢弃(EntityRef.name 承担显示名)`,
      })

    if (s.kind === 'report') {
      notes.push({
        level: 'warn',
        page: pid,
        slot: slotId,
        message: `kz 报表「${title}」按 ADR-004 过渡路线 A 迁为 line + ext(source=${reportSource});ext.params 形状待冻结,同事 kz 接口定稿后核对`,
      })
      return {
        id,
        slot: slotId,
        type: 'line',
        props: { title, subtitle: `${s.deviceLabel ?? ''} 逐日 · 30D`.trim(), unit: '元', style: 'bar' },
        bindings: {
          series: [
            {
              mode: 'ext',
              source: reportSource,
              window: '30d',
              interval: '1d',
              params: { stationId: s.device, metric: s.key },
            },
          ],
        },
      }
    }
    if (s.card === 'alarmlist' || s.kind === 'alarmlist')
      return {
        id,
        slot: slotId,
        type: 'alarm-list',
        props: { title: title || '实时告警', maxRows: 10 },
        bindings: { alarms: { mode: 'alarm', entity: siteEntity(pid, slotId) } },
      }
    if (s.kind === 'alarm' || s.card === 'alarm') {
      notes.push({
        level: 'info',
        page: pid,
        slot: slotId,
        message: `告警状态卡「${title}」迁为 alarm-list(只看告警类型「${s.key}」);计划里的 status-light 没有 alarm 绑定模式`,
      })
      return {
        id,
        slot: slotId,
        type: 'alarm-list',
        props: { title, subtitle: s.key, compact: true, maxRows: 3 },
        bindings: { alarms: { mode: 'alarm', entity: entity(s, pid, slotId), types: [s.key] } },
      }
    }
    switch (s.card) {
      case 'stat':
        return {
          id,
          slot: slotId,
          type: 'number-card',
          props: { title, subtitle: m.label !== title ? m.label : s.key, unit: m.unit, decimals: 1, sub },
          bindings: { value: ts(s, pid, slotId) },
        }
      case 'gauge':
        return {
          id,
          slot: slotId,
          type: 'gauge',
          props: {
            title,
            subtitle: m.label !== title ? m.label : s.key,
            unit: m.unit,
            min: 0,
            max: s.max ?? 100,
            decimals: 1,
          },
          bindings: { value: ts(s, pid, slotId) },
        }
      case 'line':
      case 'bar':
        return {
          id,
          slot: slotId,
          type: 'line',
          props: { title, subtitle: `${s.device} · ${s.key}`, unit: m.unit, style: s.card === 'bar' ? 'bar' : 'area' },
          bindings: { series: [tsHistory(s, s.card, pid, slotId)] },
        }
      case 'multi': {
        const all = [s, ...(s.extra ?? [])]
        return {
          id,
          slot: slotId,
          type: 'line',
          props: { title, subtitle: `${all.length} 序列`, unit: m.unit, style: 'line', showLegend: true },
          bindings: { series: all.map(r => tsHistory(r, 'line', pid, slotId)) },
        }
      }
      case 'combo': {
        const r = s.extra?.[0]
        if (!r)
          notes.push({ level: 'warn', page: pid, slot: slotId, message: `双轴组合图「${title}」没有副轴测点,只迁主轴` })
        const bindings: Record<string, unknown> = { primary: tsHistory(s, 'line', pid, slotId) }
        if (r) bindings.secondary = tsHistory(r, 'line', pid, slotId)
        return {
          id,
          slot: slotId,
          type: 'dual-axis',
          props: { title, unitL: m.unit, unitR: r ? meta(r.device, r.key).unit : '' },
          bindings,
        }
      }
      case 'overview': {
        const all = [s, ...(s.extra ?? [])]
        return {
          id,
          slot: slotId,
          type: 'overview-card',
          props: {
            title,
            items: all.map(r => ({ label: meta(r.device, r.key).label, unit: meta(r.device, r.key).unit })),
          },
          bindings: { items: all.map(r => ts(r, pid, slotId)) },
        }
      }
      case 'map':
        notes.push({
          level: 'warn',
          page: pid,
          slot: slotId,
          message: `地图轨迹「${title}」一期不支持,槽位 ${slotId} 留空`,
        })
        return null
      default:
        notes.push({ level: 'warn', page: pid, slot: slotId, message: `未知卡片类型「${s.card}」,槽位 ${slotId} 留空` })
        return null
    }
  }
}
