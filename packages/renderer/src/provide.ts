/**
 * DataSource 注入约定。用 Symbol.for 的全局注册符号,tb-client 的 Vue 适配层(provideTbClient)不必 import 本包即可提供同一 key。
 * 契约 §4.4:<ScadaPage :dataSource> 显式传入优先于注入。
 */
import { inject, provide, type InjectionKey } from 'vue'
import type { DataSource } from '@grid/tb-client'
import type { BindingContext } from './binding-context'

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

/**
 * 绑定上下文注入(0.9.0)。在宿主某个页面组件里 provide 一次,它下面所有 <ScadaPage> / <ScadaWidget> 共用;
 * 组件上显式传了 `:binding-context` 的以 props 为准。传 reactive 对象(或每次换新对象)都行,渲染器只读不写。
 * provide / inject 本来就限定在组件树内——不是全局单例,两个页面、页面与弹窗之间不会串。
 */
export const BINDING_CONTEXT_KEY: InjectionKey<BindingContext> = Symbol.for(
  'grid:binding-context'
) as InjectionKey<BindingContext>

export function provideBindingContext(ctx: BindingContext): void {
  provide(BINDING_CONTEXT_KEY, ctx)
}

/** 取注入的上下文;没人提供返回 null(不抛错:大多数页面根本不用上下文) */
export function useBindingContext(): BindingContext | null {
  return inject(BINDING_CONTEXT_KEY, null)
}
