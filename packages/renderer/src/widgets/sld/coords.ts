/**
 * 屏幕坐标 → SVG 用户坐标。组件会被放进 `transform: scale()` 的大屏模板里,clientX / clientY 不能直接按比例换算,
 * 一律经 `svg.getScreenCTM().inverse()`。封成可替换的对象:happy-dom 没有 getScreenCTM,单测里把 `sldCoords.mapper` 换掉。
 */
import type { SldPoint } from '../../sld'

export type SldScreenMapper = (clientX: number, clientY: number) => SldPoint

export const sldCoords = {
  /**
   * 取「此刻」的换算函数(把当前的逆矩阵存下来)。拖动平移要全程用按下那一刻的矩阵——拖的过程中 viewBox 在变,
   * 每次重取会抖。拿不到矩阵(元素不在文档里、环境不支持)返回 null,调用方忽略这次交互。
   */
  mapper(svg: SVGSVGElement): SldScreenMapper | null {
    const ctm = typeof svg.getScreenCTM === 'function' ? svg.getScreenCTM() : null
    if (!ctm) return null
    let inv: DOMMatrix
    try {
      inv = ctm.inverse()
    } catch {
      return null // 缩放为 0(容器 display: none)时矩阵不可逆
    }
    const { a, b, c, d, e, f } = inv
    if (![a, b, c, d, e, f].every(Number.isFinite)) return null
    return (x, y) => ({ x: a * x + c * y + e, y: b * x + d * y + f })
  },
}
