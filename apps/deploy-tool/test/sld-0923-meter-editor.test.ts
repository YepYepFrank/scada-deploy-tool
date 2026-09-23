/**
 * 一次接线图编辑器 · 2026-09-23 内测反馈 ⑧「遥测数据最好是小数点在一个纵轴上」(编辑器侧):
 * 画布上数值标签按数码框画(与大屏同一套几何);检视面板能改「数值样式」「位数」;「对齐成列」按框宽算。
 */
import { describe, expect, it } from 'vitest'
import { meterNaturalColW, registerBuiltins, type SldDoc, type SldLabel } from '@grid/scada-renderer'
import { docToCells, labelToCell, type SldLabelCell } from '../src/sld-editor/x6-adapter'
import { alignLabelColumns, setLabelStyle } from '../src/sld-editor/panels/inspector/ops'

registerBuiltins()

const val = (id: string, y: number, title: string, over: Partial<Extract<SldLabel, { kind: 'value' }>> = {}) =>
  ({ id, kind: 'value', x: 100, y, pt: id, title, format: { unit: 'kW' }, ...over }) as SldLabel
const doc = (labels: SldLabel[]): SldDoc => ({
  v: 1,
  canvas: { w: 800, h: 600, grid: 10 },
  nodes: [],
  buses: [],
  wires: [],
  labels,
})
/** 画布上框的右边界(文档坐标) */
const boxRight = (c: SldLabelCell) => c.x + Number(c.attrs.box!.x) + Number(c.attrs.box!.width)

describe('画布上的数码框', () => {
  it('缺省按数码框画:文字只剩前缀,框 / 数码管 / 单位另画;命中盒盖到单位', () => {
    const c = labelToCell(val('p', 100, 'P'))
    expect(c.attrs.text!.text).toBe('P')
    expect(c.attrs.box!.display).toBe('block')
    expect(String(c.attrs.digits!.d)).toMatch(/^M/)
    expect(c.attrs.unit).toMatchObject({ display: 'block', text: 'kW' })
    expect(c.width).toBeGreaterThan(Number(c.attrs.unit!.x))
  })
  it('look = plain:照旧一行文字,框那几层藏起来(每次都给,改回纯文字时清得掉)', () => {
    const c = labelToCell(val('p', 100, 'P', { look: 'plain' }))
    expect(c.attrs.text!.text).toBe('P -- kW')
    for (const sel of ['box', 'ghost', 'digits', 'unit']) expect(c.attrs[sel]).toEqual({ display: 'none' })
  })
  it('叠在一起、前缀长短不一的一组自动对成一列(与大屏同一个算法)', () => {
    const cells = docToCells(doc([val('p', 100, 'P'), val('soc', 116, 'SOC'), val('far', 400, 'Q')])) as SldLabelCell[]
    const [p, soc, far] = cells
    expect(boxRight(p!)).toBeCloseTo(boxRight(soc!))
    expect(boxRight(far!)).toBeLessThan(boxRight(p!))
  })
})

describe('检视面板:数值样式 / 位数', () => {
  it('一批一起改;空 = 随组件(字段删掉);位数 0 = 恢复缺省;越界拒绝;文字标签跳过', () => {
    const d = doc([val('a', 100, 'P'), val('b', 116, 'Q'), { id: 't', kind: 'text', x: 0, y: 0, text: 'x' }])
    expect(setLabelStyle(d, ['a', 'b', 't'], { look: 'plain' })).toBe(true)
    expect(d.labels.map(l => (l.kind === 'value' ? l.look : 'n/a'))).toEqual(['plain', 'plain', 'n/a'])
    expect(setLabelStyle(d, ['a', 'b'], { look: '' })).toBe(true)
    expect(d.labels.slice(0, 2).every(l => !('look' in l))).toBe(true)
    expect(setLabelStyle(d, ['a'], { cells: 6 })).toBe(true)
    expect(d.labels[0]).toMatchObject({ cells: 6 })
    expect(setLabelStyle(d, ['a'], { cells: 13 })).toBe(false)
    expect(setLabelStyle(d, ['a'], { cells: 0 })).toBe(true)
    expect('cells' in d.labels[0]!).toBe(false)
  })
  it('位数改大:框向左加宽,右边界不动', () => {
    const four = labelToCell(val('p', 100, 'P', { colW: 80 }))
    const six = labelToCell(val('p', 100, 'P', { colW: 80, cells: 6 }))
    expect(Number(six.attrs.box!.width)).toBeGreaterThan(Number(four.attrs.box!.width))
    expect(boxRight(six)).toBeCloseTo(boxRight(four))
  })
})

describe('对齐成列按框宽算', () => {
  it('数码框的 colW = 组里最大的「前缀 + 框」;对齐后框右边界相同', () => {
    const d = doc([val('a', 100, 'Uab'), { ...val('b', 300, 'P'), x: 100 }])
    expect(alignLabelColumns(d, ['a', 'b'])).toBe(true)
    const want = Math.round(meterNaturalColW({ size: 12, title: 'Uab' }))
    expect(d.labels.map(l => (l.kind === 'value' ? l.colW : 0))).toEqual([want, want])
    const [a, b] = d.labels.map(l => labelToCell(l))
    expect(boxRight(a!)).toBeCloseTo(boxRight(b!))
  })
})
