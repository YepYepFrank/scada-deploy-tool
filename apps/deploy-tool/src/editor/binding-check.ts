/**
 * 绑定的编辑期检查(T3.4):必填未绑标红;valueType: number 选了非数值 key 标黄。
 * 纯函数,key 的最近值类型由调用方从元数据(MetaClient.tsKeys)查出后传入。
 */
import type { Binding, BindingMode, BindingSlotSpec } from '@grid/scada-renderer'
import type { EntityRef } from '@grid/tb-client'
import type { ValueKind } from '../meta/MetaNode'
import { emptyExtParams, extComplete } from './ext-params'

/** 某 mode 的最小合法形状(实体可选保留);新建绑定与换 mode 都用它 */
export function emptyBinding(mode: BindingMode, entity?: EntityRef): Binding {
  const e = entity ?? { type: 'DEVICE', id: '', name: '' }
  switch (mode) {
    case 'ts':
      return { mode, entity: e, key: '' }
    case 'attr':
      return { mode, entity: e, scope: 'SERVER_SCOPE', key: '' }
    case 'ts-history':
      return { mode, entity: e, keys: [], window: '24h' }
    case 'alarm':
      return { mode, entity: e }
    case 'const':
      return { mode, value: '' }
    case 'ext':
      // 默认按归档历史开表单(现场最常用的那种),站点收益在行内换查询类型即可
      return { mode, source: 'kz', window: '30d', interval: '1d', params: emptyExtParams('history', entity) }
  }
}

/** 槽位允许的第一个 mode(新建绑定的默认) */
export const defaultMode = (spec: BindingSlotSpec): BindingMode => spec.modes?.[0] ?? 'ts'

export interface BindingFlag {
  level: 'error' | 'warning'
  message: string
}

/** 绑定形状是否填完整(实体 / key / keys 非空) */
export function isComplete(b: Binding | null | undefined): boolean {
  if (!b) return false
  switch (b.mode) {
    case 'ts':
    case 'attr':
      return !!b.entity?.id && !!b.key
    case 'ts-history':
      return !!b.entity?.id && b.keys.length > 0 && b.keys.every(Boolean) && !!b.window
    case 'alarm':
      return !!b.entity?.id
    case 'const':
      return b.value !== undefined
    case 'ext':
      return extComplete(b)
  }
  return false
}

/**
 * 单个槽位的检查。keyKind:该绑定所选 key 的最近值类型(未知传 undefined)。
 * 返回 null 表示没问题。
 */
export function checkSlot(
  spec: BindingSlotSpec,
  bound: Binding | Binding[] | undefined,
  keyKindOf: (b: Binding) => ValueKind | undefined
): BindingFlag | null {
  const list = bound === undefined ? [] : Array.isArray(bound) ? bound : [bound]
  if (!list.length) return spec.required ? { level: 'error', message: '必填槽位未绑定' } : null
  for (const b of list) {
    if (!isComplete(b)) return { level: 'error', message: `${b.mode} 绑定未填完整` }
    if (spec.valueType === 'number' && (b.mode === 'ts' || b.mode === 'attr')) {
      const k = keyKindOf(b)
      if (k && k !== 'number')
        return {
          level: 'warning',
          message: `测点「${b.key}」最近值是 ${k === 'string' ? '文本' : k === 'boolean' ? '布尔' : '空'},槽位要数值`,
        }
    }
    if (spec.valueType === 'boolean' && (b.mode === 'ts' || b.mode === 'attr')) {
      const k = keyKindOf(b)
      if (k === 'string') return { level: 'warning', message: `测点「${b.key}」最近值是文本,槽位要布尔 / 0-1` }
    }
  }
  return null
}
