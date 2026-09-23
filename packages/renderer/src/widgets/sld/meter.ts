/**
 * 数码框(2026-09-23 内测反馈「遥测数据最好是小数点在一个纵轴上」,样子参照现有组态里的数字仪表):
 * 前缀在框左、单位在框右,框里是黑底七段数码管数字,**右对齐**、每位等宽,小数点点在前一位右下角不占位——
 * 同一列的框右边界对齐(同一 colW,或同样长短的前缀),位数相同的数值小数点就落在一条竖线上。
 *
 * 数字自己画成 SVG path,不依赖字体(宿主没引字体包也是这个样子);没亮的段淡淡地垫一层「8」,像真表头。
 * 全是纯函数,编辑器画布也用它定框的位置。
 */

/**
 * 缺省位数(不含小数点):「388.7」「125.6」「10.50」都是 4 位;值更长(「1234.5」)时框向左加宽,
 * 右边界不动——数字照样右对齐,小数点照样在一条线上
 */
export const METER_CELLS_DEFAULT = 4
export const METER_CELLS_MIN = 1
export const METER_CELLS_MAX = 12

/** 七段:a 上、b 右上、c 右下、d 下、e 左下、f 左上、g 中 */
const SEGMENTS: Record<string, string> = {
  '0': 'abcdef',
  '1': 'bc',
  '2': 'abdeg',
  '3': 'abcdg',
  '4': 'bcfg',
  '5': 'acdfg',
  '6': 'acdefg',
  '7': 'abc',
  '8': 'abcdefg',
  '9': 'abcdfg',
  '-': 'g',
  ' ': '',
}

export interface MeterCell {
  /** 这一位亮哪几段 */
  seg: string
  /** 右下角的小数点 */
  dp: boolean
}

/**
 * 显示文字 → 数码管的位。只认数字、负号、空格和小数点(「--」没值时也画得出来);
 * 有别的字符(枚举文字「制冷」、科学计数法)返回 null,调用方改成在框里写字。
 */
export function meterCells(text: string): MeterCell[] | null {
  const out: MeterCell[] = []
  for (const ch of text) {
    if (ch === '.') {
      const last = out[out.length - 1]
      if (last && !last.dp) last.dp = true
      else out.push({ seg: '', dp: true })
      continue
    }
    const seg = SEGMENTS[ch]
    if (seg === undefined) return null
    out.push({ seg, dp: false })
  }
  return out.length ? out : null
}

/** 各部分尺寸,全按字号成比例 */
export function meterMetrics(size: number) {
  return {
    /** 每一位占的宽度(与西文字符 0.6em 一样宽:换成数码框后整体宽度与纯文字差不多,原来的排布放得下) */
    cellW: size * 0.6,
    /** 数字本身的宽 / 高 */
    digitW: size * 0.43,
    digitH: size * 0.9,
    /** 段粗 */
    thick: size * 0.12,
    /** 框高(标签上下挨着放时框不叠)、框内左右留白 */
    boxH: size * 1.3,
    pad: size * 0.25,
    /** 前缀与框、框与单位之间的空 */
    gap: size * 0.35,
  }
}

/** 框宽(给编辑器对齐成列、定命中盒用) */
export function meterBoxWidth(size: number, cells: number = METER_CELLS_DEFAULT): number {
  const m = meterMetrics(size)
  return cells * m.cellW + 2 * m.pad
}

/** 估一个文字宽度(没有 DOM 量不了):CJK 按 1em,大写字母 0.7em(「SOC」比「Uab」宽),其它 0.6em */
export function estimateTextWidth(text: string, size: number): number {
  let em = 0
  for (const ch of text) em += ch.charCodeAt(0) > 0x2e7f ? 1 : ch >= 'A' && ch <= 'Z' ? 0.7 : 0.6
  return em * size
}

/** 位数:没配 / 越界按缺省 */
export function meterCellCount(cells: unknown): number {
  return typeof cells === 'number' && Number.isInteger(cells) && cells >= METER_CELLS_MIN && cells <= METER_CELLS_MAX
    ? cells
    : METER_CELLS_DEFAULT
}

export interface MeterLayoutInput {
  x: number
  y: number
  size: number
  title?: string
  /** 数值列右边界相对 x 的偏移(同 SldLabel.colW);给了框的右边界就落在这里 */
  colW?: number
  cells?: number
  /** 当前要显示的文字(决定框要不要向左加宽) */
  text: string
}

export interface MeterLayout {
  box: { x: number; y: number; w: number; h: number }
  /** 数字(或文字)的右边界 */
  right: number
  /** 单位的起点 x */
  unitX: number
  /** 数码管的位;null = 这段文字画不成数码管,在框里写字 */
  cells: MeterCell[] | null
  /** 框里一共几位(含没亮的) */
  slots: number
}

/**
 * 框摆在哪:配了 colW → 框右边界 = x + colW(与三列对齐同一个含义,「对齐成列」照样用);
 * 没配 → 按前缀的宽度让开(至少 1.4em,P / Q / Ia / Ua 叠在一起时框自然对齐);
 * 前缀长短不一的一组(Uab 与 P 叠在一起)用编辑器的「对齐成列」给同一个 colW。
 */
export function meterLayout(input: MeterLayoutInput): MeterLayout {
  const m = meterMetrics(input.size)
  const cells = meterCells(input.text)
  const want = meterCellCount(input.cells)
  let slots = want
  let w: number
  if (cells) {
    slots = Math.max(want, cells.length)
    w = slots * m.cellW + 2 * m.pad
  } else {
    w = Math.max(want * m.cellW, estimateTextWidth(input.text, input.size)) + 2 * m.pad
  }
  const right =
    input.x +
    (typeof input.colW === 'number' && Number.isFinite(input.colW) && input.colW > 0
      ? input.colW
      : meterNaturalColW(input))
  return {
    box: { x: right - w, y: input.y - m.boxH / 2, w, h: m.boxH },
    right: right - m.pad,
    unitX: right + m.gap,
    cells,
    slots,
  }
}

/** 没配 colW 时框右边界离 x 多远:前缀宽(至少 1.4em,P / Q / Ia / Ua 一样宽)+ 空 + 框宽 */
export function meterNaturalColW(input: Pick<MeterLayoutInput, 'size' | 'title' | 'cells'>): number {
  const m = meterMetrics(input.size)
  const titleW = input.title ? Math.max(estimateTextWidth(input.title, input.size), 1.4 * input.size) + m.gap : 0
  return titleW + meterBoxWidth(input.size, meterCellCount(input.cells))
}

export interface MeterColumnLabel {
  id: string
  x: number
  y: number
  size: number
  title?: string
  cells?: number
}

/**
 * 叠在一起的数码框自动对成一列:x 相同、上下相邻(行距不超过 2.5 倍字号)的一串标签算一组,
 * 取组里最大的 meterNaturalColW 当共同的列宽——「P / SOC / 状态」这种前缀长短不一的一组,
 * 不用点「对齐成列」框也对齐、小数点也在一条线上。只处理传进来的标签(调用方已滤掉配了 colW 的、纯文字的)。
 */
export function autoMeterColumns(labels: readonly MeterColumnLabel[]): Map<string, number> {
  const out = new Map<string, number>()
  const sorted = [...labels].sort((a, b) => a.x - b.x || a.y - b.y)
  let group: MeterColumnLabel[] = []
  const flush = () => {
    if (group.length > 1) {
      const w = Math.max(...group.map(meterNaturalColW))
      for (const l of group) out.set(l.id, w)
    }
    group = []
  }
  for (const l of sorted) {
    const prev = group[group.length - 1]
    if (prev && (Math.abs(prev.x - l.x) > 0.5 || l.y - prev.y > 2.5 * Math.max(prev.size, l.size))) flush()
    group.push(l)
  }
  flush()
  return out
}

const r2 = (n: number): string => String(Math.round(n * 100) / 100)

/**
 * 数码管 path:`lit` 是亮的段(含小数点),`ghost` 是每一位都画满的「8」(垫底用)。
 * 位右对齐到 `right`,垂直居中在 `y`;字形略向右斜(真表头的样子)。
 */
export function sevenSegPaths(
  cells: MeterCell[],
  slots: number,
  right: number,
  y: number,
  size: number
): { lit: string; ghost: string } {
  const m = meterMetrics(size)
  const h = m.thick / 2
  const g = m.thick * 0.2
  const top = y - m.digitH / 2
  const bottom = y + m.digitH / 2
  const slant = 0.08
  const pt = (px: number, py: number): string => `${r2(px + (bottom - py) * slant)} ${r2(py)}`
  const poly = (pts: Array<[number, number]>): string => 'M' + pts.map(([px, py]) => pt(px, py)).join('L') + 'Z'
  const hseg = (x0: number, x1: number, yc: number) =>
    poly([
      [x0, yc],
      [x0 + h, yc - h],
      [x1 - h, yc - h],
      [x1, yc],
      [x1 - h, yc + h],
      [x0 + h, yc + h],
    ])
  const vseg = (xc: number, y0: number, y1: number) =>
    poly([
      [xc, y0],
      [xc + h, y0 + h],
      [xc + h, y1 - h],
      [xc, y1],
      [xc - h, y1 - h],
      [xc - h, y0 + h],
    ])
  const glyph = (dx: number, seg: string, dp: boolean): string => {
    const w = m.digitW
    const H = m.digitH
    const mid = top + H / 2
    const parts: Record<string, () => string> = {
      a: () => hseg(dx + h + g, dx + w - h - g, top + h),
      g: () => hseg(dx + h + g, dx + w - h - g, mid),
      d: () => hseg(dx + h + g, dx + w - h - g, top + H - h),
      f: () => vseg(dx + h, top + h + g, mid - g),
      b: () => vseg(dx + w - h, top + h + g, mid - g),
      e: () => vseg(dx + h, mid + g, top + H - h - g),
      c: () => vseg(dx + w - h, mid + g, top + H - h - g),
    }
    let d = ''
    for (const s of seg) d += parts[s]?.() ?? ''
    if (dp) {
      const px = dx + w + (m.cellW - w) * 0.45
      d += poly([
        [px - h, bottom - m.thick],
        [px + h, bottom - m.thick],
        [px + h, bottom],
        [px - h, bottom],
      ])
    }
    return d
  }
  // 每一位的数字左边:位宽里数字偏左放,右边留出小数点的地方
  const digitX = (i: number): number => right - (slots - i) * m.cellW + (m.cellW - m.digitW) * 0.2
  const offset = slots - cells.length
  let lit = ''
  let ghost = ''
  for (let i = 0; i < slots; i++) {
    ghost += glyph(digitX(i), 'abcdefg', true)
    const c = cells[i - offset]
    if (c) lit += glyph(digitX(i), c.seg, c.dp)
  }
  return { lit, ghost }
}
