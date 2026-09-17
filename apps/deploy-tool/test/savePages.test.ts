/** 第 4 步「保存并进入发布上线」(2026-09-17):校验拦截、线上版本冲突拦截、站点不存在提示、卡片库空跳过、失败停在中途。 */
import { describe, expect, it } from 'vitest'
import type { PagePayload, PublishPageResult, SitePageInfo } from '@grid/tbsite-compiler'
import { savePagesAndPublish, type SaveDeps, type SaveDoc } from '../src/provisioner/savePages'

const page = (n = 1): PagePayload =>
  ({
    schemaVersion: 1,
    template: 'grid-3x3',
    widgets: Array.from({ length: n }, (_, i) => ({ id: `w_${i}`, slot: `r1c${i + 1}`, type: 'text', bindings: {} })),
  }) as PagePayload

function deps(remote: SitePageInfo[] | Error, fail?: string): SaveDeps & { calls: string[] } {
  const calls: string[] = []
  let v = 0
  return {
    calls,
    api: async () => null,
    siteName: 'xrs',
    user: 'yy',
    listSitePages: async () => {
      if (remote instanceof Error) throw remote
      return remote
    },
    publishPage: async (_p, _api, opts): Promise<PublishPageResult> => {
      calls.push(`${opts.pageName}${opts.kind ? `[${opts.kind}]` : ''}`)
      if (fail && opts.pageName === fail)
        return {
          ok: false,
          pageName: opts.pageName!,
          unresolved: [{ type: 'DEVICE', name: 'X', at: ['w_0/value'] }],
          failedStep: 'resolve',
          error: '1 个实体按名称解析不到',
          rolledBack: [],
        }
      v++
      return {
        ok: true,
        pageName: opts.pageName!,
        assetId: `a-${opts.pageName}`,
        version: v,
        unresolved: [],
        rolledBack: [],
      }
    },
  }
}
const docs = (over: Partial<SaveDoc>[] = []): SaveDoc[] => [
  { label: '页面', config: page(), pageName: 'xrs-总览', errorCount: 0, ...(over[0] ?? {}) },
  { label: '卡片库', kind: 'cards', config: page(2), pageName: 'xrs-卡片库', errorCount: 0, ...(over[1] ?? {}) },
]

describe('savePagesAndPublish', () => {
  it('两份都发,卡片库带 kind;返回版本', async () => {
    const d = deps([])
    const r = await savePagesAndPublish(docs(), d)
    expect(r.ok).toBe(true)
    expect(d.calls).toEqual(['xrs-总览', 'xrs-卡片库[cards]'])
    expect(r.published.map(p => [p.label, p.version])).toEqual([
      ['页面', 1],
      ['卡片库', 2],
    ])
    expect(r.msg).toContain('页面 v1')
  })

  it('卡片库空的跳过;校验有错不发不跳', async () => {
    const d = deps([])
    const r = await savePagesAndPublish(docs([{}, { config: page(0) }]), d)
    expect(d.calls).toEqual(['xrs-总览'])
    expect(r.ok).toBe(true)
    const d2 = deps([])
    const r2 = await savePagesAndPublish(docs([{ errorCount: 2 }]), d2)
    expect(r2).toMatchObject({ ok: false, block: 'errors' })
    expect(d2.calls).toEqual([])
    expect(r2.msg).toContain('2 个错误')
  })

  it('线上版本与本地记录不一致 → conflict,不发;一致 → 发', async () => {
    const remote: SitePageInfo[] = [{ assetId: 'a1', name: 'xrs-总览', version: 3 }]
    const d = deps(remote)
    const r = await savePagesAndPublish(docs([{ published: { assetId: 'a1', version: 2 } }]), d)
    expect(r).toMatchObject({ ok: false, block: 'conflict' })
    expect(d.calls).toEqual([])
    expect(r.msg).toContain('version 3')
    // 本地从没发布过、线上却有 → 也算冲突
    const d2 = deps(remote)
    expect((await savePagesAndPublish(docs(), d2)).block).toBe('conflict')
    const d3 = deps(remote)
    const ok = await savePagesAndPublish(docs([{ published: { assetId: 'a1', version: 3 } }]), d3)
    expect(ok.ok).toBe(true)
    expect(d3.calls).toHaveLength(2)
  })

  it('站点资产不存在 → site-missing 提示先发规则;其它读取错误照抛', async () => {
    const r = await savePagesAndPublish(docs(), deps(new Error('站点资产「xrs」不存在')))
    expect(r).toMatchObject({ ok: false, block: 'site-missing' })
    expect(r.msg).toContain('第 5 步')
    await expect(savePagesAndPublish(docs(), deps(new Error('/api/relations → HTTP 500')))).rejects.toThrow('500')
  })

  it('第二份发布失败:停下,报出解析不到的实体,并说明第一份已成功', async () => {
    const d = deps([], 'xrs-卡片库')
    const r = await savePagesAndPublish(docs(), d)
    expect(r).toMatchObject({ ok: false, block: 'failed' })
    expect(r.published.map(p => p.label)).toEqual(['页面'])
    expect(r.msg).toContain('DEVICE X')
    expect(r.msg).toContain('页面已发布成功')
  })
})
