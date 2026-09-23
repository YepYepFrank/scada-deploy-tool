/**
 * 快速绑定的面板级状态(2026-09-23):绑定面板 provide,测点列表(QuickPointPicker)与数值标签编辑器 inject。
 * - 当前设备:缺省 = 节点的设备,没有就用「最近用过的设备」第一台;在任何一个列表里换了设备,整块面板都跟着换;
 * - 哪个列表展开:缺省展开**第一个还没绑的**测点,绑完自动轮到下一个;点「换测点 / 收起」则按用户的来。
 */
import type { ComputedRef, InjectionKey, Ref } from 'vue'
import type { QuickDevice } from './ops'
import type { RecentDevice } from './recent'

export interface QuickBindState {
  /** 当前列测点的设备;null = 还没有(列表里先让选设备) */
  readonly device: ComputedRef<QuickDevice | null>
  readonly recent: Readonly<Ref<RecentDevice[]>>
  isOpen(slot: string): boolean
  toggle(slot: string): void
  /** 换设备(同时记进最近设备) */
  useDevice(d: QuickDevice): void
  /** 绑完一个:回到「自动展开下一个没绑的」 */
  picked(): void
}

export const QUICK_BIND: InjectionKey<QuickBindState> = Symbol('grid:sld-quick-bind')

/** 展开哪个:explicit === undefined → 第一个没绑的;null → 全收起;字符串 → 那一个 */
export function openSlotOf(explicit: string | null | undefined, unboundInOrder: readonly string[]): string | null {
  return explicit === undefined ? (unboundInOrder[0] ?? null) : explicit
}
