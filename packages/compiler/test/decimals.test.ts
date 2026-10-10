// 2026-10-10:计算结果的小数位可按运算设(缺省 2);顺带:设备模板展开时带上「存为属性」(原来丢了)。
import { describe, expect, it } from 'vitest'
import { adoptCf, cfSignature, compile, expandConfig, validateConfig, type TbsiteConfig } from '../src/index'

const dev = (name: string, keys: string[]) => ({ name, profile: 'IED', keys: keys.map(key => ({ key })) })
const base = (extra: Partial<TbsiteConfig> = {}): TbsiteConfig => ({
  schema: 'tbsite/v2',
  site: { name: 'S' },
  outputPrefix: 'calc_',
  devices: [dev('D1', ['P', 'Q']), dev('D2', ['P', 'Q'])],
  ...extra,
})
const add = (output: string, extra: Record<string, unknown> = {}) => ({
  template: 'expr.add',
  device: 'D1',
  inputs: { a: { device: 'D1', key: 'P' }, b: { device: 'D1', key: 'Q' } },
  output,
  ...extra,
})
const outOf = (cfg: TbsiteConfig, output: string) =>
  compile(cfg).cfs.find(c => c.output === output)!.body.configuration.output as Record<string, unknown>

describe('小数位', () => {
  it('不设是 2 位(和原来一样);设了照设的写;全站汇聚的分组与汇总字段都用它', () => {
    const cfg = base({
      computations: [
        add('a'),
        add('b', { decimals: 4 }),
        add('c', { decimals: 0, outputMode: 'attr' }),
        {
          template: 'aggregate.crossEntity',
          name: '全站',
          selector: { profiles: ['IED'] },
          key: 'P',
          agg: 'sum',
          asset: 'S_AGG',
          output: 'totalMW',
          decimals: 5,
        },
      ],
    })
    expect(validateConfig(cfg)).toEqual([])
    expect(outOf(cfg, 'calc_a').decimalsByDefault).toBe(2)
    expect(outOf(cfg, 'calc_b').decimalsByDefault).toBe(4)
    expect(outOf(cfg, 'calc_c')).toMatchObject({ type: 'ATTRIBUTES', decimalsByDefault: 0 })
    const agg = compile(cfg).aggregates[0]!
    expect(
      agg.bodies.every(b => (b.configuration.output as { decimalsByDefault: number }).decimalsByDefault === 5)
    ).toBe(true)
  })

  it('只收 0–6 的整数', () => {
    for (const bad of [7, -1, 1.5, '3'])
      expect(validateConfig(base({ computations: [add('a', { decimals: bad })] })).join()).toContain(
        '小数位须是 0–6 的整数'
      )
    expect(
      validateConfig(
        base({
          deviceTemplates: [
            { name: 'T', selector: { profiles: ['IED'] }, items: [{ ...add('x'), device: undefined, decimals: 9 }] },
          ],
        })
      ).join()
    ).toContain('小数位须是 0–6 的整数')
  })

  it('设备模板:展开到每台设备时带上小数位与「存为属性」(原来存属性被丢、按遥测发布)', () => {
    const cfg = base({
      deviceTemplates: [
        {
          name: 'T',
          selector: { profiles: ['IED'] },
          items: [
            {
              template: 'expr.add',
              inputs: { a: { device: '', key: 'P' }, b: { device: '', key: 'Q' } },
              output: 'pq',
              outputMode: 'attr',
              decimals: 3,
            },
          ],
        },
      ],
    })
    const comps = expandConfig(cfg).computations
    expect(comps.map(c => [c.device, c.outputMode, c.decimals])).toEqual([
      ['D1', 'attr', 3],
      ['D2', 'attr', 3],
    ])
    expect(outOf(cfg, 'calc_pq')).toMatchObject({ type: 'ATTRIBUTES', scope: 'SERVER_SCOPE', decimalsByDefault: 3 })
  })

  it('指纹:缺省 2 位不进指纹(之前发布的字段指纹不变),改了才变', () => {
    const body = (dec?: number) => ({
      configuration: {
        expression: 'a + b',
        arguments: {},
        output: {
          type: 'TIME_SERIES',
          name: 'x',
          scope: null,
          ...(dec === undefined ? {} : { decimalsByDefault: dec }),
        },
      },
    })
    expect(cfSignature(body(2))).toBe(cfSignature(body()))
    expect(cfSignature(body(4))).not.toBe(cfSignature(body(2)))
  })

  it('接管:平台上设的不是 2 位就照原样接过来;是 2 位不写', () => {
    const cf = (dec: number) => ({
      name: 'x',
      type: 'SIMPLE',
      entityId: { entityType: 'DEVICE', id: 'id-d1' },
      configuration: {
        type: 'SIMPLE',
        expression: 'a + b',
        arguments: {
          a: { refEntityKey: { type: 'TS_LATEST', key: 'P' } },
          b: { refEntityKey: { type: 'TS_LATEST', key: 'Q' } },
        },
        output: { type: 'TIME_SERIES', name: 'x', decimalsByDefault: dec },
      },
    })
    const ctx = { hostType: 'DEVICE' as const, hostName: 'D1', nameOfId: () => 'D1', claimed: new Set(['D1']) }
    const r4 = adoptCf(cf(4), ctx)
    const r2 = adoptCf(cf(2), ctx)
    expect(r4.ok && r4.computation.decimals).toBe(4)
    expect(r2.ok && 'decimals' in r2.computation).toBe(false)
  })
})
