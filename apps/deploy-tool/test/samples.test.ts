/**
 * `docs/样例/` 里的样例工程必须是能用的。
 *
 * 起因:2026-09-09 同事把她的宿主对着我们给的样例跑,第二页「南区配电房」整页打不开——
 * `dual-axis` 的 `primary` / `secondary` 是单序列槽位,样例里却写成了数组,注册表校验直接拦下。
 * 这一页多半从来没被渲染过。样例是要交给现场当参考的,带着一页打不开的配置出去不行。
 *
 * 这里对每份样例的每一页跑一遍**静态校验**(schema + 注册表 + 属性 + 模板,不需要连 TB),
 * 顺便锁住「注释版去掉注释后必须与正式版逐字节等价」——注释版是给人看的教学件,
 * 一旦和正式版漂移,教出来的就是错的。
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'

// 组件里用到 echarts,单测环境没有 canvas,按既有做法打桩
vi.mock('echarts/core', () => ({
  init: () => ({ setOption: vi.fn(), resize: vi.fn(), dispose: vi.fn() }),
  use: () => {},
  color: { modifyAlpha: (c: string) => c },
  graphic: { LinearGradient: class {} },
}))
vi.mock('echarts/charts', () => ({ LineChart: {}, BarChart: {}, GaugeChart: {} }))
vi.mock('echarts/components', () => ({ GridComponent: {}, TooltipComponent: {}, LegendComponent: {} }))
vi.mock('echarts/renderers', () => ({ CanvasRenderer: {} }))

import { registerBuiltins, ScadaPage, type PageConfig } from '@grid/scada-renderer'
import { parseProject } from '../src/project/scadaproj'
import { validateStatic } from '../src/editor/validate'

registerBuiltins()

const SAMPLES = resolve(__dirname, '../../../docs/样例')
const read = (name: string) => readFileSync(resolve(SAMPLES, name), 'utf8')

/** 去掉 JSONC 的注释;要认字符串,否则 "http://…" 里的 // 会被当注释砍掉 */
function stripJsonComments(src: string): string {
  let out = ''
  let inStr = false
  let esc = false
  for (let i = 0; i < src.length; i++) {
    const c = src[i]!
    if (inStr) {
      out += c
      if (esc) esc = false
      else if (c === '\\') esc = true
      else if (c === '"') inStr = false
      continue
    }
    if (c === '"') {
      inStr = true
      out += c
      continue
    }
    if (c === '/' && src[i + 1] === '/') {
      while (i < src.length && src[i] !== '\n') i++
      out += '\n'
      continue
    }
    out += c
  }
  return out
}

const PLAIN = ['xianrenshan.scadaproj', 'xianrenshan.scadaproj.json']

describe('docs/样例 的样例工程', () => {
  for (const name of PLAIN) {
    it(`${name}:每一页都通过静态校验(schema / 注册表 / 属性 / 模板)`, () => {
      const proj = parseProject(read(name))
      expect(proj.pages.length).toBeGreaterThan(0)
      for (const page of proj.pages as PageConfig[]) {
        const errors = validateStatic(page).filter(i => i.level === 'error')
        // 失败时把页名和问题一起报出来,不用再去翻文件
        expect(
          errors.map(e => `${page.title} · ${e.layer} ${e.path} ${e.message}`),
          `「${page.title}」有 ${errors.length} 条 error`
        ).toEqual([])
      }
    })

    it(`${name}:每一页都真能渲染出来(design 模式,不连 TB)`, () => {
      // 校验通过只说明形状对;这里真挂一遍组件——同事那次就是「整页打不开」
      const proj = parseProject(read(name))
      for (const page of proj.pages as PageConfig[]) {
        const w = mount(ScadaPage, { props: { config: page, design: true } })
        // 整页打不开时渲染器画 .sr-fatal(同事看到的就是这个)
        const fatal = w.find('.sr-fatal')
        expect(fatal.exists(), `「${page.title}」整页打不开:${fatal.exists() ? fatal.text() : ''}`).toBe(false)
        expect(w.findAll('.sr-slot[data-slot]').length, `「${page.title}」一个槽位都没画出来`).toBeGreaterThanOrEqual(
          page.widgets.length
        )
        // 单个组件的阻断性问题会列在角标里,并且 <ScadaPage> 会 emit('invalid')
        expect(
          w.findAll('.sr-issue').map(e => e.text().replace(/\s+/g, ' ')),
          `「${page.title}」有组件报错`
        ).toEqual([])
        expect(w.emitted('invalid') ?? [], `「${page.title}」渲染器报了 invalid`).toEqual([])
        w.unmount()
      }
    })

    it(`${name}:dual-axis 的 primary / secondary 是单个对象,不是数组`, () => {
      const proj = parseProject(read(name))
      const bad: string[] = []
      for (const page of proj.pages as PageConfig[])
        for (const w of page.widgets) {
          if (w.type !== 'dual-axis') continue
          for (const slot of ['primary', 'secondary'])
            if (Array.isArray(w.bindings?.[slot])) bad.push(`${page.title} · ${w.id}/${slot}`)
        }
      expect(bad).toEqual([])
    })
  }

  /*
   * 注释版是教学件,它自己开头写明「为了可读,12 台设备只展开前 3 台」——所以设备清单
   * 允许精简,别的都不许漂移:页面(真正渲染的部分)、运算、模板、连接、已发布记录必须一致,
   * 保留下来的设备也必须与正式版逐字一样,不能是编出来的。
   */
  it('注释版:除有意精简的设备清单外,与正式版一致', () => {
    const jsonc = JSON.parse(stripJsonComments(read('xianrenshan.scadaproj.注释版.jsonc')))
    const plain = JSON.parse(read('xianrenshan.scadaproj'))

    expect(jsonc.pages).toEqual(plain.pages) // 页面必须完全一致,否则教的就是错的
    expect(jsonc.version).toEqual(plain.version)
    expect(jsonc.siteName).toEqual(plain.siteName)
    expect(jsonc.connection).toEqual(plain.connection)
    expect(jsonc.published).toEqual(plain.published)
    expect(jsonc.rules.computations).toEqual(plain.rules.computations)
    expect(jsonc.rules.deviceTemplates).toEqual(plain.rules.deviceTemplates)
    expect(Object.keys(jsonc.rules).sort()).toEqual(Object.keys(plain.rules).sort())

    type Dev = { name: string }
    const plainByName = new Map((plain.rules.devices as Dev[]).map(d => [d.name, d]))
    const kept = jsonc.rules.devices as Dev[]
    expect(kept.length).toBeGreaterThan(0)
    expect(kept.length).toBeLessThanOrEqual((plain.rules.devices as Dev[]).length)
    for (const d of kept) {
      expect(plainByName.has(d.name), `注释版里的设备「${d.name}」在正式版里没有`).toBe(true)
      expect(d, `设备「${d.name}」两份内容不一致`).toEqual(plainByName.get(d.name))
    }
  })

  it('注释剥离器本身认字符串(不会砍掉 "http://…" 里的斜杠)', () => {
    const src = '{ "a": "http://x//y", "b": 1 } // 尾注释'
    expect(JSON.parse(stripJsonComments(src))).toEqual({ a: 'http://x//y', b: 1 })
  })
})
