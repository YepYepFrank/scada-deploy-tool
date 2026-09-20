/**
 * 页面装饰层(0.5.0):背景 / 舞台角标的开关与边界。
 * 它只是观感,但有两条不能破:装饰绝不吃指针事件(否则编辑器点不中槽位),`:decor="false"` 要回到 0.4.0 的素面。
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { ScadaPage, registerBuiltins, resetRegistry } from '../src/index'
import type { PageConfig } from '../src/schema/page-config'

const page = (template: string): PageConfig => ({
  schemaVersion: 1,
  template,
  widgets: [{ id: 'w1', slot: template === 'grid-3x3' ? 'r1c1' : 's1', type: 'text', props: {}, bindings: {} }],
})

beforeEach(() => {
  resetRegistry()
  registerBuiltins()
})

describe('页面装饰层', () => {
  it('默认开:根节点带 sr-decor,渲染背景层', () => {
    const w = mount(ScadaPage, { props: { config: page('overview-a'), design: true } })
    expect(w.classes()).toContain('sr-decor')
    expect(w.find('.sr-bg').exists()).toBe(true)
  })

  it('decor=false:没有背景层、没有角标、根节点不带 sr-decor', () => {
    const w = mount(ScadaPage, { props: { config: page('overview-a'), design: true, decor: false } })
    expect(w.classes()).not.toContain('sr-decor')
    expect(w.find('.sr-bg').exists()).toBe(false)
    expect(w.find('.sr-corners').exists()).toBe(false)
  })

  it('舞台角标只给固定设计稿的模板画,grid 模板不画', () => {
    const scaled = mount(ScadaPage, { props: { config: page('overview-a'), design: true } })
    expect(scaled.find('.sr-corners').exists()).toBe(true)
    const grid = mount(ScadaPage, { props: { config: page('grid-3x3'), design: true } })
    expect(grid.find('.sr-corners').exists()).toBe(false)
    expect(grid.classes()).not.toContain('sr-page-scaled')
  })

  it('装饰层不参与无障碍树,也不该被当成内容', () => {
    const w = mount(ScadaPage, { props: { config: page('overview-a'), design: true } })
    expect(w.find('.sr-bg').attributes('aria-hidden')).toBe('true')
    expect(w.find('.sr-corners').attributes('aria-hidden')).toBe('true')
    expect(w.find('.sr-bg').text()).toBe('')
  })
})
