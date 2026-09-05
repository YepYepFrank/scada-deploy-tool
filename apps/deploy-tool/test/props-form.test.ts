// T3.3 属性面板:10 个内置组件的 propsSchema 全部无兜底;数字越界标红;枚举 / 开关 / 数组子表单;JSON 兜底。
import { describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'

vi.mock('echarts/core', () => ({
  init: () => ({ setOption: vi.fn(), resize: vi.fn(), dispose: vi.fn() }),
  use: () => {},
  color: { modifyAlpha: (c: string) => c },
  graphic: { LinearGradient: class {} },
}))
vi.mock('echarts/charts', () => ({ LineChart: {}, BarChart: {}, GaugeChart: {} }))
vi.mock('echarts/components', () => ({ GridComponent: {}, TooltipComponent: {}, LegendComponent: {} }))
vi.mock('echarts/renderers', () => ({ CanvasRenderer: {} }))

import { getWidget, listWidgets, registerBuiltins, type PropsSchema } from '@grid/scada-renderer'
import PropsForm from '../src/editor/PropsForm.vue'
import { coerce, emptyRow, fallbackFields, fieldKind, validateProps } from '../src/editor/props-form'
import { useEditorState } from '../src/editor/useEditorState'

registerBuiltins()

describe('props-form 逻辑', () => {
  it('10 个内置组件的 propsSchema 全部能生成表单,无兜底字段', () => {
    const all = listWidgets()
    expect(all).toHaveLength(10)
    for (const w of all) expect(fallbackFields(w.propsSchema), w.type).toEqual([])
  })

  it('字段类型判定', () => {
    expect(fieldKind({ type: 'string' })).toBe('text')
    expect(fieldKind({ type: 'string', format: 'color' })).toBe('color')
    expect(fieldKind({ type: 'string', format: 'multiline' })).toBe('multiline')
    expect(fieldKind({ type: 'string', format: 'url' })).toBe('url')
    expect(fieldKind({ type: 'string', enum: ['a', 'b'] })).toBe('enum')
    expect(fieldKind({ type: 'integer' })).toBe('number')
    expect(fieldKind({ type: 'boolean' })).toBe('boolean')
    expect(fieldKind({ type: 'array', items: { type: 'object', properties: { x: { type: 'string' } } } })).toBe('array')
    expect(fieldKind({ type: 'array', items: { type: 'string' } } as never)).toBe('json')
    expect(fieldKind({ type: 'object' } as never)).toBe('json')
  })

  it('validateProps:越界 / 非整数 / 枚举 / 颜色 / 数组行数与嵌套 / 多余键', () => {
    const nc = getWidget('number-card')!.propsSchema
    expect(validateProps(nc, { decimals: 9 })).toEqual([{ path: 'decimals', message: '不能大于 4' }])
    expect(validateProps(nc, { decimals: -1 })[0]!.message).toBe('不能小于 0')
    expect(validateProps(nc, { decimals: 1.5 })[0]!.message).toBe('必须是整数')
    expect(validateProps(nc, { decimals: 'x' })[0]!.message).toBe('必须是数字')
    expect(validateProps(nc, { color: 'red' })[0]!.message).toMatch(/#rrggbb/)
    expect(validateProps(nc, { color: '#3987e5', decimals: 2, title: 't' })).toEqual([])
    expect(validateProps(nc, { bogus: 1 })[0]!.message).toMatch(/不是该组件的属性/)
    const line = getWidget('line')!.propsSchema
    expect(validateProps(line, { style: 'pie' })[0]!.message).toBe('只能是 line / area / bar')
    const tbl = getWidget('table')!.propsSchema
    expect(validateProps(tbl, { columns: [{ label: 'a', decimals: 7 }] })).toEqual([
      { path: 'columns/0/decimals', message: '不能大于 4' },
    ])
    expect(validateProps(tbl, { columns: new Array(13).fill({}) })[0]!.message).toBe('最多 12 项')
    expect(validateProps(tbl, { columns: 'x' })[0]!.message).toBe('必须是列表')
  })

  it('coerce 与 emptyRow', () => {
    expect(coerce({ type: 'integer' }, '3')).toBe(3)
    expect(coerce({ type: 'integer' }, '')).toBeUndefined()
    expect(coerce({ type: 'integer' }, 'abc')).toBe('abc')
    expect(coerce({ type: 'boolean' }, true)).toBe(true)
    expect(coerce({ type: 'object' } as never, '{"a":1}')).toEqual({ a: 1 })
    expect(coerce({ type: 'object' } as never, '{bad')).toBe(Symbol.for('invalid-json'))
    expect(
      emptyRow({ type: 'object', properties: { a: { type: 'string', default: 'x' }, b: { type: 'number' } } })
    ).toEqual({ a: 'x' })
  })
})

describe('PropsForm 组件', () => {
  it('number-card:文本 / 数字 / 取色;输入 9 位小数标红并给出提示,输入 2 正常 emit', async () => {
    const schema = getWidget('number-card')!.propsSchema
    const w = mount(PropsForm, { props: { schema, modelValue: { title: 'x', decimals: 1 } } })
    expect(w.findAll('.pf-field')).toHaveLength(Object.keys(schema.properties).length)
    expect(w.find('[data-field="color"] input[type="color"]').exists()).toBe(true)
    const dec = w.find('[data-field="decimals"] input')
    expect(dec.attributes('max')).toBe('4')
    await dec.setValue('9')
    expect(w.emitted('update:modelValue')!.at(-1)![0]).toEqual({ title: 'x', decimals: 9 })
    await w.setProps({ modelValue: { title: 'x', decimals: 9 } })
    expect(w.find('[data-field="decimals"]').classes()).toContain('pf-invalid')
    expect(w.find('[data-field="decimals"] .pf-err').text()).toBe('不能大于 4')
    await dec.setValue('2')
    expect(w.emitted('update:modelValue')!.at(-1)![0]).toEqual({ title: 'x', decimals: 2 })
    await w.setProps({ modelValue: { title: 'x', decimals: 2 } })
    expect(w.find('[data-field="decimals"]').classes()).not.toContain('pf-invalid')
    await w.find('[data-field="title"] input').setValue('进线')
    expect(w.emitted('update:modelValue')!.at(-1)![0]).toEqual({ title: '进线', decimals: 2 })
  })

  it('line:枚举下拉显示中文名并 emit 原值;开关 emit 布尔', async () => {
    const schema = getWidget('line')!.propsSchema
    const w = mount(PropsForm, { props: { schema, modelValue: {} } })
    const sel = w.find('[data-field="style"] select')
    expect(sel.findAll('option').map(o => o.text())).toEqual(['折线', '面积', '柱状'])
    await sel.setValue('bar')
    expect(w.emitted('update:modelValue')!.at(-1)![0]).toEqual({ style: 'bar' })
    await w.find('[data-field="smooth"] input[type="checkbox"]').setValue(true)
    expect(w.emitted('update:modelValue')!.at(-1)![0]).toEqual({ smooth: true })
  })

  it('table.columns:可增删行、上限 12、子表单越界定位到 columns/i/decimals', async () => {
    const schema = getWidget('table')!.propsSchema
    const w = mount(PropsForm, { props: { schema, modelValue: { columns: [{ label: 'Ia', unit: 'A' }] } } })
    expect(w.findAll('[data-field="columns"] .pf-row')).toHaveLength(1)
    await w.find('[data-field="columns"] .pf-add').trigger('click')
    const cols = (w.emitted('update:modelValue')!.at(-1)![0] as { columns: unknown[] }).columns
    expect(cols).toEqual([{ label: 'Ia', unit: 'A' }, {}])
    await w.setProps({
      modelValue: {
        columns: [
          { label: 'Ia', unit: 'A' },
          { label: 'Ib', decimals: 8 },
        ],
      },
    })
    expect(w.find('[data-row="1"] [data-field="decimals"]').classes()).toContain('pf-invalid')
    await w.find('[data-row="1"] [data-field="label"] input').setValue('Ib 相')
    expect((w.emitted('update:modelValue')!.at(-1)![0] as { columns: { label: string }[] }).columns[1]!.label).toBe(
      'Ib 相'
    )
    await w.find('[data-row="0"] .pf-del').trigger('click')
    expect((w.emitted('update:modelValue')!.at(-1)![0] as { columns: unknown[] }).columns).toHaveLength(1)
    await w.setProps({ modelValue: { columns: new Array(12).fill({ label: 'x' }) } })
    expect((w.find('[data-field="columns"] .pf-add').element as HTMLButtonElement).disabled).toBe(true)
  })

  it('兜底:未识别类型给 JSON 文本框,坏 JSON 不保存并提示', async () => {
    const schema: PropsSchema = { type: 'object', properties: { extra: { type: 'object' } as never } }
    const w = mount(PropsForm, { props: { schema, modelValue: {} } })
    const ta = w.find('[data-field="extra"] textarea.pf-json')
    expect(ta.exists()).toBe(true)
    await ta.setValue('{"a":1}') // test-utils 对 textarea 触发 input + change
    expect(w.emitted('update:modelValue')!.at(-1)![0]).toEqual({ extra: { a: 1 } })
    await w.setProps({ modelValue: { extra: { a: 1 } } })
    await ta.setValue('{bad')
    await nextTick()
    expect(w.find('[data-field="extra"] .pf-err').text()).toMatch(/JSON/)
    expect(w.emitted('update:modelValue')).toHaveLength(1)
  })
})

describe('useEditorState.setWidgetProps 合并撤销步', () => {
  it('同一组件连续改属性只占一个撤销步;换操作后再改属性另起一步', () => {
    const ed = useEditorState({ schemaVersion: 1, template: 'overview-a', widgets: [] })
    const w = ed.placeWidget('s1', getWidget('number-card')!)
    ed.setWidgetProps(w.id, { title: '进' })
    ed.setWidgetProps(w.id, { title: '进线' })
    ed.setWidgetProps(w.id, { title: '进线有功' })
    expect(ed.state.pastCount).toBe(2) // place + 一次属性编辑
    expect(ed.widgetAt('s1')!.props).toEqual({ title: '进线有功' })
    ed.undo()
    expect(ed.widgetAt('s1')!.props).toEqual(getWidget('number-card')!.defaults) // 放入时填的默认值
    ed.redo()
    ed.setWidgetProps(w.id, { title: 'A' })
    ed.placeWidget('s2', getWidget('gauge')!)
    ed.setWidgetProps(w.id, { title: 'B' })
    expect(ed.state.pastCount).toBe(5)
  })
})
