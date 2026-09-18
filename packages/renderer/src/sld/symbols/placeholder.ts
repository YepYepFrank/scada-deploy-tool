import type { SldSymbolDefinition } from '../model/types'
import { rect, text } from './svg'

/**
 * 未知图元的占位:带「?」的虚线框。不进注册表(getSldSymbol 查不到时由 <SldSymbol> 兜底使用),
 * 没有端口、不导通;旧版本渲染器遇到新图元 id 时至少能看出「这里有个东西」。
 */
export const unknownSldSymbol: SldSymbolDefinition = {
  id: 'unknown',
  name: '未知图元',
  category: 'connect',
  w: 40,
  h: 40,
  ports: [],
  conduct: 'none',
  body: rect(1, 1, 38, 38, { dashed: true }) + text(20, 20, '?', 16),
}
