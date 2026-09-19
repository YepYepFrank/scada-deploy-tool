/**
 * 底图描摹(T5.7)的纯逻辑:文件检查、写入 / 调整 / 移除 `doc.background`。
 * ADR-005 D10:底图只存项目文件、**不发布**——发布前剥离由 T5.8 负责,这里只管编辑期。
 */
import type { SldDoc } from '@grid/scada-renderer'

export const MAX_BG_BYTES = 3 * 1024 * 1024
export const DEFAULT_BG_OPACITY = 0.35
export const BG_ACCEPT = '.png,.jpg,.jpeg,.svg,image/png,image/jpeg,image/svg+xml'

const OK_TYPES = ['image/png', 'image/jpeg', 'image/svg+xml']
const OK_EXT = /\.(png|jpe?g|svg)$/i

/** 选中的文件能不能当底图:不行返回给人看的原因 */
export function checkBackgroundFile(file: { name: string; size: number; type: string }): string | undefined {
  if (!OK_TYPES.includes(file.type) && !OK_EXT.test(file.name)) return `「${file.name}」不是 png / jpg / svg 图片`
  if (file.size > MAX_BG_BYTES)
    return `「${file.name}」有 ${(file.size / 1024 / 1024).toFixed(1)} MB,超过 3 MB 上限(底图存在项目文件里,太大会拖慢保存与载入);请先压缩或裁剪`
  return undefined
}

type Bg = NonNullable<SldDoc['background']>

/**
 * 写入底图:铺到画布宽、等比算高(不知道原始尺寸时只给宽,浏览器按比例画),左上角对画布原点。
 * 换图时保留原来的透明度。
 */
export function setBackground(doc: SldDoc, src: string, natural?: { w: number; h: number }): void {
  const w = doc.canvas.w
  const bg: Bg = { src, opacity: doc.background?.opacity ?? DEFAULT_BG_OPACITY, x: 0, y: 0, w }
  if (natural && natural.w > 0 && natural.h > 0) bg.h = Math.round((w * natural.h) / natural.w)
  doc.background = bg
}

export function removeBackground(doc: SldDoc): boolean {
  if (!doc.background) return false
  delete doc.background
  return true
}

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v))

/** 调透明度 / 位置;非法数值忽略。返回有没有变化 */
export function patchBackground(doc: SldDoc, patch: { opacity?: number; x?: number; y?: number }): boolean {
  const bg = doc.background
  if (!bg) return false
  const before = JSON.stringify(bg)
  if (patch.opacity !== undefined && Number.isFinite(patch.opacity)) bg.opacity = clamp(patch.opacity, 0.05, 1)
  if (patch.x !== undefined && Number.isFinite(patch.x)) bg.x = Math.round(patch.x)
  if (patch.y !== undefined && Number.isFinite(patch.y)) bg.y = Math.round(patch.y)
  return JSON.stringify(bg) !== before
}

/** 当前缩放 = 底图宽 / 画布宽(百分比,取整) */
export function backgroundScale(doc: SldDoc): number {
  const bg = doc.background
  if (!bg) return 100
  return Math.round(((bg.w ?? doc.canvas.w) / doc.canvas.w) * 100)
}

/** 按百分比缩放(相对画布宽),高度等比跟着变;范围 5%–1000% */
export function scaleBackground(doc: SldDoc, percent: number): boolean {
  const bg = doc.background
  if (!bg || !Number.isFinite(percent)) return false
  const oldW = bg.w ?? doc.canvas.w
  const w = Math.round((doc.canvas.w * clamp(percent, 5, 1000)) / 100)
  if (w === oldW) return false
  if (bg.h !== undefined) bg.h = Math.round((bg.h * w) / oldW)
  bg.w = w
  return true
}
