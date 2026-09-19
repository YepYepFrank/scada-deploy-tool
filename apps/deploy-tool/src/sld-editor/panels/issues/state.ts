/**
 * 问题清单按编辑器实例缓存:页签角标每次渲染都要读,面板没打开时也要有数,所以不能算在面板组件里。
 * 内容一变就重算;某次重算超过 50 ms(图很大)后改成 150 ms 防抖,降回 50 ms 以内再恢复即时。
 */
import { effectScope, shallowRef, watch, type ShallowRef } from 'vue'
import type { SldEditorContext } from '../../ext'
import { checkContent, type IssueReport } from './check'

export const SLOW_MS = 50
export const DEBOUNCE_MS = 150

export interface IssuesHandle {
  report: Readonly<ShallowRef<IssueReport>>
  /** 最近一次重算耗时(毫秒) */
  lastCost: () => number
  /** 立刻重算(测试 / 面板打开时用) */
  flush: () => void
}

const cache = new WeakMap<SldEditorContext, IssuesHandle>()
const now = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now())

export function issuesOf(ctx: SldEditorContext): IssuesHandle {
  const hit = cache.get(ctx)
  if (hit) return hit
  const report = shallowRef<IssueReport>({ issues: [], errors: 0, warnings: 0, unusedSlots: [] })
  let cost = 0
  let timer: ReturnType<typeof setTimeout> | undefined
  const run = (): void => {
    clearTimeout(timer)
    timer = undefined
    const t0 = now()
    report.value = checkContent(ctx.content.value)
    cost = now() - t0
  }
  // 与任何组件的生命周期无关(角标在骨架里渲染,面板组件会反复挂载 / 卸载),所以放在独立的 effect scope 里
  effectScope(true).run(() =>
    watch(
      () => ctx.content.value,
      () => {
        if (cost <= SLOW_MS) run()
        else {
          clearTimeout(timer)
          timer = setTimeout(run, DEBOUNCE_MS)
        }
      },
      { flush: 'sync' }
    )
  )
  run()
  const handle: IssuesHandle = { report, lastCost: () => cost, flush: run }
  cache.set(ctx, handle)
  return handle
}
