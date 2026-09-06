// T2.5 元数据读取补齐:Asset 树按 Contains 递归嵌套(含环与缺失端的防御)、MetaClient.assetContains 只留资产→资产。
import { describe, expect, it } from 'vitest'
import { buildMetaTree, flattenTree, MetaClient, type TbAsset } from '../src/meta/MetaNode'

const asset = (id: string, name: string, type = 'tbsite'): TbAsset => ({ id: { id }, name, type })
const ASSETS = [
  asset('site', 'xrs-mirror-test'),
  asset('pg1', '仙人山服务区 · 总览', 'ScadaPage'),
  asset('pg2', 'xrs-mirror-test · 迁移验证', 'ScadaPage'),
  asset('sub', '南区', 'tbsite'),
  asset('agg', 'RT_TOTAL_P_TEST', 'tbsite-agg'),
  asset('lonely', 'BS_1_CK', 'tbsite'),
]

describe('Asset 树(Contains 递归)', () => {
  it('没有关系时资产平铺;有关系时按 Contains 嵌套,根只留没被包含的', () => {
    const names = (list: { name: string }[]) => list.map(n => n.name).sort()
    const flat = buildMetaTree('S', [], ASSETS)
    expect(names(flat.children[0]!.children)).toEqual(names(ASSETS))
    expect(flat.children[0]!.children.every(n => n.children.length === 0)).toBe(true)
    const t = buildMetaTree('S', [], ASSETS, [
      { from: 'site', to: 'pg1' },
      { from: 'site', to: 'sub' },
      { from: 'sub', to: 'pg2' },
      { from: 'site', to: 'agg' },
    ])
    const group = t.children[0]!
    expect(names(group.children)).toEqual(['BS_1_CK', 'xrs-mirror-test'])
    const site = group.children.find(n => n.name === 'xrs-mirror-test')!
    expect(names(site.children)).toEqual(['RT_TOTAL_P_TEST', '仙人山服务区 · 总览', '南区'])
    const sub = site.children.find(n => n.name === '南区')!
    expect(sub.children.map(n => n.name)).toEqual(['xrs-mirror-test · 迁移验证'])
    expect(sub.children[0]!.entity).toEqual({
      type: 'ASSET',
      id: 'pg2',
      name: 'xrs-mirror-test · 迁移验证',
    })
  })

  it('防御:自环 / 互相包含 / 端点不在列表 / 多个父节点 都不会让树炸掉或丢资产', () => {
    const t = buildMetaTree('S', [], ASSETS, [
      { from: 'site', to: 'site' },
      { from: 'site', to: 'sub' },
      { from: 'sub', to: 'site' }, // 成环,忽略
      { from: 'ghost', to: 'pg1' }, // from 不存在,忽略
      { from: 'sub', to: 'pg2' },
      { from: 'site', to: 'pg2' }, // 已有父节点,忽略
    ])
    const names: string[] = []
    const walk = (n: { name: string; children: { name: string; children: unknown[] }[] }) => {
      names.push(n.name)
      n.children.forEach(c => walk(c as never))
    }
    walk(t.children[0]! as never)
    expect(names.filter(n => n !== '资产').sort()).toEqual(ASSETS.map(a => a.name).sort())
    const site = t.children[0]!.children.find(n => n.name === 'xrs-mirror-test')!
    expect(site.children.map(n => n.name)).toEqual(['南区'])
    expect(site.children[0]!.children.map(n => n.name)).toEqual(['xrs-mirror-test · 迁移验证'])
  })

  it('flattenTree:嵌套资产按深度出行;过滤命中子资产时祖先展开', () => {
    const t = buildMetaTree('S', [], ASSETS, [
      { from: 'site', to: 'sub' },
      { from: 'sub', to: 'pg2' },
    ])
    const rows = flattenTree(t, new Set(['site', 'group:assets', 'site' /* asset id 与 root 同名,故意 */, 'sub']))
    expect(rows.map(r => `${r.depth}:${r.node.name}`)).toContain('2:xrs-mirror-test')
    const q = flattenTree(t, new Set(['site']), '迁移验证')
    expect(q.map(r => `${r.depth}:${r.node.name}`)).toEqual([
      '0:S',
      '1:资产',
      '2:xrs-mirror-test',
      '3:南区',
      '4:xrs-mirror-test · 迁移验证',
    ])
  })

  it('MetaClient.assetContains:逐资产查 /api/relations,只留 to 为 ASSET 的,单个失败不影响其它', async () => {
    const calls: string[] = []
    const api = async (url: string) => {
      calls.push(url)
      if (url.includes('fromId=site'))
        return [
          { to: { entityType: 'ASSET', id: 'pg1' } },
          { to: { entityType: 'DEVICE', id: 'd1' } },
          { to: { entityType: 'ASSET', id: 'sub' } },
        ]
      if (url.includes('fromId=sub')) throw new Error('HTTP 403')
      return []
    }
    const rels = await new MetaClient(api).assetContains(ASSETS)
    expect(rels.sort((a, b) => a.to.localeCompare(b.to))).toEqual([
      { from: 'site', to: 'pg1' },
      { from: 'site', to: 'sub' },
    ])
    expect(calls).toHaveLength(ASSETS.length)
    expect(calls[0]).toBe('/api/relations?fromId=site&fromType=ASSET&relationType=Contains')
  })
})
