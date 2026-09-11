// 第 4 步编辑器实体树:网关 / 设备名一律「中文(英文)」(2026-09-11)——TB 标签是中文就放前面,英文标签与分组名原样。
import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import EntityTree from '../src/editor/EntityTree.vue'
import { buildMetaTree } from '../src/meta/MetaNode'

describe('实体树名称:中文(英文)', () => {
  it('网关 / 设备的 TB 标签是中文就放前面;英文标签、没有标签的、分组名原样', () => {
    const root = buildMetaTree('S', [
      { id: { id: 'g1' }, name: 'bs_2_ems', type: 'gateway', label: '基站储能(滨湖保兴村)' },
      {
        id: { id: 'd1' },
        name: 'BS_2_CK',
        type: 'default',
        label: '储能总进线测量仪表',
        additionalInfo: { lastConnectedGateway: 'g1' },
      },
      { id: { id: 'g2' }, name: 'xrs_fileserver', type: 'gateway', label: 'Gateway' },
      { id: { id: 'd3' }, name: 'SSP1', type: 'default' },
    ])
    const names = mount(EntityTree, { props: { root } })
      .findAll('.et-name')
      .map(e => e.text())
    expect(names).toContain('基站储能(滨湖保兴村)（bs_2_ems）')
    expect(names).toContain('储能总进线测量仪表（BS_2_CK）')
    expect(names).toContain('xrs_fileserver')
    expect(names).toContain('SSP1')
    expect(names).toContain('直连 / 未归网关设备')
  })
})
