import { describe, expect, it } from 'vitest'
import {
  applyOutputPrefix,
  assetCfLoad,
  cascadeWhitelist,
  cfHost,
  cfInputDevices,
  expandConfig,
  outputInventory,
  renameTable,
  alarmMetadata,
  expandSwitchAlarms,
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

describe('buildCf · 对整个结果取绝对值(2026-09-11)', () => {
  it('absAll:整条式子包进 abs(...)', () => {
    const custom = buildCf(
      {
        template: 'expr.custom',
        device: 'A1',
        output: 'x',
        absAll: true,
        terms: [
          { kind: 'key', device: 'A1', key: 'p' },
          { kind: 'key', device: 'A2', key: 'p' },
        ],
        ops: ['+'],
      },
      'id-a1',
      ids
    )
    expect(custom.configuration.expression).toBe('abs((v0) + v1)')
    const sub = buildCf(
      {
        template: 'expr.subtract',
        device: 'A1',
        output: 'y',
        absAll: true,
        inputs: { a: { device: 'A1', key: 'p' }, b: { device: 'A1', key: 'q' } },
      },
      'id-a1',
      ids
    )
    expect(sub.configuration.expression).toBe('abs(a - b)')
  })
})

describe('跨设备即时派生 → 结果资产(2026-09-10)', () => {
  const cross = (extra: Partial<Computation> = {}): Computation => ({
    template: 'expr.add',
    asset: 'T_CALC',
    output: 'sumP',
    inputs: { a: { device: 'A1', key: 'p' }, b: { device: 'B1', key: 'p' } },
    ...extra,
  })
  const pq: Computation = {
    template: 'expr.add',
    device: 'A1',
    output: 'pq',
    inputs: { a: { device: 'A1', key: 'p' }, b: { device: 'A1', key: 'q' } },
  }

  it('cfHost / cfInputDevices:写了 asset 走资产,否则走 device;常数项不算输入', () => {
    expect(cfHost(cross())).toEqual({ entityType: 'ASSET', name: 'T_CALC' })
    expect(cfHost(pq)).toEqual({ entityType: 'DEVICE', name: 'A1' })
    expect(cfInputDevices(cross())).toEqual(['A1', 'B1'])
    expect(
      cfInputDevices({
        template: 'expr.custom',
        terms: [
          { kind: 'key', device: 'A2', key: 'p' },
          { kind: 'const', value: 2 },
          { kind: 'key', device: 'A2', key: 'q' },
        ],
        ops: ['*', '+'],
      })
    ).toEqual(['A2'])
  })

  it('宿主是资产:CF 挂在资产上,每个输入都带设备 refEntityId', () => {
    const cf = buildCf(cross(), 'id-asset', ids, 'ASSET')
    expect(cf.entityId).toEqual({ entityType: 'ASSET', id: 'id-asset' })
    expect(cf.configuration.arguments.a!.refEntityId).toEqual({ entityType: 'DEVICE', id: 'id-a1' })
    expect(cf.configuration.arguments.b!.refEntityId).toEqual({ entityType: 'DEVICE', id: 'id-b1' })
  })

  it('compile / outputInventory:资产宿主进 plan.cfs[].asset 与输出清单 ASSET;单设备的仍在设备上', () => {
    const p = compile(base({ outputPrefix: 'calc_', computations: [cross(), pq] }))
    expect(p.cfs.map(c => [c.asset ?? null, c.device ?? null, c.output])).toEqual([
      ['T_CALC', null, 'calc_sumP'],
      [null, 'A1', 'calc_pq'],
    ])
    expect(p.cfs[0]!.body.entityId).toEqual({ entityType: 'ASSET', id: 'asset:T_CALC' })
    expect(p.outputs.filter(o => o.kind === 'cf').map(o => `${o.entityType}|${o.entity}|${o.key}`)).toEqual([
      'ASSET|T_CALC|calc_sumP',
      'DEVICE|A1|calc_pq',
    ])
    // 资产上的输出不进级联白名单(白名单只管设备发出的消息)
    expect(p.cascadeKeys).toEqual([])
    expect(summarizePlan(p).find(l => l.startsWith('计算字段'))).toContain('资产 T_CALC.calc_sumP')
  })

  it('校验:资产宿主不查 device;不许与站点 / 设备重名;同一资产 CF 超过 5 个报错(与汇聚合并计数)', () => {
    expect(validateConfig(base({ computations: [cross()] }))).toEqual([])
    expect(validateConfig(base({ computations: [cross({ asset: 'T' })] }))).toEqual([
      '运算 #1 (expr.add): 结果资产名不能与站点同名',
    ])
    expect(validateConfig(base({ computations: [cross({ asset: 'A1' })] }))).toEqual([
      '运算 #1 (expr.add): 结果资产名与设备 A1 重名',
    ])
    const six = Array.from({ length: 6 }, (_, i) => cross({ output: `o${i}` }))
    expect(validateConfig(base({ computations: six }))).toEqual([
      '资产 T_CALC 上要建 6 个计算字段,超过 TB 单实体上限 5:请给其中几条运算换一个结果资产名',
    ])
    const withAgg = base({
      computations: [
        cross(),
        {
          template: 'aggregate.crossEntity',
          selector: { profiles: ['PCS'] },
          key: 'p',
          agg: 'sum',
          asset: 'T_CALC',
          output: 'tot',
        },
      ],
    })
    expect(assetCfLoad(withAgg)).toEqual({ T_CALC: 2 })
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

  it('5m / 1h 用 generator 定时;日级由 1h 驱动 + 跨自然日判定,不用 generator', () => {
    const meta = rollupMetadata('c', {}, ids, [
      { template: 'window.cascade', device: 'A1', keys: ['p'], aggs: ['max'] },
    ])
    const name = (n: { name: string }) => n.name
    const gens = meta.nodes.filter(n => n.type.endsWith('TbMsgGeneratorNode')).map(name)
    // 关键:日级没有 generator。它的首拍在节点启动后满一个周期,链一重发布就清零,
    // 日点永远出不来(2026-09-09 采样查实)
    expect(gens).toEqual(['tick 级联 A1 @5m', 'tick 级联 A1 @1h'])
    expect(gens.some(n => n.endsWith('@1d'))).toBe(false)

    const idx = (n: string) => meta.nodes.findIndex(x => x.name === n)
    const edge = (from: string, to: string, type = 'Success') =>
      meta.connections.some(c => c.fromIndex === idx(from) && c.toIndex === idx(to) && c.type === type)
    // 1h 汇算 → 取属性 → 跨日? →(True)日界 → 取数 → 汇算 → 保存
    expect(edge('级联汇算 A1 @1h', '取上次日归档 A1 @1d')).toBe(true)
    expect(edge('取上次日归档 A1 @1d', '跨自然日? A1 @1d')).toBe(true)
    expect(edge('跨自然日? A1 @1d', '日界 A1 @1d', 'True')).toBe(true)
    expect(edge('日界 A1 @1d', 'fetch 级联 A1 @1d')).toBe(true)
    expect(edge('级联汇算 A1 @1d', 'save ttl=∞')).toBe(true)
    // 日序号写回设备属性,重发布 / 漏拍都不会重复算
    expect(edge('日界 A1 @1d', '记日序号 A1 @1d')).toBe(true)
    expect(edge('记日序号 A1 @1d', '存日序号 A1 @1d')).toBe(true)

    const ga = meta.nodes[idx('取上次日归档 A1 @1d')]!
    expect(ga.configuration.serverAttributeNames).toEqual(['pMax1d__day'])
    expect(ga.configuration.tellFailureIfAbsent).toBe(false) // 第一次跑属性还不存在
    expect(meta.nodes[idx('跨自然日? A1 @1d')]!.configuration.jsScript).toContain('metadata.ss_pMax1d__day')

    // 日级按自然日取数(东八区),不再是「最近 86400 秒」
    const f = meta.nodes[idx('fetch 级联 A1 @1d')]!
    expect(f.configuration.useMetadataIntervalPatterns).toBe(true)
    expect(f.configuration.startIntervalPattern).toBe('${dayStartTs}')
    expect(f.configuration.endIntervalPattern).toBe('${dayEndTs}')
    // 5m / 1h 仍按「最近一个周期」取
    expect(meta.nodes[idx('fetch 级联 A1 @1h')]!.configuration.useMetadataIntervalPatterns).toBe(false)

    // 算的是「上一个自然日」,点戳在那一天的 0 点上,不是触发时刻
    const mark = meta.nodes[idx('日界 A1 @1d')]!.configuration.jsScript as string
    expect(mark).toContain('var TZ = 8 * 3600000')
    expect(mark).toContain('prevStart = dayStart - 86400000')
    expect(mark).toContain('metadata.ts = String(prevStart)')
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
    expect(edge.nodes.find(n => n.name === '取上次状态')!.configuration.serverAttributeNames).toEqual([
      expect.stringMatching(/^almState_p_gt_10_[0-9a-f]{6}$/),
    ])
  })

  // 2026-09-11:状态属性原来只按 测点 + 比较符 取名,同一台设备上的两条边沿告警会读写同一个属性、互相干扰
  const edgeRule = (name: string, op: 'gt' | 'eq' | 'ne' | 'lt', value: number, key = 'P'): Computation => ({
    template: 'alarm.threshold',
    device: 'A1',
    key,
    name,
    condition: { op, value },
    severity: 'MAJOR',
    trigger: 'edge',
  })
  const stateAttrs = (alarms: Computation[]) =>
    alarmMetadata('c', alarms)
      .nodes.filter(n => n.name === '取上次状态')
      .map(n => (n.configuration.serverAttributeNames as string[])[0]!)

  it('同一台设备 P>100、P>200 两条边沿告警:状态属性各一份,判定变化读的、写状态写的都是自己那份', () => {
    const rules = [edgeRule('功率偏高', 'gt', 100), edgeRule('功率过高', 'gt', 200)]
    const meta = alarmMetadata('c', rules)
    const [s1, s2] = stateAttrs(rules)
    expect(s1).toMatch(/^almState_P_gt_100_[0-9a-f]{6}$/)
    expect(s2).toMatch(/^almState_P_gt_200_[0-9a-f]{6}$/)
    const js = (name: string) => meta.nodes.find(n => n.name === name)!.configuration.jsScript as string
    expect(js('判定变化 功率偏高')).toContain(`!== metadata.ss_${s1});`)
    expect(js('写状态 功率偏高')).toContain(`m['${s1}'] =`)
    expect(js('判定变化 功率过高')).toContain(`!== metadata.ss_${s2});`)
    expect(js('写状态 功率过高')).toContain(`m['${s2}'] =`)
  })

  it('开关变位展开的两个方向(同测点 == 合闸值 / != 合闸值):状态属性各一份', () => {
    const [close, open] = stateAttrs([edgeRule('开关变位(由分到合)', 'eq', 1), edgeRule('开关变位(由合到分)', 'ne', 1)])
    expect(close).toMatch(/^almState_P_eq_1_[0-9a-f]{6}$/)
    expect(open).toMatch(/^almState_P_ne_1_[0-9a-f]{6}$/)
  })

  it('状态属性名:阈值相同、告警类型不同也分开;测点 / 比较符 / 阈值 / 类型全同才共用;始终是合法属性名', () => {
    const [a, b, c] = stateAttrs([edgeRule('甲', 'gt', 100), edgeRule('乙', 'gt', 100), edgeRule('甲', 'gt', 100)])
    expect(a).not.toBe(b)
    expect(c).toBe(a)
    const [odd] = stateAttrs([edgeRule('温度 过低', 'lt', -0.5, 'T.amb-1')])
    expect(odd).toMatch(/^almState_T_amb_1_lt__0_5_[0-9a-f]{6}$/)
  })
})

describe('开关变位告警 alarm.switch(2026-09-11)', () => {
  const sw: Computation = {
    template: 'alarm.switch',
    device: 'A1',
    key: 'p',
    name: '开关变位',
    directions: ['close', 'open'],
    closedValue: 1,
    severity: 'MINOR',
  }
  it('两个方向都选:展开成两条「变化才报」告警——由分到合 == 合闸值、由合到分 != 合闸值', () => {
    const out = expandSwitchAlarms([sw])
    expect(out.map(c => [c.template, c.name, c.condition, c.trigger])).toEqual([
      ['alarm.threshold', '开关变位(由分到合)', { op: 'eq', value: 1 }, 'edge'],
      ['alarm.threshold', '开关变位(由合到分)', { op: 'ne', value: 1 }, 'edge'],
    ])
    expect(out[0]!.message).toBe('开关变位:由分到合(当前值 {value})')
    expect(out[0]).not.toHaveProperty('directions')
    // 只选一种;合闸值缺省为 1;别的运算原样
    expect(expandSwitchAlarms([{ ...sw, directions: ['open'], closedValue: undefined }]).map(c => c.condition)).toEqual(
      [{ op: 'ne', value: 1 }]
    )
    expect(expandSwitchAlarms([{ template: 'expr.add', device: 'A1', output: 'x' }])).toHaveLength(1)
  })
  it('规则链:两个方向的「上次状态」属性各一份,互不覆盖;校验方向与合闸值', () => {
    const plan = compile(base({ computations: [sw] }))
    expect(plan.alarm!.items.map(a => a.name)).toEqual(['开关变位(由分到合)', '开关变位(由合到分)'])
    const states = plan
      .alarm!.metadata.nodes.filter(n => n.name === '取上次状态')
      .map(n => (n.configuration.serverAttributeNames as string[])[0])
    expect(states.map(s => s?.replace(/_[0-9a-f]{6}$/, ''))).toEqual(['almState_p_eq_1', 'almState_p_ne_1'])
    expect(validateConfig(base({ computations: [{ ...sw, directions: [] }] }))).toContain(
      '运算 #1 (alarm.switch): 报警方向至少选一个(由分到合 / 由合到分)'
    )
    expect(validateConfig(base({ computations: [{ ...sw, closedValue: '1' as unknown as number }] }))).toContain(
      '运算 #1 (alarm.switch): 合闸值必须是数字'
    )
  })
  it('设备模板里的开关变位告警:跨设备合并成一条规则,再按方向展开', () => {
    const { computations } = expandConfig(
      base({
        deviceTemplates: [
          {
            name: 'PCS 开关',
            selector: { profiles: ['PCS'] },
            items: [{ template: 'alarm.switch', key: 'p', name: '开关变位', directions: ['close'], severity: 'MINOR' }],
          },
        ],
      })
    )
    expect(computations.map(c => [c.name, c.devices, c.condition])).toEqual([
      ['开关变位(由分到合)', ['A1', 'A2'], { op: 'eq', value: 1 }],
    ])
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

describe('ADR-003 输出前缀', () => {
  const cfg = (outputPrefix?: string): TbsiteConfig =>
    base({
      ...(outputPrefix !== undefined ? { outputPrefix } : {}),
      deviceTemplates: [
        {
          name: 'T',
          selector: { profiles: ['PCS'] },
          items: [{ template: 'expr.add', output: 'pq', inputs: { a: { key: 'p' }, b: { key: 'q' } } }] as never,
        },
      ],
      computations: [
        { template: 'window.cascade', device: 'A1', keys: ['p'], aggs: ['max'] },
        { template: 'window.aggregate', device: 'A1', window: '5m', keys: ['pq'], aggs: ['avg'] },
        {
          template: 'aggregate.crossEntity',
          name: 'Σ',
          selector: { profiles: ['PCS'] },
          key: 'p',
          agg: 'sum',
          asset: 'AGG',
          output: 'tot',
        },
        {
          template: 'expr.custom',
          device: 'A1',
          output: 'absPq',
          terms: [
            { kind: 'key', device: 'A1', key: 'pq', abs: true },
            { kind: 'const', value: 0 },
          ],
          ops: ['+'],
        },
      ],
    })

  it('没有 outputPrefix:名字原样(旧站点不改名,parity 不受影响)', () => {
    const { computations, prefix } = expandConfig(cfg())
    expect(prefix).toBe('')
    expect(computations.map(c => c.output).filter(Boolean)).toEqual(['pq', 'tot', 'absPq'])
    expect(compile(cfg()).cascadeKeys).toEqual([])
    expect(compile(cfg()).siteAsset.attributes.calcCascadeKeys).toBeUndefined()
  })

  it('有前缀:显式输出与对它的引用同步改名;派生名带前缀;幂等', () => {
    const { computations } = expandConfig(cfg('calc_'))
    const byOut = Object.fromEntries(computations.filter(c => c.output).map(c => [c.output, c]))
    expect(Object.keys(byOut).sort()).toEqual(['calc_absPq', 'calc_pq', 'calc_tot'])
    expect(byOut.calc_absPq!.terms![0]).toMatchObject({ kind: 'key', key: 'calc_pq' })
    expect(computations.find(c => c.template === 'window.aggregate')!.keys).toEqual(['calc_pq'])
    // 引用原始测点的不改
    expect(byOut.calc_pq!.inputs!.a!.key).toBe('p')
    expect(applyOutputPrefix(computations, 'calc_')).toEqual(computations)
  })

  it('outputInventory / cascadeWhitelist / 计划各段', () => {
    const plan = compile(cfg('calc_'))
    const keys = (et: string) =>
      plan.outputs
        .filter(o => o.entityType === et)
        .map(o => `${o.entity}.${o.key}`)
        .sort()
    expect(keys('DEVICE')).toEqual([
      'A1.calc_absPq',
      'A1.calc_pMax1d',
      'A1.calc_pMax1h',
      'A1.calc_pMax5m',
      'A1.calc_pq',
      'A1.calc_pqAvg5m',
    ])
    expect(keys('ASSET')).toEqual(['AGG.calc_tot'])
    // 白名单 = 设备输出里被再次当输入的:pq(被 absPq 与窗口聚合引用)、级联 5m/1h(下一级读)
    expect(plan.cascadeKeys).toEqual(['calc_pMax1h', 'calc_pMax5m', 'calc_pq'])
    expect(plan.siteAsset.attributes.calcCascadeKeys).toEqual(plan.cascadeKeys)
    const agg5 = plan.rollup!.metadata.nodes.find(n => n.name === 'aggregate A1 @5m')!
    expect(agg5.configuration.jsScript).toContain('"pfx":"calc_"')
    expect(agg5.configuration.jsScript).toContain("out[(spec.pfx || '') + k + suffix]")
    expect(plan.rollup!.metadata.nodes.find(n => n.name === 'fetch A1 @5m')!.configuration.latestTsKeyNames).toEqual([
      'calc_pq',
    ])
    expect(summarizePlan(plan)[1]).toContain('输出前缀 calc_')
    expect(cascadeWhitelist(cfg(), expandConfig(cfg()).computations, '')).toEqual([])
    expect(outputInventory(cfg(), expandConfig(cfg()).computations, '').map(o => o.key)).toContain('pMax5m')
  })

  it('迁移表:旧配置无前缀、新配置带前缀 → 同实体同名 key 成对列出;只生成不执行', () => {
    const prev = expandConfig(cfg())
    const next = expandConfig(cfg('calc_'))
    const rows = renameTable(
      { cfg: cfg(), computations: prev.computations },
      { cfg: cfg('calc_'), computations: next.computations },
      '2026-09-06'
    )
    expect(rows.map(r => `${r.entityType}:${r.entity}:${r.old}→${r.new}`).sort()).toEqual([
      'ASSET:AGG:tot→calc_tot',
      'DEVICE:A1:absPq→calc_absPq',
      'DEVICE:A1:pMax1d→calc_pMax1d',
      'DEVICE:A1:pMax1h→calc_pMax1h',
      'DEVICE:A1:pMax5m→calc_pMax5m',
      'DEVICE:A1:pqAvg5m→calc_pqAvg5m',
      'DEVICE:A1:pq→calc_pq',
    ])
    expect(rows[0]!.since).toBe('2026-09-06')
    expect(
      renameTable({ cfg: cfg(), computations: prev.computations }, { cfg: cfg(), computations: prev.computations })
    ).toEqual([])
  })

  it('alarm.propagate:建告警节点沿 Contains 传播;默认不传播(parity 不变)', () => {
    const a: Computation = {
      template: 'alarm.threshold',
      device: 'A1',
      key: 'p',
      name: 'x',
      condition: { op: 'gt', value: 1 },
      severity: 'MINOR',
      message: 'm',
    }
    const off = alarmMetadata('c', [a]).nodes.find(n => n.name === '告警: x')!
    expect(off.configuration.propagate).toBe(false)
    expect(off.configuration.relationTypes).toBeUndefined()
    const on = compile(base({ alarm: { propagate: true }, computations: [a] })).alarm!.metadata.nodes.find(
      n => n.name === '告警: x'
    )!
    expect(on.configuration).toMatchObject({ propagate: true, relationTypes: ['Contains'] })
    // TB 4.3.1 的 TbCreateAlarmNodeConfiguration 没有 propagateRelationTypes 字段,写了会让节点启动失败(2026-09-08 镜像实测)
    expect(on.configuration).not.toHaveProperty('propagateRelationTypes')
  })

  it('校验:前缀必须是字母开头的标识', () => {
    expect(validateConfig(cfg('1x'))).toContain("outputPrefix 须为字母开头的英文标识(如 'calc_')")
    expect(validateConfig(cfg('calc-'))).toHaveLength(1)
    expect(validateConfig(cfg('calc_'))).toEqual([])
  })
})
