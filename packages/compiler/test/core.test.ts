import { describe, expect, it } from 'vitest'
import {
  alarmMetadata,
  buildAggCfs,
  buildCf,
  compile,
  ConfigError,
  expandTemplates,
  resolveAggMembers,
  rollupGroups,
  rollupMetadata,
  summarizePlan,
  validateConfig,
  type Computation,
  type TbsiteConfig,
} from '../src/index'

const dev = (name: string, keys: string[], profile = 'PCS') => ({ name, profile, keys: keys.map(key => ({ key })) })
const base = (extra: Partial<TbsiteConfig> = {}): TbsiteConfig => ({
  schema: 'tbsite/v2',
  site: { name: 'T' },
  devices: [dev('A1', ['p', 'q']), dev('A2', ['p']), dev('B1', ['p', 'q'], 'BMS')],
  ...extra,
})
const ids = { A1: 'id-a1', A2: 'id-a2', B1: 'id-b1' }

describe('validateConfig', () => {
  it('通过的配置返回空数组', () => {
    expect(validateConfig(base())).toEqual([])
  })
  it('抓住 schema / 未认领设备 / 空选择器 / 阈值类型', () => {
    const errs = validateConfig({
      schema: 'x',
      site: { name: '' },
      devices: [],
      deviceTemplates: [{ name: '', selector: {} }],
      computations: [
        {
          template: 'expr.add',
          device: 'nope',
          inputs: { a: { device: 'nope', key: 'p' }, b: { device: 'A1', key: 'q' } },
        },
        {
          template: 'alarm.threshold',
          device: 'A1',
          key: 'p',
          condition: { op: 'gt', value: 'x' as unknown as number },
        },
      ],
    })
    expect(errs).toEqual([
      "schema 必须为 'tbsite/v1' 或 'tbsite/v2'",
      '站点标识不能为空',
      '至少认领一台设备',
      '设备模板 #1: 缺少名称',
      '设备模板「1」: 选择器为空(需指定类型或名称前缀)',
      '运算 #1 (expr.add): 设备未认领',
      '运算 #1 (expr.add): 输入 a 引用了未认领设备',
      '运算 #1 (expr.add): 输入 b 引用了未认领设备',
      '运算 #1 (expr.add): 缺少输出名',
      '运算 #2 (alarm.threshold): 设备未认领',
      '运算 #2 (alarm.threshold): 缺少告警名称',
      '运算 #2 (alarm.threshold): 阈值必须是数字',
    ])
  })
  it('汇聚成员上限 40', () => {
    const many = Array.from({ length: 41 }, (_, i) => dev(`P${i}`, ['p']))
    const errs = validateConfig(
      base({
        devices: many,
        computations: [
          {
            template: 'aggregate.crossEntity',
            selector: { prefixes: ['P'] },
            key: 'p',
            output: 'sum_p',
            asset: 'AGG',
            agg: 'sum',
          },
        ],
      })
    )
    expect(errs).toEqual(['运算 #1 (aggregate.crossEntity): 成员 41 台超过上限 40,请按前缀拆成多个汇聚'])
  })
})

describe('expandTemplates', () => {
  it('按选择器实例化;告警跨设备合并;缺测点的设备跳过并记提示', () => {
    const cfg = base({
      deviceTemplates: [
        {
          name: 'PCS 通用',
          selector: { profiles: ['PCS'] },
          items: [
            {
              template: 'expr.add',
              output: 's',
              inputs: { a: { key: 'p' }, b: { key: 'q' } },
            } as unknown as Computation,
            {
              template: 'alarm.threshold',
              name: '过载',
              key: 'p',
              condition: { op: 'gt', value: 1 },
              severity: 'MAJOR',
              message: 'm',
            },
            { template: 'window.aggregate', keys: ['p'], aggs: ['avg'], window: '5m' },
          ],
        },
        { name: '空', selector: { prefixes: ['Z'] }, items: [] },
      ],
    })
    const { computations, notes } = expandTemplates(cfg)
    expect(computations.map(c => `${c.template}@${c.device}`)).toEqual([
      'expr.add@A1',
      'alarm.threshold@A1',
      'window.aggregate@A1',
      'window.aggregate@A2',
    ])
    expect(computations[0]!.inputs).toEqual({ a: { device: 'A1', key: 'p' }, b: { device: 'A1', key: 'q' } })
    expect(computations[1]!.devices).toEqual(['A1', 'A2'])
    expect(notes).toEqual(['模板「PCS 通用」·「s」:1 台设备缺少所需测点,已跳过', '模板「空」没有匹配到任何已认领设备'])
  })
})

describe('buildCf', () => {
  it('宿主自身测点不带 refEntityId;expr.custom 从左到右加括号;attr 输出', () => {
    const add = buildCf(
      {
        template: 'expr.add',
        device: 'A1',
        output: 's',
        inputs: { a: { device: 'A1', key: 'p' }, b: { device: 'B1', key: 'q' } },
      },
      'id-a1',
      ids
    )
    expect(add.configuration.expression).toBe('a + b')
    expect(add.configuration.arguments.a).toEqual({ refEntityKey: { type: 'TS_LATEST', key: 'p' } })
    expect(add.configuration.arguments.b!.refEntityId).toEqual({ entityType: 'DEVICE', id: 'id-b1' })
    const custom = buildCf(
      {
        template: 'expr.custom',
        device: 'A1',
        output: 'x',
        outputMode: 'attr',
        terms: [
          { kind: 'key', device: 'A1', key: 'p', abs: true },
          { kind: 'const', value: 2 },
          { kind: 'key', device: 'A1', key: 'q' },
        ],
        ops: ['*', '-'],
      },
      'id-a1',
      ids
    )
    expect(custom.configuration.expression).toBe('((abs(v0)) * 2) - v1')
    expect(custom.configuration.output).toEqual({
      type: 'ATTRIBUTES',
      name: 'x',
      scope: 'SERVER_SCOPE',
      decimalsByDefault: 2,
    })
    expect(() => buildCf({ template: 'expr.nope', device: 'A1', output: 'x' }, 'id-a1', ids)).toThrow(
      '未知即时派生模板'
    )
  })
})

describe('buildAggCfs', () => {
  const agg = (n: number, kind: 'sum' | 'avg' = 'sum') => {
    const members = Array.from({ length: n }, (_, i) => dev(`P${i}`, ['p']))
    const devIds = Object.fromEntries(members.map(m => [m.name, `id-${m.name}`]))
    return buildAggCfs(
      { template: 'aggregate.crossEntity', key: 'p', output: 'tot', asset: 'AGG', agg: kind },
      members,
      devIds
    )
  }
  it('≤10 台单 CF;avg 除以台数', () => {
    const [cf] = agg(3, 'avg')
    expect(cf!.name).toBe('tot')
    expect(cf!.configuration.expression).toBe('(v0 + v1 + v2) / 3')
    expect(cf!.configuration.arguments.v0!.defaultValue).toBe('0')
  })
  it('>10 台分层:分组求和 + 引用自身分组键的汇总', () => {
    const cfs = agg(23)
    expect(cfs.map(c => c.name)).toEqual(['tot__p0', 'tot__p1', 'tot__p2', 'tot'])
    expect(cfs[3]!.configuration.expression).toBe('p0 + p1 + p2')
    expect(cfs[3]!.configuration.arguments.p0).toEqual({
      refEntityKey: { type: 'TS_LATEST', key: 'tot__p0' },
      defaultValue: '0',
    })
  })
  it('resolveAggMembers 只取匹配选择器且具备测点的设备', () => {
    const cfg = base()
    const c: Computation = {
      template: 'aggregate.crossEntity',
      selector: { profiles: ['PCS'] },
      key: 'q',
      output: 'o',
      asset: 'AGG',
      agg: 'sum',
    }
    expect(resolveAggMembers(cfg, c).map(d => d.name)).toEqual(['A1'])
  })
})

describe('rollup', () => {
  it('同设备同窗口合并流水线;sum 后缀与取数键齐全', () => {
    const groups = rollupGroups([
      { template: 'window.aggregate', device: 'A1', window: '5m', keys: ['p'], aggs: ['avg', 'sum'] },
      { template: 'window.aggregate', device: 'A1', window: '5m', keys: ['q'], aggs: ['avg'] },
      { template: 'window.delta', device: 'A1', window: '5m', key: 'e', output: 'e_d' },
      { template: 'window.integrate', device: 'A1', window: '1h', key: 'p', output: 'kwh' },
    ])
    expect(Object.keys(groups)).toEqual(['A1@@5m', 'A1@@1h'])
    expect(groups['A1@@5m']).toEqual({
      avg: ['p', 'q'],
      min: [],
      max: [],
      sum: ['p'],
      delta: { e: 'e_d' },
      integrate: {},
    })
    const meta = rollupMetadata('c', groups, ids)
    const agg5 = meta.nodes.find(n => n.name === 'aggregate A1 @5m')!
    expect(agg5.configuration.jsScript).toContain('"sfx":{"avg":"Avg5m","min":"Min5m","max":"Max5m","sum":"Sum5m"}')
    expect(meta.nodes.find(n => n.name === 'fetch A1 @5m')!.configuration.latestTsKeyNames).toEqual(['e', 'p', 'q'])
    expect(meta.nodes[0]!.name).toBe('save rollups')
  })
  it('级联三级各自保存节点,上一级输出是下一级输入', () => {
    const meta = rollupMetadata('c', {}, ids, [
      { template: 'window.cascade', device: 'A1', keys: ['p'], aggs: ['max'] },
    ])
    expect(meta.nodes.filter(n => n.name.startsWith('save ttl=')).map(n => n.name)).toEqual([
      'save ttl=7d',
      'save ttl=90d',
      'save ttl=∞',
    ])
    const lv2 = meta.nodes.find(n => n.name === '级联汇算 A1 @1h')!
    expect(lv2.configuration.jsScript).toContain('{"src":"pMax5m","out":"pMax1h","fn":"max"}')
  })
})

describe('alarmMetadata', () => {
  it('水平触发 4 条连线;边沿触发带状态属性;多设备合并的相关性过滤', () => {
    const a: Computation = {
      template: 'alarm.threshold',
      device: 'A1',
      devices: ['A1', 'A2'],
      key: 'p',
      name: '过载',
      condition: { op: 'gt', value: 10 },
      severity: 'MAJOR',
      message: "p={value} it's",
    }
    const level = alarmMetadata('c', [a])
    expect(level.connections).toHaveLength(4)
    expect(level.firstNodeIndex).toBe(0)
    expect(level.nodes[1]!.configuration.jsScript).toBe(
      `return ["A1","A2"].indexOf(metadata.deviceName) >= 0 && typeof msg['p'] !== 'undefined';`
    )
    expect(level.nodes[3]!.configuration.alarmDetailsBuildJs).toContain(`details.message = 'p=' + msg['p'] + ' it\\'s'`)
    const edge = alarmMetadata('c', [{ ...a, trigger: 'edge' }])
    expect(edge.connections).toHaveLength(12)
    expect(edge.nodes.find(n => n.name === '取上次状态')!.configuration.serverAttributeNames).toEqual(['almState_p_gt'])
  })
})

describe('compile', () => {
  it('校验失败抛 ConfigError;通过时给出各段与摘要', () => {
    expect(() => compile(base({ devices: [] }))).toThrow(ConfigError)
    const plan = compile(
      base({
        computations: [
          {
            template: 'expr.add',
            device: 'A1',
            output: 's',
            inputs: { a: { device: 'A1', key: 'p' }, b: { device: 'A1', key: 'q' } },
          },
          {
            template: 'alarm.threshold',
            device: 'A1',
            key: 'p',
            name: 'x',
            condition: { op: 'gt', value: 1 },
            severity: 'MINOR',
            message: 'm',
          },
        ],
      })
    )
    expect(plan.cfs.map(c => c.body.entityId!.id)).toEqual(['dev:A1'])
    expect(plan.rollup).toBeNull()
    expect(plan.revenue).toBeNull()
    expect(plan.alarm!.chainName).toBe('Site Alarms · T')
    expect(plan.alarm!.metadata.ruleChainId.id).toBe('chain:Site Alarms · T')
    expect(plan.siteAsset.attributes.siteConfig.computations).toHaveLength(2)
    expect(summarizePlan(plan)[1]).toBe('计算字段 1 个:A1.s')
    expect(compile(base({ devices: [] }), undefined, { throwOnError: false }).validation.errors).toEqual([
      '至少认领一台设备',
    ])
  })
})
