/**
 * 内置图元:一图元一文件,在这里汇总。新增图元 = 加一个文件 + 在下面 import / export / 数组三处各加一项。
 * (T5.0 只有 3 个桩图元;图元库在 T5.2 扩充。)
 */
import type { SldSymbolDefinition } from '../model/types'
import { registerSldSymbol } from './registry'
import { breakerSymbol } from './breaker'
import { meterSymbol } from './meter'
import { junctionSymbol } from './junction'

export * from './registry'
export { unknownSldSymbol } from './placeholder'
export { breakerSymbol, meterSymbol, junctionSymbol }

export const builtinSldSymbols: SldSymbolDefinition[] = [breakerSymbol, meterSymbol, junctionSymbol]

/** 把内置图元登记进图元注册表(可重复调用;宿主 / 测试在用 <SldSymbol> 之前调一次) */
export function registerBuiltinSldSymbols(): void {
  for (const s of builtinSldSymbols) registerSldSymbol(s)
}
