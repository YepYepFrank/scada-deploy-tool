// 跨设备汇聚:aggregate.crossEntity → 独立虚拟资产(tbsite-agg)上的 SIMPLE CF
// ≤10 台单个 CF;多则「每 10 台一个分组求和 CF + 一个汇总 CF」(租户档案 maxArgumentsPerCF = 10)
import type { CalculatedField, CfArgument, Computation, DeviceDecl, TbsiteConfig } from '../types'
import { MAX_CF_ARGS } from './constants'
import { matchSelector } from './templates'

export function resolveAggMembers(cfg: TbsiteConfig, c: Computation): DeviceDecl[] {
  return (cfg.devices || []).filter(
    d => matchSelector(d, c.selector || {}) && (d.keys || []).some(x => x.key === c.key)
  )
}

/** 返回该汇聚需要建在目标资产上的 CF 清单(1 个,或 分组 N + 汇总 1;汇总在最后) */
export function buildAggCfs(c: Computation, members: DeviceDecl[], devIds: Record<string, string>): CalculatedField[] {
  const key = c.key as string
  const output = c.output as string
  const ref = (dev: string): CfArgument => ({
    refEntityId: { entityType: 'DEVICE', id: devIds[dev] as string },
    refEntityKey: { type: 'TS_LATEST', key },
    defaultValue: '0',
  })
  const selfRef = (k: string): CfArgument => ({ refEntityKey: { type: 'TS_LATEST', key: k }, defaultValue: '0' })
  const mk = (name: string, args: Record<string, CfArgument>, expression: string): CalculatedField => ({
    type: 'SIMPLE',
    name,
    configurationVersion: 1,
    configuration: {
      type: 'SIMPLE',
      arguments: args,
      expression,
      output: {
        type: 'TIME_SERIES',
        name,
        scope: null,
        decimalsByDefault: 2,
        // processCfs:输出继续触发下游 CF(分层汇总依赖此级联,与生产配置一致)
        strategy: {
          type: 'IMMEDIATE',
          ttl: 0,
          saveTimeSeries: true,
          saveLatest: true,
          sendWsUpdate: true,
          processCfs: true,
        },
      },
    },
  })
  const sumExpr = (names: string[]) => names.join(' + ')
  const finalExpr = (body: string, n: number) => (c.agg === 'avg' ? `(${body}) / ${n}` : body)
  const n = members.length
  if (n <= MAX_CF_ARGS) {
    const args: Record<string, CfArgument> = {}
    members.forEach((d, i) => (args[`v${i}`] = ref(d.name)))
    return [mk(output, args, finalExpr(sumExpr(Object.keys(args)), n))]
  }
  const out: CalculatedField[] = []
  const partKeys: string[] = []
  for (let i = 0; i < n; i += MAX_CF_ARGS) {
    const chunk = members.slice(i, i + MAX_CF_ARGS)
    const pkey = `${output}__p${out.length}`
    const args: Record<string, CfArgument> = {}
    chunk.forEach((d, j) => (args[`v${j}`] = ref(d.name)))
    out.push(mk(pkey, args, sumExpr(Object.keys(args))))
    partKeys.push(pkey)
  }
  const fargs: Record<string, CfArgument> = {}
  partKeys.forEach((k, i) => (fargs[`p${i}`] = selfRef(k)))
  out.push(mk(output, fargs, finalExpr(sumExpr(Object.keys(fargs)), n)))
  return out
}
