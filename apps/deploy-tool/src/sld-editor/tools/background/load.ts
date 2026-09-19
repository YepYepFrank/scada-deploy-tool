/**
 * 底图的浏览器侧:弹文件选择框、读成 data URL、量原始尺寸,然后经 ctx.apply 写进文档。
 */
import type { SldEditorContext } from '../../ext'
import { BG_ACCEPT, checkBackgroundFile, setBackground } from './ops'
import { bgState } from './state'

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result))
    r.onerror = () => reject(r.error ?? new Error('读取文件失败'))
    r.readAsDataURL(file)
  })
}

/** 原始像素尺寸;svg 没写宽高、或图片解不开时给 undefined(只按画布宽铺) */
function naturalSize(src: string): Promise<{ w: number; h: number } | undefined> {
  return new Promise(resolve => {
    const img = new Image()
    const timer = setTimeout(() => done(undefined), 3000)
    function done(v: { w: number; h: number } | undefined): void {
      clearTimeout(timer)
      resolve(v)
    }
    img.onload = () => done(img.naturalWidth > 0 ? { w: img.naturalWidth, h: img.naturalHeight } : undefined)
    img.onerror = () => done(undefined)
    img.src = src
  })
}

/** 校验 → 读取 → 一次 apply 写入;出错写到浮层的 error 并打开浮层。返回是否写入 */
export async function loadBackgroundFile(ctx: SldEditorContext, file: File): Promise<boolean> {
  const state = bgState(ctx)
  const bad = checkBackgroundFile(file)
  if (bad) {
    state.error = bad
    state.panel = true
    return false
  }
  const src = await readAsDataUrl(file)
  const natural = await naturalSize(src)
  const ok = ctx.apply(d => setBackground(d.doc, src, natural), '设置底图')
  state.error = ok ? '' : '底图没有写入(只读模式?)'
  if (ok) state.visible = true
  state.panel = true
  return ok
}

export function pickBackgroundFile(ctx: SldEditorContext): void {
  const input = document.createElement('input')
  input.type = 'file'
  input.accept = BG_ACCEPT
  input.onchange = () => {
    const file = input.files?.[0]
    if (file) void loadBackgroundFile(ctx, file)
  }
  input.click()
}
