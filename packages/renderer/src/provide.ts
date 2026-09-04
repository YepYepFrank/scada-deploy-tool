/**
 * DataSource 注入约定。用 Symbol.for 的全局注册符号,tb-client 的 Vue 适配层(provideTbClient)不必 import 本包即可提供同一 key。
 * 契约 §4.4:<ScadaPage :dataSource> 显式传入优先于注入。
 */
import { inject, provide, type InjectionKey } from 'vue'
import type { DataSource } from '@grid/tb-client'

export const DATA_SOURCE_KEY: InjectionKey<DataSource> = Symbol.for('grid:data-source') as InjectionKey<DataSource>

export function provideDataSource(ds: DataSource): void {
  provide(DATA_SOURCE_KEY, ds)
}

export function useDataSource(): DataSource {
  const ds = inject(DATA_SOURCE_KEY, null)
  if (!ds)
    throw new Error('DataSource 未提供:请在宿主 provideDataSource() / provideTbClient(),或给 <ScadaPage :dataSource>')
  return ds
}
