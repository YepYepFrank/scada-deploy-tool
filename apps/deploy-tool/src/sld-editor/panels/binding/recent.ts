/**
 * 最近用过的设备(2026-09-23 内测反馈「每次都要从站点-设备-测点;能否默认使用上一次的设备」):
 * 在绑定面板里选过 / 绑过的设备记下来,最新的在最前,最多 6 台;没指定设备的节点缺省就用第一台。
 * 按站点分开记(不同站点的设备不相干),存本机浏览器——关掉编辑器再开还在。读写都兜住异常:
 * 隐私窗口、禁用存储时退回只在内存里记,功能照样能用。
 */
import { ref, type Ref } from 'vue'
import type { EntityRef } from '@grid/tb-client'

export interface RecentDevice {
  type: EntityRef['type']
  id: string
  name: string
}

export const RECENT_MAX = 6
const STORAGE_PREFIX = 'gridops_sld_recent_devices:'

const stores = new Map<string, Ref<RecentDevice[]>>()
const keyOf = (site: string | undefined): string => STORAGE_PREFIX + (site || '_')

const valid = (x: unknown): x is RecentDevice =>
  !!x &&
  typeof x === 'object' &&
  typeof (x as RecentDevice).id === 'string' &&
  typeof (x as RecentDevice).name === 'string' &&
  typeof (x as RecentDevice).type === 'string' &&
  !!(x as RecentDevice).id &&
  !!(x as RecentDevice).name

function load(site: string | undefined): RecentDevice[] {
  try {
    const raw = globalThis.localStorage?.getItem(keyOf(site))
    const list: unknown = raw ? JSON.parse(raw) : []
    return Array.isArray(list) ? list.filter(valid).slice(0, RECENT_MAX) : []
  } catch {
    return []
  }
}

/** 这个站点的最近设备(响应式;同一站点拿到的是同一个 ref) */
export function recentDevices(site: string | undefined): Ref<RecentDevice[]> {
  const k = keyOf(site)
  let store = stores.get(k)
  if (!store) {
    store = ref(load(site))
    stores.set(k, store)
  }
  return store
}

/** 记一台设备:挪到最前、去重(同类型同名算一台);没有 id 的不记(列不出测点,记了也没用) */
export function rememberDevice(site: string | undefined, e: Partial<RecentDevice> | null | undefined): void {
  if (!e || !valid(e)) return
  const store = recentDevices(site)
  const next = [
    { type: e.type, id: e.id, name: e.name },
    ...store.value.filter(d => !(d.type === e.type && d.name === e.name)),
  ].slice(0, RECENT_MAX)
  if (JSON.stringify(next) === JSON.stringify(store.value)) return
  store.value = next
  try {
    globalThis.localStorage?.setItem(keyOf(site), JSON.stringify(next))
  } catch {
    /* 存不了就只在内存里记 */
  }
}

/** 测试用:清掉内存里的缓存(localStorage 由测试自己清) */
export function resetRecentDevices(): void {
  stores.clear()
}
