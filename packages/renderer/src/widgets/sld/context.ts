/**
 * 外壳(SldWidget)→ 数值标签(SldLabelView)的注入上下文。
 * 走 provide / inject 而不是一层层传 props:标签直接读 `values()[槽位]`,只依赖自己那一个键,
 * 单个测点变化只重画那一个标签;`now` 每 10 秒跳一次也不会让中间的 SldScene 重渲染。
 */
import type { InjectionKey, Ref } from 'vue'

export interface SldRuntimeContext {
  /** 当前的 values(响应式对象;用函数取是因为 props.values 整个会被换掉) */
  values: () => Record<string, unknown>
  errors: () => Record<string, string>
  /** 随时间走的当前时刻(毫秒);design 态 / disabled / staleSeconds = 0 时不走 */
  now: Ref<number>
  /** 过期阈值(毫秒);undefined = 不判 */
  staleMs: Ref<number | undefined>
}

export const SLD_CONTEXT_KEY: InjectionKey<SldRuntimeContext> = Symbol('sr-sld-context')
