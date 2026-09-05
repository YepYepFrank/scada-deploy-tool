// 即时派生:expr.* / formula.* → 设备上的 SIMPLE 计算字段
import type { CalculatedField, CfArgument, Computation, ExprTerm, KeyRef } from '../types'

export function tsArg(key: string, deviceId: string | null): CfArgument {
  const a: CfArgument = { refEntityKey: { type: 'TS_LATEST', key } }
  if (deviceId) a.refEntityId = { entityType: 'DEVICE', id: deviceId }
  return a
}

export function buildCf(comp: Computation, hostId: string, devIds: Record<string, string>): CalculatedField {
  const out = comp.output as string
  // 引用宿主设备自身的测点不写 refEntityId(TB 默认取 CF 所在实体)
  const arg = (ref: KeyRef) => tsArg(ref.key, devIds[ref.device] !== hostId ? (devIds[ref.device] as string) : null)
  let expression: string
  const args: Record<string, CfArgument> = {}
  if (comp.template === 'expr.add' || comp.template === 'expr.subtract') {
    const inputs = comp.inputs as Record<string, KeyRef>
    expression = comp.template === 'expr.add' ? 'a + b' : 'a - b'
    args.a = arg(inputs.a!)
    args.b = arg(inputs.b!)
  } else if (comp.template === 'expr.custom') {
    // 从左到右依次计算:每一步都显式加括号
    let vi = 0
    const token = (t: ExprTerm) => {
      if (t.kind === 'const') return String(t.value)
      const name = `v${vi++}`
      args[name] = arg(t)
      return t.abs ? `abs(${name})` : name
    }
    const terms = comp.terms as ExprTerm[]
    const ops = comp.ops as string[]
    expression = token(terms[0]!)
    for (let i = 1; i < terms.length; i++) expression = `(${expression}) ${ops[i - 1]} ${token(terms[i]!)}`
  } else {
    throw new Error(`未知即时派生模板: ${comp.template}`)
  }
  const toAttr = comp.outputMode === 'attr'
  return {
    entityId: { entityType: 'DEVICE', id: hostId },
    type: 'SIMPLE',
    name: out,
    configurationVersion: 1,
    configuration: {
      type: 'SIMPLE',
      arguments: args,
      expression,
      output: toAttr
        ? { type: 'ATTRIBUTES', name: out, scope: 'SERVER_SCOPE', decimalsByDefault: 2 }
        : { type: 'TIME_SERIES', name: out, scope: null, decimalsByDefault: 2 },
    },
  }
}
