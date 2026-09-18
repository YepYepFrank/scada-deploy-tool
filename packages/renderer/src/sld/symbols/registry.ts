/**
 * 图元注册表(ADR-005 D8):图元定义一份,运行时 `sld` 组件、部署工具的 X6 节点与图元面板共用。
 * 与组件注册表(src/registry.ts)同一个路数:注册时校验、重复注册覆盖、测试用 reset。
 */
import type { SldSwitchState, SldSymbolDefinition, SldSymbolLookup } from '../model/types'

const symbols = new Map<string, SldSymbolDefinition>()

const SWITCH_STATES: SldSwitchState[] = ['open', 'closed', 'unknown']

/** 注册一个图元;定义不合规直接抛错(开发期就该发现)。同 id 重复注册以后者为准。 */
export function registerSldSymbol(def: SldSymbolDefinition): void {
  if (!/^[a-z][a-z0-9-]*$/.test(def.id)) throw new Error(`图元 id "${def.id}" 不符合 ^[a-z][a-z0-9-]*$`)
  // 写成「不满足 > 0」的否定式,NaN 也一并挡住
  if (!(def.w > 0) || !(def.h > 0)) throw new Error(`图元 "${def.id}" 的包围盒 w / h 必须大于 0`)
  const ids = new Set<string>()
  for (const p of def.ports) {
    if (ids.has(p.id)) throw new Error(`图元 "${def.id}" 端口 "${p.id}" 重复`)
    ids.add(p.id)
    if (!(p.x >= 0 && p.x <= def.w && p.y >= 0 && p.y <= def.h))
      throw new Error(`图元 "${def.id}" 端口 "${p.id}" 坐标 (${p.x}, ${p.y}) 超出包围盒 ${def.w}×${def.h}`)
  }
  if (def.conduct === 'switch') {
    for (const s of SWITCH_STATES)
      if (typeof def.stateBody?.[s] !== 'string')
        throw new Error(`图元 "${def.id}" 是开关(conduct = 'switch'),stateBody 必须三态齐全,缺 "${s}"`)
  }
  // 文字写进 body 会跟着旋转躺倒、镜像反字:一律写 texts(<SldSymbol> 单独正向画)
  const fragments = [def.body, ...Object.values(def.stateBody ?? {})]
  if (fragments.some(f => /<text[\s>]/.test(f)))
    throw new Error(`图元 "${def.id}" 的 SVG 片段里不能有 <text>,文字请写 texts`)
  symbols.set(def.id, def)
}

export const getSldSymbol = (id: string): SldSymbolDefinition | undefined => symbols.get(id)
export const listSldSymbols = (): SldSymbolDefinition[] => [...symbols.values()]

/** 给 model 层函数(wirePoints、validateSldDoc…)当查表函数用 */
export const lookupSldSymbol: SldSymbolLookup = id => symbols.get(id)

/** 测试用:清空图元注册表 */
export function resetSldSymbols(): void {
  symbols.clear()
}
