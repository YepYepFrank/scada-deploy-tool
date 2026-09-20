/**
 * 大屏抬头(0.6.0):`config.header` 决定画不画、画什么;缩放要把它算进去(不然加了抬头页面就挤出容器)。
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { ScadaPage, registerBuiltins, resetRegistry } from '../src/index'
import { computeScale, HEADER_DESIGN_H } from '../src/layout/template-style'
import type { PageConfig, PageHeader } from '../src/schema/page-config'

const page = (header?: PageHeader, template = 'overview-a'): PageConfig => ({
  schemaVersion: 1,
  template,
  ...(header ? { header } : {}),
  widgets: [{ id: 'w1', slot: template === 'grid-3x3' ? 'r1c1' : 's1', type: 'text', props: {}, bindings: {} }],
})

const mountPage = (config: PageConfig, props: Record<string, unknown> = {}) =>
  mount(ScadaPage, { props: { config, design: true, ...props } })

beforeEach(() => {
  resetRegistry()
  registerBuiltins()
})

describe('大屏抬头', () => {
  it('没配 header:不画,根节点不带 sr-has-header(与 0.5.0 一致)', () => {
    const w = mountPage(page())
    expect(w.find('.sr-header').exists()).toBe(false)
    expect(w.classes()).not.toContain('sr-has-header')
  })

  it('配了主标题:画抬头,标题 / 副标题 / 单位 / logo 都上屏', () => {
    const w = mountPage(
      page({ title: '仙人山服务区智能微电网监控系统', subtitle: 'XRS MICROGRID', org: '国网电瑞', logo: 'x.png' })
    )
    expect(w.classes()).toContain('sr-has-header')
    expect(w.find('.sr-header-title').text()).toBe('仙人山服务区智能微电网监控系统')
    expect(w.find('.sr-header-sub').text()).toBe('XRS MICROGRID')
    expect(w.find('.sr-header-org').text()).toBe('国网电瑞')
    expect(w.find('.sr-header-logo').attributes('src')).toBe('x.png')
  })

  it('主标题为空 / 只有空白:不画(副标题单独存在也不画)', () => {
    expect(
      mountPage(page({ subtitle: '只有副标' }))
        .find('.sr-header')
        .exists()
    ).toBe(false)
    expect(
      mountPage(page({ title: '   ' }))
        .find('.sr-header')
        .exists()
    ).toBe(false)
  })

  it('show: false 留着配置但不画;宿主传 :header="false" 也不画', () => {
    expect(
      mountPage(page({ title: '某站', show: false }))
        .find('.sr-header')
        .exists()
    ).toBe(false)
    expect(
      mountPage(page({ title: '某站' }), { header: false })
        .find('.sr-header')
        .exists()
    ).toBe(false)
  })

  it('align 决定对齐:缺省居中', () => {
    expect(
      mountPage(page({ title: '某站' }))
        .find('.sr-header')
        .classes()
    ).toContain('sr-header-center')
    expect(
      mountPage(page({ title: '某站', align: 'left' }))
        .find('.sr-header')
        .classes()
    ).toContain('sr-header-left')
  })

  it('grid 模板也能有抬头(scale 恒为 1)', () => {
    const w = mountPage(page({ title: '后台页' }, 'grid-3x3'))
    expect(w.find('.sr-header').exists()).toBe(true)
    expect(w.classes()).not.toContain('sr-page-scaled')
  })

  it('computeScale:抬头高度参与竖向比例,不传就是老行为', () => {
    const design = { w: 1920, h: 1080 }
    const box = { w: 1920, h: 1080 }
    expect(computeScale(design, box)).toBe(1)
    expect(computeScale(design, box, HEADER_DESIGN_H)).toBeCloseTo(1080 / (1080 + HEADER_DESIGN_H), 6)
    // 宽度更紧时仍按宽度走
    expect(computeScale(design, { w: 960, h: 10000 }, HEADER_DESIGN_H)).toBe(0.5)
  })
})
