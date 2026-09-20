/**
 * 大屏抬头(2026-09-20)的草稿改写:纯函数,配 `ed.update(d => setHeaderText(d, ...))` 用。
 *
 * 约定:
 * - 空串 = 清掉该字段;`header` 里一个字段都不剩就把 `header` 整个删掉——不给页面 JSON 留空壳。
 * - `show` 只在为 false 时写入(缺省就是要画),同理不留 `show: true` 这种废字段。
 * - logo 存 data URI(现场没有图床,填 URL 不现实),所以有大小上限,超了直接拒绝并说清楚。
 */
import type { PageConfig, PageHeader } from '@grid/scada-renderer'

/** logo 上限:进的是页面 JSON,发布时整页要写进 TB 资产,别让一张图把页面撑爆 */
export const MAX_LOGO_BYTES = 200 * 1024

type TextKey = 'title' | 'subtitle' | 'org' | 'logo'

/** 删掉空字段;整个 header 空了就连 header 一起删 */
function prune(doc: PageConfig): void {
  const h = doc.header
  if (!h) return
  for (const k of ['title', 'subtitle', 'org', 'logo'] as TextKey[]) if (!h[k]) delete h[k]
  if (h.align === 'center') delete h.align
  if (h.show !== false) delete h.show
  if (!Object.keys(h).length) delete doc.header
}

const draft = (doc: PageConfig): PageHeader => (doc.header ??= {})

/** 抬头的文字字段(标题 / 副标题 / 单位 / logo) */
export function setHeaderText(doc: PageConfig, key: TextKey, value: string): void {
  draft(doc)[key] = value.trim()
  prune(doc)
}

/** 主标题对齐 */
export function setHeaderAlign(doc: PageConfig, align: 'center' | 'left'): void {
  draft(doc).align = align
  prune(doc)
}

/** 「显示抬头」开关:关掉只是不画,填的字留着 */
export function setHeaderShow(doc: PageConfig, on: boolean): void {
  draft(doc).show = on
  prune(doc)
}

/** 抬头此刻画不画(和渲染器里的判断一致:要有主标题、show 不为 false) */
export function headerVisible(doc: PageConfig): boolean {
  const h = doc.header
  return !!h && h.show !== false && !!h.title?.trim()
}

/** 选图 → data URI。超限 / 不是图片时抛错,调用方把 message 显示出来即可。 */
export function readLogoDataUrl(file: File): Promise<string> {
  if (!/^image\//.test(file.type)) throw new Error('请选图片文件(png / jpg / svg / webp)')
  if (file.size > MAX_LOGO_BYTES)
    throw new Error(`图片 ${Math.round(file.size / 1024)} KB,超过 ${MAX_LOGO_BYTES / 1024} KB;请先压缩或换小图`)
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onerror = () => reject(new Error('读取图片失败'))
    r.onload = () => {
      const v = String(r.result ?? '')
      if (v.startsWith('data:image/')) resolve(v)
      else reject(new Error('读取图片失败'))
    }
    r.readAsDataURL(file)
  })
}
