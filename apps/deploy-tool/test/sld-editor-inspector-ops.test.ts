// 属性面板的电气参数:电源点 / 电源电压等级 / 母线电压等级 / 变压器各侧电压等级(带电着色按 kv 取色,ADR-005 D11)
import { describe, expect, it } from 'vitest'
import { emptySldDoc, type SldDoc } from '@grid/scada-renderer'
import { parseKv, setBusKv, setNodeSource, setPortKv } from '../src/sld-editor/panels/inspector/ops'

const doc = (): SldDoc => ({
  ...emptySldDoc(),
  nodes: [
    { id: 'src', symbol: 'incoming-arrow', x: 0, y: 0, rot: 0 },
    { id: 'tr', symbol: 'transformer-2w', x: 0, y: 100, rot: 0 },
  ],
  buses: [{ id: 'b1', x1: 0, y1: 300, x2: 400, y2: 300 }],
})

describe('属性面板 · 电气参数', () => {
  it('parseKv:空串 / 非数字 / 非正数 → undefined', () => {
    expect(parseKv('10')).toBe(10)
    expect(parseKv(' 0.4 ')).toBe(0.4)
    for (const t of ['', '  ', 'abc', '0', '-10']) expect(parseKv(t), t).toBeUndefined()
  })

  it('设 / 取消电源点,带或不带电压等级', () => {
    const d = doc()
    expect(setNodeSource(d, 'src', true, 10)).toBe(true)
    expect(d.nodes[0]!.source).toEqual({ kv: 10 })
    expect(setNodeSource(d, 'src', true, undefined)).toBe(true)
    expect(d.nodes[0]!.source).toEqual({})
    expect(setNodeSource(d, 'src', false)).toBe(true)
    expect('source' in d.nodes[0]!).toBe(false)
    expect(setNodeSource(d, 'src', false)).toBe(false) // 本来就不是:不算一次修改
    expect(setNodeSource(d, 'ghost', true)).toBe(false)
  })

  it('母线电压等级:设、清;清一个没设过的不算修改', () => {
    const d = doc()
    expect(setBusKv(d, 'b1', 0.4)).toBe(true)
    expect(d.buses[0]!.kv).toBe(0.4)
    expect(setBusKv(d, 'b1', undefined)).toBe(true)
    expect('kv' in d.buses[0]!).toBe(false)
    expect(setBusKv(d, 'b1', undefined)).toBe(false)
  })

  it('变压器各侧:逐侧设;两侧都清掉时去掉 portKv', () => {
    const d = doc()
    setPortKv(d, 'tr', 'hv', 10)
    setPortKv(d, 'tr', 'lv', 0.4)
    expect(d.nodes[1]!.portKv).toEqual({ hv: 10, lv: 0.4 })
    setPortKv(d, 'tr', 'hv', undefined)
    expect(d.nodes[1]!.portKv).toEqual({ lv: 0.4 })
    setPortKv(d, 'tr', 'lv', undefined)
    expect('portKv' in d.nodes[1]!).toBe(false)
    expect(setPortKv(d, 'tr', 'lv', undefined)).toBe(false)
  })
})
