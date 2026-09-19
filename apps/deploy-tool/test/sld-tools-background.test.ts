// T5.7 底图描摹:文件检查(类型、3 MB)、写入 / 调整 / 缩放 / 移除;图层与浮层;工具 active / enabled
import { describe, expect, it, vi } from 'vitest'
import { nextTick, ref } from 'vue'
import { mount } from '@vue/test-utils'
import type { SldDoc } from '@grid/scada-renderer'
import { SLD_EDITOR_CTX, type SldEditorContext } from '../src/sld-editor/ext'
import { createSldStore } from '../src/sld-editor/store'
import {
  DEFAULT_BG_OPACITY,
  MAX_BG_BYTES,
  backgroundScale,
  checkBackgroundFile,
  patchBackground,
  removeBackground,
  scaleBackground,
  setBackground,
} from '../src/sld-editor/tools/background/ops'
import { loadBackgroundFile } from '../src/sld-editor/tools/background/load'
import { bgState } from '../src/sld-editor/tools/background/state'
import ext from '../src/sld-editor/tools/background/index'
import BackgroundImage from '../src/sld-editor/tools/background/BackgroundImage.vue'
import BackgroundPanel from '../src/sld-editor/tools/background/BackgroundPanel.vue'

const empty = (): SldDoc => ({
  v: 1,
  canvas: { w: 1200, h: 600, grid: 10 },
  nodes: [],
  buses: [],
  wires: [],
  labels: [],
})

describe('checkBackgroundFile', () => {
  it('png / jpg / svg 通过;其它类型拒绝;> 3 MB 拒绝', () => {
    expect(checkBackgroundFile({ name: 'a.png', size: 100, type: 'image/png' })).toBeUndefined()
    expect(checkBackgroundFile({ name: 'a.JPG', size: 100, type: '' })).toBeUndefined()
    expect(checkBackgroundFile({ name: 'a.svg', size: 100, type: 'image/svg+xml' })).toBeUndefined()
    expect(checkBackgroundFile({ name: 'a.pdf', size: 100, type: 'application/pdf' })).toMatch(/不是/)
    expect(checkBackgroundFile({ name: 'a.png', size: MAX_BG_BYTES, type: 'image/png' })).toBeUndefined()
    expect(checkBackgroundFile({ name: 'a.png', size: MAX_BG_BYTES + 1, type: 'image/png' })).toMatch(/3 MB/)
  })
})

describe('写入 / 调整 / 移除', () => {
  it('写入:默认透明度 0.35,铺到画布宽、等比算高;不知道尺寸时只给宽', () => {
    const d = empty()
    setBackground(d, 'data:image/png;base64,AAA', { w: 1920, h: 920 })
    expect(d.background).toEqual({
      src: 'data:image/png;base64,AAA',
      opacity: DEFAULT_BG_OPACITY,
      x: 0,
      y: 0,
      w: 1200,
      h: 575,
    })
    const d2 = empty()
    setBackground(d2, 'data:image/svg+xml,x')
    expect(d2.background).toEqual({ src: 'data:image/svg+xml,x', opacity: 0.35, x: 0, y: 0, w: 1200 })
  })
  it('换图保留透明度', () => {
    const d = empty()
    setBackground(d, 'a', { w: 100, h: 100 })
    patchBackground(d, { opacity: 0.6 })
    setBackground(d, 'b', { w: 100, h: 50 })
    expect(d.background).toMatchObject({ src: 'b', opacity: 0.6, h: 600 })
  })
  it('透明度夹到 [0.05, 1];位置取整;没变化返回 false', () => {
    const d = empty()
    expect(patchBackground(d, { opacity: 0.5 })).toBe(false) // 没有底图
    setBackground(d, 'a', { w: 100, h: 100 })
    expect(patchBackground(d, { opacity: 5, x: 12.6, y: -3.2 })).toBe(true)
    expect(d.background).toMatchObject({ opacity: 1, x: 13, y: -3 })
    patchBackground(d, { opacity: 0 })
    expect(d.background!.opacity).toBe(0.05)
    expect(patchBackground(d, { x: 13, y: Number.NaN })).toBe(false)
  })
  it('缩放:相对画布宽的百分比,高度等比', () => {
    const d = empty()
    setBackground(d, 'a', { w: 200, h: 100 }) // 1200 × 600
    expect(backgroundScale(d)).toBe(100)
    expect(scaleBackground(d, 50)).toBe(true)
    expect(d.background).toMatchObject({ w: 600, h: 300 })
    expect(backgroundScale(d)).toBe(50)
    expect(scaleBackground(d, 50)).toBe(false)
    scaleBackground(d, 1) // 夹到 5%
    expect(d.background!.w).toBe(60)
  })
  it('移除', () => {
    const d = empty()
    expect(removeBackground(d)).toBe(false)
    setBackground(d, 'a')
    expect(removeBackground(d)).toBe(true)
    expect('background' in d).toBe(false)
  })
})

function fakeCtx(doc: SldDoc = empty()) {
  const store = createSldStore({ doc, bindings: {} })
  const ro = ref(false)
  const ctx: SldEditorContext = {
    content: store.content,
    selection: store.selection,
    readonly: ro,
    apply: (r, l) => (ro.value ? false : store.apply(r, l)),
    select: s => store.select(s),
    newId: k => store.newId(k),
    toCanvas: p => p,
    view: { zoom: ref(1), fit: () => {}, zoomBy: () => {}, resetZoom: () => {} },
    host: {},
  }
  return { ctx, store, ro }
}
const withBg = (): SldDoc => {
  const d = empty()
  setBackground(d, 'data:image/png;base64,AAA', { w: 200, h: 100 })
  return d
}

describe('loadBackgroundFile', () => {
  it('超过 3 MB:拒绝、不改文档、浮层打开并显示原因', async () => {
    const { ctx, store } = fakeCtx()
    const big = new File([new Uint8Array(MAX_BG_BYTES + 10)], 'huge.png', { type: 'image/png' })
    expect(await loadBackgroundFile(ctx, big)).toBe(false)
    expect(store.canUndo.value).toBe(false)
    expect(bgState(ctx)).toMatchObject({ panel: true })
    expect(bgState(ctx).error).toMatch(/3 MB/)
  })
  it('小 svg:读成 data URL,按原始尺寸等比写入(一次 apply)', async () => {
    // happy-dom 不真的解码图片:换一个立刻 onload、报 10 × 5 的假 Image
    class FakeImage {
      naturalWidth = 10
      naturalHeight = 5
      onload: (() => void) | null = null
      onerror: (() => void) | null = null
      set src(_v: string) {
        queueMicrotask(() => this.onload?.())
      }
    }
    vi.stubGlobal('Image', FakeImage)
    const { ctx, store } = fakeCtx()
    const svg = new File(['<svg xmlns="http://www.w3.org/2000/svg" width="10" height="5"/>'], 'a.svg', {
      type: 'image/svg+xml',
    })
    expect(await loadBackgroundFile(ctx, svg)).toBe(true)
    const bg = store.content.value.doc.background!
    expect(bg.src.startsWith('data:image/svg+xml')).toBe(true)
    expect(bg).toMatchObject({ opacity: 0.35, x: 0, y: 0, w: 1200, h: 600 })
    expect(store.undoLabel.value).toBe('设置底图')
    vi.unstubAllGlobals()
  })
})

describe('工具、图层与浮层', () => {
  const tool = ext.tools![0]!
  it('active = 有底图且显示;enabled:只读且无底图时禁用', () => {
    const a = fakeCtx()
    expect(tool.active!(a.ctx)).toBe(false)
    a.ro.value = true
    expect(tool.enabled!(a.ctx)).toBe(false)
    const b = fakeCtx(withBg())
    expect(tool.active!(b.ctx)).toBe(true)
    bgState(b.ctx).visible = false
    expect(tool.active!(b.ctx)).toBe(false)
    b.ro.value = true
    expect(tool.enabled!(b.ctx)).toBe(true)
    expect(ext.layers!.map(l => l.z)).toEqual(['under', 'over'])
  })
  it('底图层:按文档画、显隐跟状态走', async () => {
    const { ctx } = fakeCtx(withBg())
    const w = mount(BackgroundImage, { global: { provide: { [SLD_EDITOR_CTX as symbol]: ctx } } })
    const img = w.find('img')
    expect(img.attributes('src')).toBe('data:image/png;base64,AAA')
    expect(img.attributes('style')).toContain('width: 1200px')
    expect(img.attributes('style')).toContain('height: 600px')
    expect(img.attributes('style')).toContain('opacity: 0.35')
    bgState(ctx).visible = false
    await nextTick()
    expect(w.find('img').exists()).toBe(false)
  })
  it('浮层:改透明度 / 缩放 / 移除各一步;只读时禁用改动控件但显隐可用', async () => {
    const { ctx, store, ro } = fakeCtx(withBg())
    void tool.run(ctx)
    const w = mount(BackgroundPanel, { global: { provide: { [SLD_EDITOR_CTX as symbol]: ctx } } })
    await nextTick()
    await w.find('[data-field=opacity]').setValue('0.6')
    expect(store.content.value.doc.background!.opacity).toBe(0.6)
    expect(store.undoLabel.value).toBe('底图透明度')
    await w.find('[data-field=scale]').setValue('50')
    expect(store.content.value.doc.background).toMatchObject({ w: 600, h: 300 })
    ro.value = true
    await nextTick()
    expect(w.find('[data-field=opacity]').attributes('disabled')).toBeDefined()
    expect(w.find('[data-act=remove]').attributes('disabled')).toBeDefined()
    expect(w.find('[data-field=visible]').attributes('disabled')).toBeUndefined()
    ro.value = false
    await nextTick()
    await w.find('[data-act=remove]').trigger('click')
    expect(store.content.value.doc.background).toBeUndefined()
    expect(bgState(ctx).panel).toBe(false)
    w.unmount()
  })
})
