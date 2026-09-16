/**
 * 组件放大(2026-09-16):ScadaPage / ScadaWidget 每个组件右上角「放大」按钮 → Teleport 到 body 的放大层,
 * 共用同一份 values(不新建订阅),Esc / ✕ 关闭;design 态 / expandable=false 不显示按钮;组件被移除时自动收起。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'
import { nextTick } from 'vue'
import { ScadaPage, ScadaWidget, registerBuiltins, resetRegistry } from '../src/index'
import type { PageConfig } from '../src/schema/page-config'
import { createMockDataSource } from './mock-data-source'

const DEV = { type: 'DEVICE', id: 'd1', name: '设备一' } as const
const cfg = (): PageConfig => ({
  schemaVersion: 1,
  template: 'grid-3x3',
  widgets: [
    {
      id: 'w_a',
      slot: 'r1c1',
      type: 'text',
      props: { content: 'A={{value}}', title: '甲' },
      bindings: { value: { mode: 'ts', entity: DEV, key: 'P' } },
    },
    {
      id: 'w_b',
      slot: 'r1c2',
      type: 'number-card',
      props: { title: '乙' },
      bindings: { value: { mode: 'const', value: 3 } },
    },
  ],
})
const overlay = () => document.body.querySelector<HTMLElement>('.sr-expand')
let mounted: VueWrapper[] = []

beforeEach(() => {
  resetRegistry()
  registerBuiltins()
})
afterEach(() => {
  for (const w of mounted) w.unmount()
  mounted = []
  document.body.innerHTML = ''
})

describe('ScadaPage 放大', () => {
  it('每个组件有放大按钮;点开 → body 下出现放大层、同一组件 id、同一份值;不新建订阅;emit expand', async () => {
    const ds = createMockDataSource()
    const w = mount(ScadaPage, { props: { config: cfg(), dataSource: ds }, attachTo: document.body })
    mounted.push(w)
    await nextTick()
    const subs = ds.calls.length
    expect(w.findAll('.sr-widget [data-role="expand"]')).toHaveLength(2)
    expect(overlay()).toBeNull()
    await w.find('.sr-widget[data-widget="w_a"] [data-role="expand"]').trigger('click')
    await nextTick()
    const ov = overlay()!
    expect(ov).not.toBeNull()
    expect(ov.dataset.expand).toBe('w_a')
    expect(ov.classList.contains('sr-theme-default')).toBe(true)
    expect(ov.querySelector('.sr-widget')?.getAttribute('data-widget')).toBe('w_a')
    expect(ov.querySelector('.sr-expand-title')?.textContent).toBe('甲')
    expect(ds.calls.length).toBe(subs) // 共用 values,没有新订阅
    ds.pushTs(DEV, 'P', 'live')
    await nextTick()
    expect(ov.textContent).toContain('A=live') // 放大层随同一份值更新
    expect(w.emitted('expand')?.[0]).toEqual(['w_a'])
    // ✕ 关闭
    ;(ov.querySelector('[data-role="expand-close"]') as HTMLButtonElement).click()
    await nextTick()
    expect(overlay()).toBeNull()
    expect(w.emitted('expand')?.[1]).toEqual([null])
  })

  it('Esc 关闭;组件被移除时自动收起;design 态与 expandable=false 没有按钮', async () => {
    const ds = createMockDataSource()
    const w = mount(ScadaPage, { props: { config: cfg(), dataSource: ds }, attachTo: document.body })
    mounted.push(w)
    await nextTick()
    await w.find('.sr-widget[data-widget="w_b"] [data-role="expand"]').trigger('click')
    await nextTick()
    expect(overlay()?.dataset.expand).toBe('w_b')
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await nextTick()
    expect(overlay()).toBeNull()
    // 再放大,然后把组件从配置里拿掉 → 自动收起
    await w.find('.sr-widget[data-widget="w_b"] [data-role="expand"]').trigger('click')
    await nextTick()
    expect(overlay()).not.toBeNull()
    const c = cfg()
    c.widgets = c.widgets.filter(x => x.id !== 'w_b')
    await w.setProps({ config: c })
    await nextTick()
    await nextTick()
    expect(overlay()).toBeNull()

    const design = mount(ScadaPage, { props: { config: cfg(), design: true } })
    mounted.push(design)
    await nextTick()
    expect(design.findAll('[data-role="expand"]')).toHaveLength(0)
    const off = mount(ScadaPage, { props: { config: cfg(), dataSource: ds, expandable: false } })
    mounted.push(off)
    await nextTick()
    expect(off.findAll('[data-role="expand"]')).toHaveLength(0)
  })
})

describe('ScadaWidget 放大', () => {
  it('单卡也有放大按钮,放大层用同一份值;expandable=false 关掉', async () => {
    const ds = createMockDataSource()
    const w = mount(ScadaWidget, { props: { config: cfg().widgets[0]!, dataSource: ds }, attachTo: document.body })
    mounted.push(w)
    await nextTick()
    await w.find('[data-role="expand"]').trigger('click')
    await nextTick()
    expect(overlay()?.dataset.expand).toBe('w_a')
    ds.pushTs(DEV, 'P', 9)
    await nextTick()
    expect(overlay()?.textContent).toContain('A=9')
    expect(ds.calls).toHaveLength(1)
    expect(w.emitted('expand')?.[0]).toEqual(['w_a'])
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await nextTick()
    expect(overlay()).toBeNull()
    const off = mount(ScadaWidget, { props: { config: cfg().widgets[0]!, dataSource: ds, expandable: false } })
    mounted.push(off)
    await nextTick()
    expect(off.find('[data-role="expand"]').exists()).toBe(false)
  })
})
