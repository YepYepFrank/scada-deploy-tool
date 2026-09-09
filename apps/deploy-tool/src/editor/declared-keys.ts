/**
 * 「这次配置会产生、但可能还没发布」的输出(向导第 3 步 → 第 4 步)。
 *
 * 向导的顺序是:第 3 步配运算 → 第 4 步把结果绑到组件 → 第 5 步发布。而绑定选择器的测点来自
 * TB 上**已经存在**的遥测 key,所以第一次走流程时,第 3 步刚配好的 `calc_*` 在第 4 步一个都
 * 选不到——必须先发布、等规则跑出数据才会出现。这在流程上是死结,工程人员只能手输 key
 * (而「不用手输任何名字」正是一期的验收标准)。
 *
 * 解法:从站点声明直接推出输出清单,连同 TB 上已有的 key 一起给选择器,并标成「待发布」。
 * 推导用编译器的 `expandConfig` + `outputInventory`,与发布时真正写出的 key 是同一套逻辑
 * (设备模板展开、输出前缀、分层汇聚的分组键、级联各级、收益派生键都在内),不另写一份。
 *
 * 告警不在 `outputInventory` 里(它产出的是告警不是遥测),这里单独推:每条 `alarm.threshold`
 * 的 `name` 就是告警类型,挂在它作用的设备上;`alarm.propagate` 时告警会沿 `Contains` 传到
 * 站点资产,所以站点资产也给上。
 */
import { expandConfig, outputInventory } from '@grid/tbsite-compiler'

export interface DeclaredKey {
  entityType: 'DEVICE' | 'ASSET'
  /** 设备名或资产名(与元数据树上的名字对齐) */
  entity: string
  key: string
  /** cf / agg / rollup / cascade / revenue —— 供提示文案用 */
  kind: string
}
export interface DeclaredAlarm {
  entityType: 'DEVICE' | 'ASSET'
  entity: string
  type: string
}
export interface Declared {
  keys: DeclaredKey[]
  alarms: DeclaredAlarm[]
}

export const emptyDeclared = (): Declared => ({ keys: [], alarms: [] })

/** 某实体在本次配置里会产生的 key(按名字匹配,与 ADR-002 的实体解析口径一致) */
export function declaredKeysFor(d: Declared | null | undefined, entityType: string, name: string): DeclaredKey[] {
  if (!d || !name) return []
  return d.keys.filter(k => k.entityType === entityType && k.entity === name)
}
export function declaredAlarmsFor(d: Declared | null | undefined, entityType: string, name: string): string[] {
  if (!d || !name) return []
  return [...new Set(d.alarms.filter(a => a.entityType === entityType && a.entity === name).map(a => a.type))]
}

/**
 * 从 tbsite 站点声明推出输出清单。
 * 配置可能是半成品(用户正在填),推不动就回空,不要因此让编辑器出错。
 */
export function declaredFromSiteConfig(raw: unknown): Declared {
  const out = emptyDeclared()
  if (!raw || typeof raw !== 'object') return out
  try {
    const { cfg, computations, prefix } = expandConfig(raw as Parameters<typeof expandConfig>[0])
    for (const o of outputInventory(cfg, computations, prefix))
      out.keys.push({ entityType: o.entityType, entity: o.entity, key: o.key, kind: o.kind })

    const siteName = (cfg as { site?: { name?: string } }).site?.name
    const propagate = (cfg as { alarm?: { propagate?: boolean } }).alarm?.propagate === true
    for (const c of computations as Array<Record<string, unknown>>) {
      if (c.template !== 'alarm.threshold') continue
      const type = typeof c.name === 'string' ? c.name : ''
      if (!type) continue
      const devices = Array.isArray(c.devices)
        ? (c.devices as string[])
        : typeof c.device === 'string'
          ? [c.device]
          : []
      for (const dev of devices) out.alarms.push({ entityType: 'DEVICE', entity: dev, type })
      // propagate 时站点资产上也能看到全站告警,页面「告警列表」通常就绑它
      if (propagate && siteName) out.alarms.push({ entityType: 'ASSET', entity: siteName, type })
    }
  } catch {
    /* 配置还没填完整 —— 推不出来就不提示,不影响编辑器 */
  }
  return out
}
