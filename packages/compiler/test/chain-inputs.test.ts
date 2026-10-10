// 2026-10-10:即时计算拿设备属性、拿别的运算的结果当输入;模板里的运算也能接力。
import { describe, expect, it } from 'vitest'
import { compile, expandConfig, validateConfig, type TbsiteConfig } from '../src/index'

const dev = (name: string, keys: string[], profile = 'IED') => ({ name, profile, keys: keys.map(key => ({ key })) })
const base = (extra: Partial<TbsiteConfig> = {}): TbsiteConfig => ({
  schema: 'tbsite/v2',
  site: { name: 'S' },
  outputPrefix: 'calc_',
  devices: [dev('D1', ['P', 'Q']), dev('D2', ['P']), dev('D3', ['Q'])],
  ...extra,
})
const cfOf = (cfg: TbsiteConfig, output: string) => compile(cfg).cfs.find(c => c.output === output)!.body

describe('属性当输入', () => {
  it('同一台设备的属性:ATTRIBUTE 参数带范围,不写 refEntityId;别的设备的属性写上设备', () => {
    const cfg = base({
      computations: [
        {
          template: 'expr.custom',
          device: 'D1',
          terms: [
            { kind: 'key', device: 'D1', key: 'P' },
            { kind: 'key', device: 'D1', key: 'ratedP', attr: 'SERVER_SCOPE' },
            { kind: 'const', value: 100 },
          ],
          ops: ['/', '*'],
          output: 'loadRate',
        },
        {
          template: 'expr.subtract',
          asset: 'S_CALC',
          inputs: { a: { device: 'D1', key: 'P' }, b: { device: 'D2', key: 'limit', attr: 'SHARED_SCOPE' } },
          output: 'margin',
        },
      ],
    })
    expect(validateConfig(cfg)).toEqual([])
    const rate = cfOf(cfg, 'calc_loadRate')
    expect(rate.configuration.expression).toBe('((v0) / v1) * 100')
    expect(rate.configuration.arguments).toEqual({
      v0: { refEntityKey: { type: 'TS_LATEST', key: 'P' } },
      v1: { refEntityKey: { type: 'ATTRIBUTE', key: 'ratedP', scope: 'SERVER_SCOPE' } },
    })
    const margin = cfOf(cfg, 'calc_margin')
    expect(margin.configuration.arguments.b).toEqual({
      refEntityId: { entityType: 'DEVICE', id: 'dev:D2' },
      refEntityKey: { type: 'ATTRIBUTE', key: 'limit', scope: 'SHARED_SCOPE' },
    })
  })

  it('属性同名于某个运算输出也不改名;范围写错报出来', () => {
    const cfg = base({
      computations: [
        {
          template: 'expr.add',
          device: 'D1',
          inputs: { a: { device: 'D1', key: 'P' }, b: { device: 'D1', key: 'Q' } },
          output: 'cap',
        },
        {
          template: 'expr.add',
          device: 'D1',
          inputs: { a: { device: 'D1', key: 'P' }, b: { device: 'D1', key: 'cap', attr: 'SERVER_SCOPE' } },
          output: 'x',
        },
      ],
    })
    expect(expandConfig(cfg).computations[1]!.inputs!.b!.key).toBe('cap')
    const bad = base({
      computations: [
        {
          template: 'expr.add',
          device: 'D1',
          inputs: { a: { device: 'D1', key: 'P' }, b: { device: 'D1', key: 'cap', attr: 'GLOBAL' as never } },
          output: 'x',
        },
      ],
    })
    expect(validateConfig(bad).join()).toContain('范围「GLOBAL」不对')
  })

  it('设备模板:属性输入照抄到每台设备,不要求设备有同名遥测', () => {
    const cfg = base({
      deviceTemplates: [
        {
          name: '负载率',
          selector: { profiles: ['IED'] },
          items: [
            {
              template: 'expr.subtract',
              inputs: { a: { device: '', key: 'P' }, b: { device: '', key: 'ratedP', attr: 'SERVER_SCOPE' } },
              output: 'headroom',
            },
          ],
        },
      ],
    })
    const comps = expandConfig(cfg).computations
    // D3 没有 P,跳过;D1 / D2 有 P,虽然都没认领过 ratedP 遥测
    expect(comps.map(c => c.device)).toEqual(['D1', 'D2'])
    expect(comps[0]!.inputs!.b).toEqual({ device: 'D1', key: 'ratedP', attr: 'SERVER_SCOPE' })
  })
})

describe('别的运算的结果当输入', () => {
  it('设备上的结果接着算:写原名或带前缀的名字都对上同一个 key;下游建在同一台设备上', () => {
    for (const ref of ['pq', 'calc_pq']) {
      const cfg = base({
        computations: [
          {
            template: 'expr.add',
            device: 'D1',
            inputs: { a: { device: 'D1', key: 'P' }, b: { device: 'D1', key: 'Q' } },
            output: 'pq',
          },
          {
            template: 'expr.custom',
            device: 'D1',
            terms: [
              { kind: 'key', device: 'D1', key: ref },
              { kind: 'const', value: 2 },
            ],
            ops: ['*'],
            output: 'pq2',
          },
        ],
      })
      expect(validateConfig(cfg)).toEqual([])
      expect(cfOf(cfg, 'calc_pq2').configuration.arguments.v0).toEqual({
        refEntityKey: { type: 'TS_LATEST', key: 'calc_pq' },
      })
    }
  })

  it('资产上的结果(全站汇聚 / 跨设备即时计算)当输入:参数指向资产;只用这一个资产时建在它上面不写 refEntityId', () => {
    const cfg = base({
      computations: [
        {
          template: 'aggregate.crossEntity',
          name: '全站有功',
          selector: { profiles: ['IED'] },
          key: 'P',
          agg: 'sum',
          asset: 'S_AGG',
          output: 'totalP',
        },
        {
          template: 'expr.custom',
          asset: 'S_CALC',
          terms: [
            { kind: 'key', device: 'D1', key: 'P' },
            { kind: 'key', device: 'S_AGG', key: 'calc_totalP', entityType: 'ASSET' },
          ],
          ops: ['/'],
          output: 'share',
        },
        {
          template: 'expr.custom',
          asset: 'S_AGG',
          terms: [
            { kind: 'key', device: 'S_AGG', key: 'totalP', entityType: 'ASSET' },
            { kind: 'const', value: 1000 },
          ],
          ops: ['/'],
          output: 'totalMW',
        },
      ],
    })
    expect(validateConfig(cfg)).toEqual([])
    const plan = compile(cfg, {
      devices: { D1: 'id1', D2: 'id2', D3: 'id3' },
      assets: { S_AGG: 'agg-id', S_CALC: 'calc-id' },
    })
    const share = plan.cfs.find(c => c.output === 'calc_share')!.body
    expect(share.configuration.arguments.v1).toEqual({
      refEntityId: { entityType: 'ASSET', id: 'agg-id' },
      refEntityKey: { type: 'TS_LATEST', key: 'calc_totalP' },
    })
    const mw = plan.cfs.find(c => c.output === 'calc_totalMW')!
    expect(mw.asset).toBe('S_AGG')
    expect(mw.body.configuration.arguments.v0).toEqual({ refEntityKey: { type: 'TS_LATEST', key: 'calc_totalP' } })
    // 计划阶段不知道 id:用占位串
    expect(cfOf(cfg, 'calc_share').configuration.arguments.v1!.refEntityId).toEqual({
      entityType: 'ASSET',
      id: 'asset:S_AGG',
    })
  })

  it('引用不存在的结果资产 / 资产上没有的结果:报出来', () => {
    const term = (device: string, key: string) => ({
      template: 'expr.custom',
      device: 'D1',
      terms: [
        { kind: 'key' as const, device: 'D1', key: 'P' },
        { kind: 'key' as const, device, key, entityType: 'ASSET' as const },
      ],
      ops: ['+'],
      output: 'y',
    })
    expect(validateConfig(base({ computations: [term('NOPE', 'calc_x')] })).join()).toContain(
      '引用的资产 NOPE 不是本站点运算的结果资产'
    )
    const agg = {
      template: 'aggregate.crossEntity',
      name: 'A',
      selector: { profiles: ['IED'] },
      key: 'P',
      agg: 'sum' as const,
      asset: 'S_AGG',
      output: 'totalP',
    }
    expect(validateConfig(base({ computations: [agg, term('S_AGG', 'calc_other')] })).join()).toContain(
      '资产 S_AGG 上没有运算结果 calc_other'
    )
  })

  it('绕成环报出来(A 用 B、B 用 A;自己用自己)', () => {
    const add = (output: string, b: string) => ({
      template: 'expr.add',
      device: 'D1',
      inputs: { a: { device: 'D1', key: 'P' }, b: { device: 'D1', key: b } },
      output,
    })
    const errs = validateConfig(base({ computations: [add('a', 'calc_b'), add('b', 'calc_a')] }))
    expect(errs.join()).toContain('绕成了环')
    expect(errs.join()).toMatch(/D1 · calc_[ab] → D1 · calc_[ab] → D1 · calc_[ab]/)
    expect(validateConfig(base({ computations: [add('self', 'self')] })).join()).toContain('绕成了环')
    // 一条直线接力不算环
    expect(validateConfig(base({ computations: [add('a', 'Q'), add('b', 'calc_a'), add('c', 'calc_b')] }))).toEqual([])
  })

  it('设备模板接力:先算 pqSum,再对 pqSum 设阈值告警;没有 Q 的设备两条都不落', () => {
    const cfg = base({
      deviceTemplates: [
        {
          name: '告警',
          selector: { profiles: ['IED'] },
          items: [
            {
              template: 'alarm.threshold',
              name: '视在越限',
              key: 'calc_pqSum',
              condition: { op: 'gt', value: 50 },
              severity: 'WARNING',
            },
          ],
        },
        {
          name: '运算',
          selector: { profiles: ['IED'] },
          items: [
            {
              template: 'expr.add',
              inputs: { a: { device: '', key: 'P' }, b: { device: '', key: 'Q' } },
              output: 'pqSum',
            },
          ],
        },
      ],
    })
    const comps = expandConfig(cfg).computations
    const alarm = comps.find(c => c.template === 'alarm.threshold')!
    expect(alarm.devices).toEqual(['D1'])
    expect(alarm.key).toBe('calc_pqSum')
    expect(comps.filter(c => c.template === 'expr.add').map(c => c.device)).toEqual(['D1'])
    // 告警链入口放行这个 calc_ key(级联白名单)
    expect(compile(cfg).cascadeKeys).toContain('calc_pqSum')
  })
})

describe('全站汇聚拿运算结果当源测点', () => {
  it('各台设备上的 calc_pqSum(设备模板算出来的)求全站和:有这个结果的设备都是成员', () => {
    const cfg = base({
      deviceTemplates: [
        {
          name: '运算',
          selector: { profiles: ['IED'] },
          items: [
            {
              template: 'expr.add',
              inputs: { a: { device: '', key: 'P' }, b: { device: '', key: 'Q' } },
              output: 'pqSum',
            },
          ],
        },
      ],
      devices: [dev('D1', ['P', 'Q']), dev('D2', ['P', 'Q']), dev('D3', ['P'])],
      computations: [
        {
          template: 'aggregate.crossEntity',
          name: '全站视在',
          selector: { profiles: ['IED'] },
          key: 'calc_pqSum',
          agg: 'sum',
          asset: 'S_AGG',
          output: 'totalPq',
        },
      ],
    })
    expect(validateConfig(cfg)).toEqual([])
    const plan = compile(cfg)
    expect(plan.aggregates[0]!.members).toEqual(['D1', 'D2'])
    expect(plan.aggregates[0]!.bodies[0]!.configuration.arguments.v0!.refEntityKey).toEqual({
      type: 'TS_LATEST',
      key: 'calc_pqSum',
    })
  })
})
