/** 实体树按站点范围裁剪(2026-09-17):只留认领的设备(网关跟着)与运算涉及的资产(祖先资产保结构),空组不留;不改输入。 */
import { describe, expect, it } from 'vitest'
import { buildMetaTree, countEntities, type TbAsset, type TbDevice } from '../src/meta/MetaNode'
import { pruneTree } from '../src/meta/scope'

const dev = (id: string, name: string, extra: Partial<TbDevice> = {}): TbDevice =>
  ({ id: { id }, name, type: 'IED', ...extra }) as TbDevice
const asset = (id: string, name: string, type = 'tbsite'): TbAsset => ({ id: { id }, name, type })
const DEVICES = [
  dev('gw1', 'GW1', { type: 'gateway' }),
  dev('gw2', 'GW2', { type: 'gateway' }),
  dev('a', 'SSP1_GP1_IED1', { additionalInfo: { lastConnectedGateway: 'gw1' } }),
  dev('b', 'SSP1_GP2_IED1', { additionalInfo: { lastConnectedGateway: 'gw1' } }),
  dev('c', 'PDR1_LP1_IED1', { additionalInfo: { lastConnectedGateway: 'gw2' } }),
  dev('d', 'ORPHAN_METER'),
]
const ASSETS = [
  asset('site', 'xrs'),
  asset('agg', 'xrs_CALC', 'tbsite-agg'),
  asset('other', 'other-site'),
  asset('dict', '遥测单位名称匹配接口'),
]
const CONTAINS = [{ from: 'site', to: 'agg' }]
const names = (n: { children: { name: string }[] }) => n.children.map(c => c.name)

describe('pruneTree', () => {
  it('设备只留认领的,网关跟着子设备留;资产只留范围内的,祖先保结构;空组去掉', () => {
    const full = buildMetaTree('xrs', DEVICES, ASSETS, CONTAINS)
    const t = pruneTree(full, { devices: ['SSP1_GP1_IED1'], assets: ['xrs_CALC'] })!
    expect(names(t)).toEqual(['GW1', '资产'])
    expect(names(t.children[0]!)).toEqual(['SSP1_GP1_IED1'])
    const site = t.children[1]!.children[0]!
    expect(site.name).toBe('xrs') // 祖先资产为了结构保留
    expect(names(site)).toEqual(['xrs_CALC'])
    expect(countEntities(t)).toBe(4) // GW1 + IED1 + xrs + xrs_CALC
    // 输入没被改
    expect(countEntities(full)).toBe(10)
  })

  it('网关本身在范围里时即使没有子设备也留;直连组有设备才留;资产名在范围里即留', () => {
    const full = buildMetaTree('xrs', DEVICES, ASSETS, CONTAINS)
    const t = pruneTree(full, { devices: ['GW2', 'ORPHAN_METER'], assets: ['xrs', 'other-site'] })!
    expect(names(t)).toEqual(['GW2', '直连 / 未归网关设备', '资产'])
    expect(t.children[0]!.children).toEqual([])
    expect(names(t.children[1]!)).toEqual(['ORPHAN_METER'])
    expect(names(t.children[2]!)).toEqual(['other-site', 'xrs'])
    expect(t.children[2]!.children.find(a => a.name === 'xrs')!.children).toEqual([]) // xrs_CALC 不在范围
  })

  it('没有 scope 或没有树 → 原样返回;范围为空 → 只剩根', () => {
    const full = buildMetaTree('xrs', DEVICES, ASSETS, CONTAINS)
    expect(pruneTree(full, null)).toBe(full)
    expect(pruneTree(null, { devices: [], assets: [] })).toBeNull()
    const empty = pruneTree(full, { devices: [], assets: [] })!
    expect(empty.children).toEqual([])
    expect(empty.name).toBe('xrs')
  })
})
