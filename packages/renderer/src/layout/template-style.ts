/**
 * 模板引擎:把 TemplateDefinition 翻译成根节点 / 槽位的内联样式。
 * - scaled:固定设计尺寸 + 整体 transform: scale(),以**父容器**尺寸为缩放基准(计划 §9 风险 7:宿主有侧栏 / 顶栏时不能按 window 算)。
 * - grid:CSS grid-template-areas,槽位按 grid-area 名落位,响应式。
 */
import type { CSSProperties } from 'vue'
import type { TemplateDefinition, TemplateSlotDefinition } from '../schema/registry'

export function computeScale(design: { w: number; h: number }, container: { w: number; h: number }): number {
  if (!container.w || !container.h) return 1
  return Math.min(container.w / design.w, container.h / design.h)
}

export function rootStyle(tpl: TemplateDefinition, scale: number): CSSProperties {
  if (tpl.kind === 'scaled') {
    const d = tpl.design!
    return {
      position: 'relative',
      width: `${d.w}px`,
      height: `${d.h}px`,
      transform: `scale(${scale})`,
      transformOrigin: 'top left',
    }
  }
  return {
    display: 'grid',
    gridTemplateAreas: tpl.areas!.map(r => `"${r}"`).join(' '),
    gridAutoRows: 'minmax(120px, auto)',
    gap: 'var(--sr-gap, 12px)',
    width: '100%',
  }
}

export function slotStyle(tpl: TemplateDefinition, slot: TemplateSlotDefinition): CSSProperties {
  if (tpl.kind === 'scaled') {
    const a = slot.area
    if (typeof a === 'string') return {}
    return { position: 'absolute', left: `${a.x}px`, top: `${a.y}px`, width: `${a.w}px`, height: `${a.h}px` }
  }
  return { gridArea: typeof slot.area === 'string' ? slot.area : slot.name, minHeight: 0 }
}

/** scaled 模板的外层包裹尺寸(缩放后的实际占位),让宿主布局正确 */
export function wrapperStyle(tpl: TemplateDefinition, scale: number): CSSProperties {
  if (tpl.kind !== 'scaled') return { width: '100%', height: '100%' }
  const d = tpl.design!
  return { width: `${d.w * scale}px`, height: `${d.h * scale}px`, overflow: 'hidden', position: 'relative' }
}
