// 接管平台上已有的计算字段(2026-09-11):能翻的翻成等价的向导运算,翻不了的说清原因。
import { describe, expect, it } from 'vitest'
import { adoptCf, buildCf, parseExpression, type AdoptContext, type PlatformCf } from '../src/index'

const names: Record<string, string> = { 'id-d1': 'D1', 'id-d2': 'D2', 'id-d3': 'D3', 'id-a': 'ASSET_X' }
const ctx = (hostType: 'DEVICE' | 'ASSET' = 'ASSET', hostName = 'ASSET_X', claimed = ['D1', 'D2']): AdoptContext => ({
  hostType,
  hostName,
  nameOfId: id => names[id],
  claimed: new Set(claimed),
})
const dev = (id: string, key = 'P') => ({
  refEntityId: { entityType: 'DEVICE', id },
  refEntityKey: { type: 'TS_LATEST', key },
})
const cf = (expression: string, args: Record<string, unknown>, extra: Partial<PlatformCf> = {}): PlatformCf => ({
  name: '实时曲线-负荷',
  type: 'SIMPLE',
  entityId: { entityType: 'ASSET', id: 'id-a' },
  configuration: {
    type: 'SIMPLE',
    expression,
    arguments: args as never,
    output: { type: 'TIME_SERIES', name: 'tsLoad' },
  },
  ...extra,
})
const reasonOf = (r: ReturnType<typeof adoptCf>) => (r.ok ? 'ok' : r.reason)

describe('adoptCf', () => {
  it('资产上的多设备求和 → 资产宿主的自定义四则;字段名 ≠ 输出名时带 cfName', () => {
    const r = adoptCf(cf('P1+P2', { P1: dev('id-d1'), P2: dev('id-d2') }), ctx())
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.computation).toEqual({
      template: 'expr.custom',
      asset: 'ASSET_X',
      terms: [
        { kind: 'key', device: 'D1', key: 'P' },
        { kind: 'key', device: 'D2', key: 'P' },
      ],
      ops: ['+'],
      output: 'tsLoad',
      outputMode: 'ts',
      adopted: true,
      cfName: '实时曲线-负荷',
    })
    expect(r.notes).toEqual([])
  })

  it('设备上引用自身测点;单项 abs 补「+ 0」;服务端属性输出 → attr', () => {
    const r = adoptCf(
      {
        name: 'absQ',
        type: 'SIMPLE',
        entityId: { entityType: 'DEVICE', id: 'id-d1' },
        configuration: {
          expression: 'abs(Q)',
          arguments: { Q: { refEntityKey: { type: 'TS_LATEST', key: 'Q' } } },
          output: { type: 'ATTRIBUTES', scope: 'SERVER_SCOPE', name: 'absQ' },
        },
      },
      ctx('DEVICE', 'D1')
    )
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.computation).toMatchObject({
      device: 'D1',
      terms: [
        { kind: 'key', device: 'D1', key: 'Q', abs: true },
        { kind: 'const', value: 0 },
      ],
      ops: ['+'],
      outputMode: 'attr',
    })
    expect(r.computation.cfName).toBeUndefined()
  })

  it('向导自己生成的带括号写法也认,翻完再生成的表达式与原来一致', () => {
    const r = adoptCf(cf('((abs(v0)) * 2) - v1', { v0: dev('id-d1'), v1: dev('id-d2', 'Q') }), ctx())
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const body = buildCf(r.computation, 'id-a', { D1: 'id-d1', D2: 'id-d2' }, 'ASSET')
    expect(body.name).toBe('实时曲线-负荷')
    expect(body.configuration.expression).toBe('((abs(v0)) * 2) - v1')
    expect(body.configuration.output).toMatchObject({ type: 'TIME_SERIES', name: 'tsLoad' })
    expect(body.configuration.arguments.v1!.refEntityId).toEqual({ entityType: 'DEVICE', id: 'id-d2' })
  })

  it('翻不了的说清原因', () => {
    const two = { P1: dev('id-d1'), P2: dev('id-d2') }
    expect(reasonOf(adoptCf(cf('3840', { x: dev('id-d1') }), ctx()))).toContain('纯常数')
    expect(reasonOf(adoptCf(cf('abs(P1+P2)', two), ctx()))).toContain('abs 包住了整个式子')
    expect(reasonOf(adoptCf(cf('P1+P2*2', two), ctx()))).toContain('运算优先级')
    expect(reasonOf(adoptCf(cf('sqrt(P1)', two), ctx()))).toContain('不支持的函数 sqrt')
    expect(
      reasonOf(
        adoptCf(
          cf('P1+P2', {
            P1: dev('id-d1'),
            P2: {
              refEntityId: { entityType: 'DEVICE', id: 'id-d2' },
              refEntityKey: { type: 'ATTRIBUTE', key: 'cap', scope: 'SERVER_SCOPE' },
            },
          }),
          ctx()
        )
      )
    ).toContain('取的是属性')
    expect(
      reasonOf(
        adoptCf(
          cf('P1+P2', {
            P1: dev('id-d1'),
            P2: { refEntityId: { entityType: 'ASSET', id: 'id-a' }, refEntityKey: { type: 'TS_LATEST', key: 'x' } },
          }),
          ctx()
        )
      )
    ).toContain('引用的是资产 ASSET_X')
    expect(reasonOf(adoptCf(cf('x+1', { x: { refEntityKey: { type: 'TS_LATEST', key: 'x' } } }), ctx()))).toContain(
      '资产自身的测点'
    )
    const r = adoptCf(cf('P1+P3', { P1: dev('id-d1'), P3: dev('id-d3') }), ctx())
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.reason).toContain('D3 还没在第 2 步认领')
      expect(r.needDevices).toEqual(['D3'])
    }
    expect(reasonOf(adoptCf(cf('P1+P2', two, { type: 'SCRIPT' }), ctx()))).toContain('只认 SIMPLE')
  })

  it('定义了没用到的参数 → 提示疑似笔误(镜像上「实时曲线-负荷总功率-SSP1」就是这样),接管照原样保留算法', () => {
    const r = adoptCf(cf('P141+151+161', { P141: dev('id-d1'), P151: dev('id-d2'), P161: dev('id-d2') }), ctx())
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.notes[0]).toContain('P151、P161 定义了但表达式里没用到')
    expect(r.notes[0]).toContain('疑似笔误')
    expect(r.computation.terms).toEqual([
      { kind: 'key', device: 'D1', key: 'P' },
      { kind: 'const', value: 151 },
      { kind: 'const', value: 161 },
    ])
  })

  it('左结合的乘除可以翻(P1 / 2 − P2),右边是式子的不行', () => {
    expect(adoptCf(cf('P1 / 2 - P2', { P1: dev('id-d1'), P2: dev('id-d2') }), ctx()).ok).toBe(true)
    expect(reasonOf(adoptCf(cf('P1 - (P2 - 1)', { P1: dev('id-d1'), P2: dev('id-d2') }), ctx()))).toContain(
      '运算优先级'
    )
  })

  it('parseExpression 报语法错', () => {
    expect(() => parseExpression('P1 +')).toThrow('不完整')
    expect(() => parseExpression('(P1')).toThrow('缺少')
    expect(() => parseExpression('P1 P2')).toThrow('多出')
  })
})
