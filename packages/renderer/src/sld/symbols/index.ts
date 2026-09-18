/**
 * 内置图元(T5.2 图元库):一图元一文件,在这里汇总。
 * 新增图元 = 加一个文件 + 在下面 import / export / 分组三处各加一项。
 */
import type { SldSymbolDefinition } from '../model/types'
import { registerSldSymbol } from './registry'
import { breakerSymbol } from './breaker'
import { breakerCartSymbol } from './breaker-cart'
import { disconnectorSymbol } from './disconnector'
import { earthSwitchSymbol } from './earth-switch'
import { loadSwitchSymbol } from './load-switch'
import { switchSimpleSymbol } from './switch-simple'
import { fuseSymbol } from './fuse'
import { ctSymbol } from './ct'
import { cableHeadSymbol } from './cable-head'
import { reactorSymbol } from './reactor'
import { meterSymbol } from './meter'
import { junctionSymbol } from './junction'
import { transformer2wSymbol } from './transformer-2w'
import { ptSymbol } from './pt'
import { arresterSymbol } from './arrester'
import { capacitorSymbol } from './capacitor'
import { loadSymbol } from './load'
import { feederArrowSymbol } from './feeder-arrow'
import { chargerSymbol } from './charger'
import { liveIndicatorSymbol } from './live-indicator'
import { gridSourceSymbol } from './grid-source'
import { generatorSymbol } from './generator'
import { pvArraySymbol } from './pv-array'
import { incomingArrowSymbol } from './incoming-arrow'
import { inverterSymbol } from './inverter'
import { pcsSymbol } from './pcs'
import { batterySymbol } from './battery'
import { deviceBoxSymbol } from './device-box'
import { statusLightSymbol } from './status-light'

export * from './registry'
export { unknownSldSymbol } from './placeholder'
export {
  breakerSymbol,
  breakerCartSymbol,
  disconnectorSymbol,
  earthSwitchSymbol,
  loadSwitchSymbol,
  switchSimpleSymbol,
  fuseSymbol,
  ctSymbol,
  cableHeadSymbol,
  reactorSymbol,
  meterSymbol,
  junctionSymbol,
  transformer2wSymbol,
  ptSymbol,
  arresterSymbol,
  capacitorSymbol,
  loadSymbol,
  feederArrowSymbol,
  chargerSymbol,
  liveIndicatorSymbol,
  gridSourceSymbol,
  generatorSymbol,
  pvArraySymbol,
  incomingArrowSymbol,
  inverterSymbol,
  pcsSymbol,
  batterySymbol,
  deviceBoxSymbol,
  statusLightSymbol,
}

/** 图元面板 / 总览页的分组(按用途分,比 `category` 粗;顺序即面板里的顺序) */
export interface SldSymbolGroup {
  id: string
  title: string
  symbols: SldSymbolDefinition[]
}

export const builtinSldSymbolGroups: SldSymbolGroup[] = [
  {
    id: 'switch',
    title: '开关类',
    symbols: [
      breakerSymbol,
      breakerCartSymbol,
      disconnectorSymbol,
      earthSwitchSymbol,
      loadSwitchSymbol,
      switchSimpleSymbol,
    ],
  },
  {
    id: 'inline',
    title: '常通类',
    symbols: [fuseSymbol, ctSymbol, cableHeadSymbol, reactorSymbol, meterSymbol, junctionSymbol],
  },
  { id: 'transformer', title: '变压器', symbols: [transformer2wSymbol] },
  {
    id: 'terminal',
    title: '终端类',
    symbols: [
      ptSymbol,
      arresterSymbol,
      capacitorSymbol,
      loadSymbol,
      feederArrowSymbol,
      chargerSymbol,
      liveIndicatorSymbol,
    ],
  },
  { id: 'source', title: '电源类', symbols: [gridSourceSymbol, generatorSymbol, pvArraySymbol, incomingArrowSymbol] },
  { id: 'storage', title: '储能 / 变流', symbols: [inverterSymbol, pcsSymbol, batterySymbol] },
  { id: 'general', title: '通用', symbols: [deviceBoxSymbol, statusLightSymbol] },
]

/** 全部内置图元,按上面的分组顺序排开 */
export const builtinSldSymbols: SldSymbolDefinition[] = builtinSldSymbolGroups.flatMap(g => g.symbols)

/** 把内置图元登记进图元注册表(可重复调用;宿主 / 测试在用 <SldSymbol> 之前调一次) */
export function registerBuiltinSldSymbols(): void {
  for (const s of builtinSldSymbols) registerSldSymbol(s)
}
