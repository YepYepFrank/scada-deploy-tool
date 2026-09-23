/**
 * 一次接线图 · 2026-09-23 内测反馈 ⑧「遥测数据最好是小数点在一个纵轴上」(渲染器侧):
 * 数值标签缺省画成数码框(黑底七段数码管、右对齐),位数相同的数值小数点落在一条竖线上;
 * 叠在一起的一组自动对成一列;valueStyle / look = 'plain' 退回纯文字。
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import {
  autoMeterColumns,
  meterBoxWidth,
  meterCells,
  meterLayout,
  meterNaturalColW,
  registerBuiltins,
  resetRegistry,
  sevenSegPaths,
  sldWidget,
  type SldDoc,
  type SldLabel,
} from '../src/index'
import SldWidget from '../src/widgets/sld/SldWidget.vue'
import SldLabelView from '../src/widgets/sld/SldLabelView.vue'
import { SLD_CONTEXT_KEY } from '../src/widgets/sld/context'
import { ref } from 'vue'

beforeEach(() => {
  resetRegistry()
  registerBuiltins()
})

const segCount = (d: string) => (d.match(/M/g) ?? []).length

describe('数码管', () => {
  it('显示文字 → 位:小数点点在前一位上不占位;「--」画得出来;枚举文字画不了', () => {
    expect(meterCells('388.7')).toEqual([
      { seg: 'abcdg', dp: false },
      { seg: 'abcdefg', dp: false },
      { seg: 'abcdefg', dp: true },
      { seg: 'abc', dp: false },
    ])
    expect(meterCells('--')?.map(c => c.seg)).toEqual(['g', 'g'])
    expect(meterCells('-12.5')).toHaveLength(4)
    expect(meterCells('制冷')).toBeNull()
    expect(meterCells('1e+21')).toBeNull()
  })

  it('亮的段数对得上:8. = 7 段 + 小数点;1 = 2 段;没亮的位垫满「8」', () => {
    const p = sevenSegPaths(meterCells('8.')!, 1, 100, 50, 12)
    expect(segCount(p.lit)).toBe(8)
    expect(segCount(sevenSegPaths(meterCells('1')!, 1, 100, 50, 12).lit)).toBe(2)
    expect(segCount(sevenSegPaths(meterCells('1')!, 4, 100, 50, 12).ghost)).toBe(4 * 8)
  })

  it('位数相同的数值,小数点落在同一处(388.7 与 0.4)', () => {
    // 4 位里只在第 3 位点小数点、其余不亮:得到的就是那一个小数点方块
    const dpOnly = sevenSegPaths(meterCells('   . ')!, 4, 200, 50, 12).lit
    expect(segCount(dpOnly)).toBe(1)
    expect(sevenSegPaths(meterCells('388.7')!, 4, 200, 50, 12).lit).toContain(dpOnly)
    expect(sevenSegPaths(meterCells('0.4')!, 4, 200, 50, 12).lit).toContain(dpOnly)
  })
})

describe('数码框的摆放', () => {
  it('配了 colW:框右边界 = x + colW;值更长时框向左加宽,右边界不动', () => {
    const short = meterLayout({ x: 10, y: 0, size: 12, title: 'P', colW: 80, text: '12.3' })
    const long = meterLayout({ x: 10, y: 0, size: 12, title: 'P', colW: 80, text: '123456.7' })
    expect(short.box.x + short.box.w).toBe(90)
    expect(long.box.x + long.box.w).toBe(90)
    expect(long.box.w).toBeGreaterThan(short.box.w)
    expect(short.slots).toBe(4)
    expect(long.slots).toBe(7)
    expect(short.unitX).toBeGreaterThan(90)
  })
  it('没配 colW:按前缀宽让开;短前缀(P / Ia)至少让 1.4em,叠在一起自然对齐', () => {
    const p = meterLayout({ x: 0, y: 0, size: 12, title: 'P', text: '1.0' })
    const ia = meterLayout({ x: 0, y: 0, size: 12, title: 'Ia', text: '1.0' })
    expect(p.box.x).toBe(ia.box.x)
    const soc = meterLayout({ x: 0, y: 0, size: 12, title: 'SOC', text: '1.0' })
    expect(soc.box.x).toBeGreaterThan(p.box.x)
    expect(meterNaturalColW({ size: 12, title: 'P' })).toBeCloseTo(p.box.x + meterBoxWidth(12))
  })
  it('叠在一起的一组(x 相同、上下相邻)自动取同一个列宽;隔得远的、不同 x 的、单个的不算', () => {
    const at = (id: string, x: number, y: number, title: string) => ({ id, x, y, size: 12, title })
    const cols = autoMeterColumns([
      at('p', 100, 560, 'P'),
      at('soc', 100, 576, 'SOC'),
      at('run', 100, 592, '状态'),
      at('far', 100, 900, 'Q'),
      at('other', 300, 560, 'P'),
    ])
    const w = Math.max(...['P', 'SOC', '状态'].map(title => meterNaturalColW({ size: 12, title })))
    expect(cols.get('p')).toBe(w)
    expect(cols.get('soc')).toBe(w)
    expect(cols.get('run')).toBe(w)
    expect(cols.has('far')).toBe(false)
    expect(cols.has('other')).toBe(false)
  })
})

describe('数值标签组件', () => {
  const withValue = (v: unknown) => ({
    global: {
      provide: {
        [SLD_CONTEXT_KEY as symbol]: {
          values: () => ({ 'pt.p1': { v, ts: Date.now() } }),
          errors: () => ({}),
          now: ref(Date.now()),
          staleMs: ref(undefined),
        },
      },
    },
  })
  const label = (over: Partial<Extract<SldLabel, { kind: 'value' }>> = {}): SldLabel => ({
    id: 'l1',
    kind: 'value',
    x: 50,
    y: 20,
    pt: 'p1',
    title: 'Uab',
    format: { unit: 'V', digits: 1 },
    ...over,
  })

  it('数码框:前缀 + 黑底框 + 数码管 + 单位;读数挂在 aria-label / data-value 上', () => {
    const w = mount(SldLabelView, { props: { label: label(), valueStyle: 'meter' }, ...withValue(388.66) })
    const g = w.find('.sr-sld-meter')
    expect(g.attributes('aria-label')).toBe('Uab 388.7 V')
    expect(g.attributes('data-value')).toBe('388.7')
    expect(w.find('.sr-sld-meter-box').exists()).toBe(true)
    expect(segCount(w.find('.sr-sld-meter-digits').attributes('d')!)).toBe(5 + 7 + 7 + 1 + 3)
    expect(w.find('.sr-sld-label-title').text()).toBe('Uab')
    expect(w.find('.sr-sld-label-unit').text()).toBe('V')
  })
  it('标签自己设了 look 以标签为准:plain 照旧纯文字', () => {
    const w = mount(SldLabelView, { props: { label: label({ look: 'plain' }), valueStyle: 'meter' }, ...withValue(1) })
    expect(w.find('.sr-sld-meter').exists()).toBe(false)
    expect(w.find('.sr-sld-label-num').text()).toBe('1.0')
  })
  it('枚举文字写在框里;没值亮「--」、标成 empty', () => {
    const e = mount(SldLabelView, {
      props: { label: label({ format: { map: { '0': '停止' } } }), valueStyle: 'meter' },
      ...withValue(0),
    })
    expect(e.find('.sr-sld-meter-text').text()).toBe('停止')
    const none = mount(SldLabelView, { props: { label: label(), valueStyle: 'meter' }, ...withValue(null) })
    expect(none.find('.sr-sld-meter').classes()).toContain('sr-sld-label-empty')
    expect(none.find('.sr-sld-meter').attributes('data-value')).toBe('--')
  })
})

describe('接线图组件的 valueStyle', () => {
  const DOC: SldDoc = {
    v: 1,
    canvas: { w: 400, h: 300, grid: 10 },
    nodes: [],
    buses: [],
    wires: [],
    labels: [
      { id: 'p', kind: 'value', x: 100, y: 100, pt: 'p', title: 'P', format: { unit: 'kW' } },
      { id: 'soc', kind: 'value', x: 100, y: 116, pt: 'soc', title: 'SOC', format: { unit: '%', digits: 0 } },
    ],
  }
  const values = { 'pt.p': { v: 125.6, ts: Date.now() }, 'pt.soc': { v: 85, ts: Date.now() } }
  const right = (w: ReturnType<typeof mount>, id: string) => {
    const r = w.find(`[data-id="${id}"] .sr-sld-meter-box`)
    return Number(r.attributes('x')) + Number(r.attributes('width'))
  }

  it('缺省数码框;前缀长短不一的两行自动对成一列(框右边界相同)', () => {
    const w = mount(SldWidget, { props: { doc: DOC, values } })
    expect(w.findAll('.sr-sld-meter')).toHaveLength(2)
    expect(right(w, 'p')).toBeCloseTo(right(w, 'soc'))
  })
  it('valueStyle = plain:全部退回纯文字', () => {
    const w = mount(SldWidget, { props: { doc: DOC, values, valueStyle: 'plain' } })
    expect(w.find('.sr-sld-meter').exists()).toBe(false)
    expect(w.find('[data-id="p"]').text()).toBe('P 125.6 kW')
  })
  it('属性面板里有「数值样式」,缺省数码框', () => {
    const schema = sldWidget.propsSchema as { properties: Record<string, { enum?: string[]; default?: unknown }> }
    expect(schema.properties.valueStyle).toMatchObject({ enum: ['meter', 'plain'], default: 'meter' })
    expect((sldWidget.defaults as Record<string, unknown>).valueStyle).toBe('meter')
  })
})
