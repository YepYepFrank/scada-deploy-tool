// T5.8 接线图覆盖层:SldEditor 用 stub 替掉(不在 happy-dom 里起 X6);本地副本、完成 / 放弃 / 关闭、离开保护。
// 注:仓库里没有 mount EditorApp 的先例(它拉 useMeta / useProject / 全屏等一整套),EditorApp 的接线只在浏览器里点验;
// 写回逻辑本身在 sld-integration-logic.test.ts 的 useEditorState 用例里覆盖。
import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { defineComponent, h, type PropType } from 'vue'
import { emptySldDoc, type Binding } from '@grid/scada-renderer'
import type { SldEditorContent } from '../src/sld-editor/ext'

vi.mock('../src/sld-editor/SldEditor.vue', () => ({
  default: defineComponent({
    name: 'SldEditorStub',
    props: { content: { type: Object as PropType<SldEditorContent>, required: true }, host: Object },
    emits: ['update:content', 'close'],
    setup(props, { emit }) {
      return () =>
        h('div', { 'data-role': 'sld-stub', 'data-nodes': props.content.doc.nodes.length }, [
          h('button', {
            'data-role': 'stub-draw',
            onClick: () => {
              const doc = { ...props.content.doc, nodes: [...props.content.doc.nodes] }
              doc.nodes.push({ id: `n${doc.nodes.length + 1}`, symbol: 'breaker', x: 0, y: 0, rot: 0 })
              const pt: Binding = { mode: 'ts', entity: { type: 'DEVICE', id: '', name: 'D' }, key: 'k' }
              emit('update:content', { doc, bindings: { ...props.content.bindings, 'pt.new': pt } })
            },
          }),
          h('button', { 'data-role': 'stub-close', onClick: () => emit('close') }),
        ])
    },
  }),
}))

import SldEditorOverlay from '../src/editor/SldEditorOverlay.vue'

const initial = (): SldEditorContent => ({ doc: emptySldDoc(), bindings: {} })

async function mountOverlay() {
  const w = mount(SldEditorOverlay, { props: { initial: initial(), host: { siteName: 's' } }, attachTo: document.body })
  await flushPromises()
  await vi.dynamicImportSettled()
  await flushPromises()
  return w
}
const q = (sel: string) => document.body.querySelector(sel) as HTMLElement | null

afterEach(() => {
  document.body.innerHTML = ''
  vi.restoreAllMocks()
})

describe('SldEditorOverlay', () => {
  it('懒加载编辑器;改动只进本地副本,点「完成」交回最终内容', async () => {
    const w = await mountOverlay()
    expect(q('[data-role="sld-overlay"]')).not.toBeNull()
    expect(q('[data-role="sld-stub"]')).not.toBeNull()
    q('[data-role="stub-draw"]')!.click()
    await flushPromises()
    q('[data-role="stub-draw"]')!.click()
    await flushPromises()
    expect(q('[data-role="sld-stub"]')!.dataset.nodes).toBe('2')
    expect(q('[data-role="sld-dirty"]')!.textContent).toContain('有未写回的修改')
    expect(w.emitted('done')).toBeUndefined()
    q('[data-role="sld-done"]')!.click()
    const done = w.emitted('done') as [SldEditorContent][]
    expect(done).toHaveLength(1)
    expect(done[0]![0].doc.nodes).toHaveLength(2)
    expect(Object.keys(done[0]![0].bindings)).toEqual(['pt.new'])
    w.unmount()
  })

  it('编辑器自己的「关闭」等同「完成」', async () => {
    const w = await mountOverlay()
    q('[data-role="stub-close"]')!.click()
    expect(w.emitted('done')).toHaveLength(1)
    w.unmount()
  })

  it('放弃修改:有改动时二次确认,取消则留在编辑器;没改动直接放弃', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true)
    const w = await mountOverlay()
    q('[data-role="stub-draw"]')!.click()
    await flushPromises()
    q('[data-role="sld-discard"]')!.click()
    expect(w.emitted('cancel')).toBeUndefined()
    q('[data-role="sld-discard"]')!.click()
    expect(w.emitted('cancel')).toHaveLength(1)
    expect(confirmSpy).toHaveBeenCalledTimes(2)
    w.unmount()

    confirmSpy.mockClear()
    const w2 = await mountOverlay()
    q('[data-role="sld-discard"]')!.click()
    expect(w2.emitted('cancel')).toHaveLength(1)
    expect(confirmSpy).not.toHaveBeenCalled()
    w2.unmount()
  })

  it('有改动时拦 beforeunload,没改动不拦', async () => {
    const w = await mountOverlay()
    const ev1 = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(ev1)
    expect(ev1.defaultPrevented).toBe(false)
    q('[data-role="stub-draw"]')!.click()
    await flushPromises()
    const ev2 = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(ev2)
    expect(ev2.defaultPrevented).toBe(true)
    w.unmount()
  })
})
