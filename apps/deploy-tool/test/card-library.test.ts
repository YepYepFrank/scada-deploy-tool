/** 卡片库列表(2026-09-17):按格排序的行、类型 / 标题 / 绑定数,编辑 / 新建 / 删除事件,已发布显示 id 并可复制,未发布提示先发布。 */
import { describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import { registerBuiltins, type PageConfig } from '@grid/scada-renderer'
import CardLibrary from '../src/provisioner/CardLibrary.vue'
import { refJson, refSnippet, widgetTitle } from '../src/editor/widget-ref'

registerBuiltins()
const DEV = { type: 'DEVICE', id: 'd1', name: 'SSP1_GP1_IED1' } as const
const cfg = (): PageConfig => ({
  schemaVersion: 1,
  template: 'cards',
  title: '卡片库',
  widgets: [
    { id: 'w_b', slot: 'c02', type: 'line', props: {}, bindings: { series: [] } },
    {
      id: 'w_a',
      slot: 'c01',
      type: 'number-card',
      props: { title: '进线有功' },
      bindings: { value: { mode: 'ts', entity: DEV, key: 'P' } },
    },
  ],
})

describe('widget-ref', () => {
  it('引用 JSON 与接入代码;标题回退到类型名', () => {
    const w = cfg().widgets[1]!
    expect(refJson('pid', 'w_a')).toBe('{"pageId":"pid","widgetId":"w_a"}')
    expect(refSnippet('pid', w)).toContain(`pickWidget(page, 'w_a')`)
    expect(refSnippet('pid', w)).toContain('number-card · 进线有功')
    expect(widgetTitle(cfg().widgets[0]!, '曲线')).toBe('曲线')
  })
})

describe('CardLibrary', () => {
  it('未发布:按格排序、显示类型 / 标题 / 绑定数,组件 id 已固定,提示先发布;编辑 / 新建 / 删除事件', async () => {
    const w = mount(CardLibrary, { props: { config: cfg(), pageId: null, full: false } })
    const rows = w.findAll('.cl-row')
    expect(rows).toHaveLength(2)
    expect(rows[0]!.attributes('data-card')).toBe('w_a') // c01 在前
    expect(rows[0]!.text()).toContain('进线有功')
    expect(rows[0]!.text()).toContain('数字卡 · 格 c01 · 1 个绑定')
    expect(rows[1]!.text()).toContain('曲线 · 格 c02 · 1 个绑定')
    expect(w.find('[data-role="cl-summary"]').text().replace(/\s+/g, ' ')).toContain('2 张卡 · 未发布')
    expect(w.findAll('[data-role="cl-unpublished"]')).toHaveLength(2)
    expect(w.findAll('[data-role="cl-copy-json"]')).toHaveLength(0)
    await rows[0]!.find('[data-role="cl-edit"]').trigger('click')
    expect(w.emitted('edit')?.[0]).toEqual(['c01'])
    await rows[1]!.find('[data-role="cl-remove"]').trigger('click')
    expect(w.emitted('remove')?.[0]).toEqual(['w_b', 'c02'])
    await w.find('[data-role="cl-add"]').trigger('click')
    expect(w.emitted('add')).toHaveLength(1)
    await w.setProps({ full: true })
    expect((w.find('[data-role="cl-add"]').element as HTMLButtonElement).disabled).toBe(true)
  })

  it('已发布:显示页面 id + 组件 id,复制引用 / 接入代码写进剪贴板;空库有提示', async () => {
    const written: string[] = []
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: async (t: string) => void written.push(t) },
      configurable: true,
    })
    const w = mount(CardLibrary, { props: { config: cfg(), pageId: 'asset-1', version: 3 } })
    expect(w.find('[data-role="cl-summary"]').text()).toContain('已发布 version 3')
    const row = w.find('[data-card="w_a"]')
    expect(row.text()).toContain('asset-1')
    await row.find('[data-role="cl-copy-json"]').trigger('click')
    await row.find('[data-role="cl-copy-code"]').trigger('click')
    await nextTick()
    expect(written[0]).toBe('{"pageId":"asset-1","widgetId":"w_a"}')
    expect(written[1]).toContain(`pickWidget(page, 'w_a')`)
    expect(w.find('[data-role="cl-msg"]').text()).toContain('接入代码')
    const empty = mount(CardLibrary, { props: { config: { ...cfg(), widgets: [] }, pageId: null } })
    expect(empty.find('.cl-empty').exists()).toBe(true)
    vi.restoreAllMocks()
  })
})
