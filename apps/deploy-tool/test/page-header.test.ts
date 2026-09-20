/**
 * 大屏抬头的草稿改写(editor/page-header.ts):空字段要清干净,整块空了连 header 一起删。
 */
import { describe, it, expect } from 'vitest'
import type { PageConfig } from '@grid/scada-renderer'
import {
  headerVisible,
  MAX_LOGO_BYTES,
  readLogoDataUrl,
  setHeaderAlign,
  setHeaderShow,
  setHeaderText,
} from '../src/editor/page-header'

const doc = (): PageConfig => ({ schemaVersion: 1, template: 'overview-a', widgets: [] })

describe('setHeaderText', () => {
  it('第一次写就建出 header;首尾空白去掉', () => {
    const d = doc()
    setHeaderText(d, 'title', '  仙人山服务区智能微电网监控系统 ')
    expect(d.header).toEqual({ title: '仙人山服务区智能微电网监控系统' })
  })

  it('清空某个字段就删掉它,其他字段留着', () => {
    const d = doc()
    setHeaderText(d, 'title', '某站')
    setHeaderText(d, 'subtitle', 'SOME STATION')
    setHeaderText(d, 'subtitle', '')
    expect(d.header).toEqual({ title: '某站' })
  })

  it('最后一个字段也清空:整个 header 从页面 JSON 里消失', () => {
    const d = doc()
    setHeaderText(d, 'org', '国网电瑞')
    setHeaderText(d, 'org', '')
    expect('header' in d).toBe(false)
  })
})

describe('align / show', () => {
  it('居中是缺省值,不落进 JSON;靠左才写', () => {
    const d = doc()
    setHeaderText(d, 'title', '某站')
    setHeaderAlign(d, 'left')
    expect(d.header?.align).toBe('left')
    setHeaderAlign(d, 'center')
    expect(d.header).toEqual({ title: '某站' })
  })

  it('show 只在关掉时写入;关掉后字还在,只是不画', () => {
    const d = doc()
    setHeaderText(d, 'title', '某站')
    setHeaderShow(d, false)
    expect(d.header).toEqual({ title: '某站', show: false })
    expect(headerVisible(d)).toBe(false)
    setHeaderShow(d, true)
    expect(d.header).toEqual({ title: '某站' })
    expect(headerVisible(d)).toBe(true)
  })

  it('只关开关、没有标题:不留空壳', () => {
    const d = doc()
    setHeaderShow(d, true)
    expect('header' in d).toBe(false)
  })
})

describe('headerVisible', () => {
  it('没标题就不算画', () => {
    const d = doc()
    expect(headerVisible(d)).toBe(false)
    setHeaderText(d, 'subtitle', '只有副标')
    expect(headerVisible(d)).toBe(false)
  })
})

describe('readLogoDataUrl', () => {
  const file = (bytes: number, type = 'image/png') => ({ type, size: bytes, name: 'logo.png' }) as unknown as File

  it('非图片直接拒', () => {
    expect(() => readLogoDataUrl(file(10, 'application/pdf'))).toThrow(/请选图片/)
  })

  it('超过 200 KB 拒绝,并把实际大小说出来', () => {
    expect(() => readLogoDataUrl(file(MAX_LOGO_BYTES + 1))).toThrow(/超过 200 KB/)
  })
})
