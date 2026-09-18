/** T5.0 共享图元组件:<SldSymbol>(<g>)三态切换 / 旋转镜像 / 未知图元占位;<SldSymbolBox>(外包 <svg>)。 */
import { describe, it, expect, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { SldSymbol, SldSymbolBox, registerBuiltinSldSymbols, resetSldSymbols, breakerSymbol } from '../src/sld'

beforeEach(() => {
  resetSldSymbols()
  registerBuiltinSldSymbols()
})

describe('<SldSymbol>', () => {
  it('根元素是 <g>,含 body', () => {
    const w = mount(SldSymbol, { props: { symbol: 'breaker', state: 'closed' } })
    expect(w.element.tagName.toLowerCase()).toBe('g')
    expect(w.attributes('data-symbol')).toBe('breaker')
    expect(w.find('.sr-sld-symbol-body').element.innerHTML).toBe(breakerSymbol.body)
    expect(w.html()).not.toContain('<svg')
  })

  it('三态切换渲染出不同片段', async () => {
    const w = mount(SldSymbol, { props: { symbol: 'breaker', state: 'closed' } })
    const stateHtml = () => w.find('.sr-sld-symbol-state').element.innerHTML
    expect(w.attributes('data-state')).toBe('closed')
    expect(stateHtml()).toBe(breakerSymbol.stateBody!.closed)

    await w.setProps({ state: 'open' })
    expect(w.attributes('data-state')).toBe('open')
    expect(stateHtml()).toBe(breakerSymbol.stateBody!.open)

    await w.setProps({ state: 'unknown' })
    expect(stateHtml()).toBe(breakerSymbol.stateBody!.unknown)
    expect(stateHtml()).toContain('stroke-dasharray')

    const seen = new Set([breakerSymbol.stateBody!.closed, breakerSymbol.stateBody!.open, stateHtml()])
    expect(seen.size).toBe(3)
  })

  it('不给 state 按分位画;没有 stateBody 的图元不出状态层', () => {
    const br = mount(SldSymbol, { props: { symbol: 'breaker' } })
    expect(br.find('.sr-sld-symbol-state').element.innerHTML).toBe(breakerSymbol.stateBody!.open)
    const meter = mount(SldSymbol, { props: { symbol: 'meter', state: 'closed' } })
    expect(meter.find('.sr-sld-symbol-state').exists()).toBe(false)
    expect(meter.attributes('data-state')).toBeUndefined()
    expect(meter.text()).toContain('Wh')
  })

  it('旋转 / 镜像:transform 与 geometry 同一套规则(旋转后包围盒左上角仍在原点)', async () => {
    const w = mount(SldSymbol, { props: { symbol: 'breaker' } })
    const tf = () => w.find('.sr-sld-symbol-shape').attributes('transform')
    expect(tf()).toBeUndefined()
    await w.setProps({ rot: 90 })
    expect(tf()).toBe('translate(60 0) rotate(90)')
    await w.setProps({ rot: 180, flip: true })
    expect(tf()).toBe('translate(40 60) rotate(180) translate(40 0) scale(-1 1)')
    await w.setProps({ rot: 270, flip: false })
    expect(tf()).toBe('translate(0 40) rotate(270)')
  })

  it('图元文字不进旋转的 <g>:位置跟着转,字形保持正向', async () => {
    const w = mount(SldSymbol, { props: { symbol: 'meter', rot: 90, flip: true } })
    const t = w.find('text.sr-sld-symbol-text')
    expect(t.text()).toBe('Wh')
    expect(t.attributes('transform')).toBeUndefined()
    expect(w.find('.sr-sld-symbol-shape text').exists()).toBe(false)
    expect([t.attributes('x'), t.attributes('y')]).toEqual(['20', '20'])
  })

  it('未知图元:带「?」的虚线框,不旋转', () => {
    const w = mount(SldSymbol, { props: { symbol: 'no-such-symbol', rot: 90, state: 'closed' } })
    expect(w.classes()).toContain('sr-sld-symbol-unknown')
    expect(w.text()).toBe('?')
    expect(w.html()).toContain('stroke-dasharray')
    expect(w.find('.sr-sld-symbol-state').exists()).toBe(false)
    expect(w.find('.sr-sld-symbol-shape').attributes('transform')).toBeUndefined()
  })

  it('不写颜色:渲染结果里只有 currentColor / none', () => {
    const w = mount(SldSymbol, { props: { symbol: 'breaker', state: 'closed' } })
    expect(w.html()).not.toMatch(/#[0-9a-f]{3,8}\b|rgb|style=/i)
  })
})

describe('<SldSymbolBox>', () => {
  it('外层 <svg>:viewBox = 旋转后的包围盒,宽高 100%,里面是 <SldSymbol>', async () => {
    const w = mount(SldSymbolBox, { props: { symbol: 'breaker', state: 'closed' } })
    expect(w.element.tagName.toLowerCase()).toBe('svg')
    expect(w.attributes('viewBox')).toBe('0 0 40 60')
    expect(w.attributes('width')).toBe('100%')
    expect(w.attributes('height')).toBe('100%')
    expect(w.find('g.sr-sld-symbol').attributes('data-state')).toBe('closed')

    await w.setProps({ rot: 90 })
    expect(w.attributes('viewBox')).toBe('0 0 60 40')
    expect(w.find('g.sr-sld-symbol-shape').attributes('transform')).toBe('translate(60 0) rotate(90)')
  })

  it('未知图元:40×40 占位', () => {
    const w = mount(SldSymbolBox, { props: { symbol: 'no-such-symbol', rot: 90 } })
    expect(w.attributes('viewBox')).toBe('0 0 40 40')
    expect(w.text()).toBe('?')
  })
})
