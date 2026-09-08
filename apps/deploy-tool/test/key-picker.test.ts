// KeyPicker:2026-09-08 「选择测点选不了」——面板在全屏编辑覆盖层底下 + 单组默认折叠。这里锁住展开规则;层级在浏览器里核。
import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import KeyPicker from '../src/components/KeyPicker.vue'

const items = (n: number, p = 'k') => Array.from({ length: n }, (_, i) => ({ value: `${p}${i}`, label: `${p}${i}` }))
const open = async (groups: unknown[]) => {
  const w = mount(KeyPicker, { props: { modelValue: '', groups }, global: { stubs: { Teleport: true } } })
  await w.find('.kp-btn').trigger('click')
  return w
}

describe('KeyPicker 分组展开规则', () => {
  it('只有一组(单设备的遥测)时默认展开,能直接点到测点', async () => {
    const w = await open([{ label: '遥测(6)', items: items(6) }])
    expect(w.findAll('.kp-item')).toHaveLength(6)
    await w.findAll('.kp-item')[2]!.trigger('mousedown')
    expect(w.emitted('update:modelValue')?.[0]).toEqual(['k2'])
  })
  it('有 pinned 组时仍只展开 pinned,其余折叠(向导里几十台设备不铺满)', async () => {
    const w = await open([
      { label: '⭐ 计算结果(calc_)', items: items(2, 'calc_'), pinned: true },
      { label: 'A 设备', items: items(30, 'a') },
      { label: 'B 设备', items: items(30, 'b') },
    ])
    expect(w.findAll('.kp-item').map(i => i.text())).toEqual(['calc_0', 'calc_1'])
    await w.findAll('.kp-group')[1]!.trigger('mousedown')
    expect(w.findAll('.kp-item')).toHaveLength(32)
  })
  it('无 pinned、多组但总数 ≤ 40 时全部展开;超过则折叠', async () => {
    const few = await open([
      { label: 'A', items: items(10, 'a') },
      { label: 'B', items: items(10, 'b') },
    ])
    expect(few.findAll('.kp-item')).toHaveLength(20)
    const many = await open([
      { label: 'A', items: items(30, 'a') },
      { label: 'B', items: items(30, 'b') },
    ])
    expect(many.findAll('.kp-item')).toHaveLength(0)
  })
  it('过滤关键字时命中组强制展开', async () => {
    const w = await open([
      { label: 'A', items: items(30, 'a') },
      { label: 'B', items: items(30, 'b') },
    ])
    await w.find('.kp-q').setValue('b1')
    expect(w.findAll('.kp-item').map(i => i.text())).toEqual([
      'b1',
      'b10',
      'b11',
      'b12',
      'b13',
      'b14',
      'b15',
      'b16',
      'b17',
      'b18',
      'b19',
    ])
  })
})
