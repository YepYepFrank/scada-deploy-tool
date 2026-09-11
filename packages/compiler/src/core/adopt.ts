// 接管平台上已有的计算字段(2026-09-11):把别人手配的 SIMPLE CF 翻成向导里的一条「自定义四则」运算。
//
// 向导的运算模型比 TB 窄:输入只能是【设备】的【遥测】,表达式只能「从左到右依次计算、每项可取绝对值」。
// 能翻的才给「接管」按钮,翻不了的说清原因、只读展示。翻完用随机数把原表达式和翻后的算法各算几遍,
// 对不上就不接管——宁可不接,也不能接过来之后悄悄换了算法。
//
// 接管后的运算带 adopted: true:保持原实体、原计算字段名(cfName)、原输出测点名(不加 calc_ 前缀),
// 历史曲线接得上;此后由工具写入并打归属标记,「交还」时去掉标记、不删字段。
import type { Computation, ExprTerm } from '../types'

export interface PlatformArg {
  refEntityId?: { entityType: string; id: string } | null
  refEntityKey?: { type: string; key: string; scope?: string | null }
  defaultValue?: string
}

/** TB 上的计算字段(只声明接管 / 同步用到的字段) */
export interface PlatformCf {
  id?: { id: string }
  name: string
  type?: string
  version?: number
  entityId: { entityType: string; id: string }
  configuration?: {
    type?: string
    expression?: string
    arguments?: Record<string, PlatformArg>
    output?: { type?: string; name?: string; scope?: string | null }
  }
  additionalInfo?: Record<string, unknown> | null
}

type Op = '+' | '-' | '*' | '/'
type Node =
  | { k: 'num'; v: number }
  | { k: 'id'; name: string }
  | { k: 'abs'; x: Node }
  | { k: 'neg'; x: Node }
  | { k: 'bin'; op: Op; l: Node; r: Node }

const ID_START = /[A-Za-z_一-鿿]/
const ID_PART = /[\w一-鿿]/

/** 按常规优先级解析 TB SIMPLE 表达式(只认 + − × ÷、括号、abs、数字、参数名) */
export function parseExpression(src: string): Node {
  const s = src
  let i = 0
  const ws = () => {
    while (i < s.length && /\s/.test(s[i]!)) i++
  }
  const peek = () => (ws(), s[i])
  const expect = (c: string) => {
    if (peek() !== c) throw new Error(`第 ${i + 1} 个字符处缺少「${c}」`)
    i++
  }
  const factor = (): Node => {
    const c = peek()
    if (c === undefined) throw new Error('表达式不完整')
    if (c === '-') {
      i++
      return { k: 'neg', x: factor() }
    }
    if (c === '(') {
      i++
      const e = expr()
      expect(')')
      return e
    }
    if (/[\d.]/.test(c)) {
      const m = /^(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?/.exec(s.slice(i))
      if (!m) throw new Error(`看不懂的数字(第 ${i + 1} 个字符)`)
      i += m[0].length
      return { k: 'num', v: Number(m[0]) }
    }
    if (ID_START.test(c)) {
      let j = i + 1
      while (j < s.length && ID_PART.test(s[j]!)) j++
      const name = s.slice(i, j)
      i = j
      if (peek() === '(') {
        if (name !== 'abs') throw new Error(`不支持的函数 ${name}()`)
        i++
        const x = expr()
        expect(')')
        return { k: 'abs', x }
      }
      return { k: 'id', name }
    }
    throw new Error(`看不懂的符号「${c}」`)
  }
  const term = (): Node => {
    let n = factor()
    for (let c = peek(); c === '*' || c === '/'; c = peek()) {
      i++
      n = { k: 'bin', op: c, l: n, r: factor() }
    }
    return n
  }
  const expr = (): Node => {
    let n = term()
    for (let c = peek(); c === '+' || c === '-'; c = peek()) {
      i++
      n = { k: 'bin', op: c, l: n, r: term() }
    }
    return n
  }
  const root = expr()
  if (peek() !== undefined) throw new Error(`第 ${i + 1} 个字符处多出「${s.slice(i)}」`)
  return root
}

const ids = (n: Node, out = new Set<string>()): Set<string> => {
  if (n.k === 'id') out.add(n.name)
  else if (n.k === 'abs' || n.k === 'neg') ids(n.x, out)
  else if (n.k === 'bin') {
    ids(n.l, out)
    ids(n.r, out)
  }
  return out
}
const hasBigAbs = (n: Node): boolean =>
  n.k === 'abs'
    ? n.x.k !== 'id' && n.x.k !== 'num'
    : n.k === 'neg'
      ? hasBigAbs(n.x)
      : n.k === 'bin'
        ? hasBigAbs(n.l) || hasBigAbs(n.r)
        : false

type Leaf = { kind: 'const'; value: number } | { kind: 'id'; name: string; abs: boolean }
const leafOf = (n: Node): Leaf | null => {
  if (n.k === 'num') return { kind: 'const', value: n.v }
  if (n.k === 'neg' && n.x.k === 'num') return { kind: 'const', value: -n.x.v }
  if (n.k === 'id') return { kind: 'id', name: n.name, abs: false }
  if (n.k === 'abs' && n.x.k === 'id') return { kind: 'id', name: n.x.name, abs: true }
  if (n.k === 'abs' && n.x.k === 'num') return { kind: 'const', value: Math.abs(n.x.v) }
  return null
}

/** 翻成「从左到右」链:左边整条是链、右边是单项,才等价;否则回 null */
function toChain(n: Node): { leaves: Leaf[]; ops: Op[] } | null {
  const leaf = leafOf(n)
  if (leaf) return { leaves: [leaf], ops: [] }
  if (n.k !== 'bin') return null
  const left = toChain(n.l)
  const right = leafOf(n.r)
  if (!left || !right) return null
  return { leaves: [...left.leaves, right], ops: [...left.ops, n.op] }
}

const evalNode = (n: Node, v: Record<string, number>): number => {
  switch (n.k) {
    case 'num':
      return n.v
    case 'id':
      return v[n.name]!
    case 'abs':
      return Math.abs(evalNode(n.x, v))
    case 'neg':
      return -evalNode(n.x, v)
    case 'bin': {
      const a = evalNode(n.l, v)
      const b = evalNode(n.r, v)
      return n.op === '+' ? a + b : n.op === '-' ? a - b : n.op === '*' ? a * b : a / b
    }
  }
}
const evalChain = (c: { leaves: Leaf[]; ops: Op[] }, v: Record<string, number>): number => {
  const val = (l: Leaf) => (l.kind === 'const' ? l.value : l.abs ? Math.abs(v[l.name]!) : v[l.name]!)
  let acc = val(c.leaves[0]!)
  c.ops.forEach((op, i) => {
    const b = val(c.leaves[i + 1]!)
    acc = op === '+' ? acc + b : op === '-' ? acc - b : op === '*' ? acc * b : acc / b
  })
  return acc
}

export type AdoptResult =
  { ok: true; computation: Computation; notes: string[] } | { ok: false; reason: string; needDevices?: string[] }

export interface AdoptContext {
  hostType: 'DEVICE' | 'ASSET'
  hostName: string
  /** TB 实体 id → 名字(设备 / 资产) */
  nameOfId: (id: string) => string | undefined
  /** 本站点已认领的设备名 */
  claimed: Set<string>
}

/** 能不能接管这条计算字段;能的话给出等价的向导运算 */
export function adoptCf(cf: PlatformCf, ctx: AdoptContext): AdoptResult {
  const conf = cf.configuration ?? {}
  if ((cf.type ?? conf.type) !== 'SIMPLE')
    return { ok: false, reason: `类型是 ${cf.type ?? conf.type},向导只认 SIMPLE` }
  const out = conf.output ?? {}
  const outName = out.name
  if (!outName) return { ok: false, reason: '没有输出测点名' }
  let outputMode: 'ts' | 'attr'
  if (out.type === 'TIME_SERIES') outputMode = 'ts'
  else if (out.type === 'ATTRIBUTES' && out.scope === 'SERVER_SCOPE') outputMode = 'attr'
  else
    return { ok: false, reason: `结果存成了 ${out.type}${out.scope ? '/' + out.scope : ''},向导只支持遥测或服务端属性` }

  let tree: Node
  try {
    tree = parseExpression(conf.expression ?? '')
  } catch (e) {
    return { ok: false, reason: `看不懂的表达式:${e instanceof Error ? e.message : String(e)}` }
  }
  const used = ids(tree)
  if (!used.size) return { ok: false, reason: '纯常数,没有引用任何测点(向导的运算至少要有一个测点)' }
  // 整个式子被 abs 包住:剥掉最外层,里面按链翻,整体取绝对值(向导的「对整个结果取绝对值」,2026-09-11)
  const absAll = tree.k === 'abs' && !leafOf(tree)
  const body = absAll && tree.k === 'abs' ? tree.x : tree
  if (hasBigAbs(body))
    return { ok: false, reason: 'abs 只包住了式子的一部分(如 abs(a×b)÷c),向导只能对单个测点或整个式子取绝对值' }
  const chain = toChain(body)
  if (!chain) return { ok: false, reason: '含运算优先级(如 a + b × c),和向导「从左到右依次计算」不等价' }

  // 参数:只接受「设备的遥测」
  const args = conf.arguments ?? {}
  const refOf: Record<string, { device: string; key: string }> = {}
  const needDevices: string[] = []
  for (const name of used) {
    const a = args[name]
    if (!a?.refEntityKey?.key) return { ok: false, reason: `表达式里的 ${name} 没有对应的参数` }
    const kind = a.refEntityKey.type
    if (kind !== 'TS_LATEST')
      return { ok: false, reason: `参数 ${name} 取的是${kind === 'ATTRIBUTE' ? '属性' : kind},向导只支持设备遥测` }
    let device: string | undefined
    if (!a.refEntityId) {
      if (ctx.hostType !== 'DEVICE')
        return { ok: false, reason: `参数 ${name} 取的是资产自身的测点,向导只支持设备测点` }
      device = ctx.hostName
    } else if (a.refEntityId.entityType !== 'DEVICE') {
      const who = ctx.nameOfId(a.refEntityId.id) ?? a.refEntityId.id
      return { ok: false, reason: `参数 ${name} 引用的是资产 ${who} 的测点,向导只支持设备测点` }
    } else {
      device = ctx.nameOfId(a.refEntityId.id)
      if (!device) return { ok: false, reason: `参数 ${name} 引用的设备不存在(${a.refEntityId.id})` }
    }
    if (!ctx.claimed.has(device)) needDevices.push(device)
    refOf[name] = { device, key: a.refEntityKey.key }
  }
  if (needDevices.length) {
    const list = [...new Set(needDevices)]
    return { ok: false, reason: `引用的设备 ${list.join('、')} 还没在第 2 步认领`, needDevices: list }
  }

  // 等价核对:原表达式按常规优先级算、翻后的链从左到右算,随机取值各算几遍
  for (let t = 0; t < 4; t++) {
    const v = Object.fromEntries([...used].map(n => [n, 1 + Math.round(Math.random() * 9999) / 100]))
    const a = evalNode(tree, v)
    const b = absAll ? Math.abs(evalChain(chain, v)) : evalChain(chain, v)
    if (!(Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a))))
      return { ok: false, reason: '翻成向导的算法后算出来对不上(保险起见不接管)' }
  }

  const terms: ExprTerm[] = chain.leaves.map(l =>
    l.kind === 'const'
      ? { kind: 'const', value: l.value }
      : { kind: 'key', ...refOf[l.name]!, ...(l.abs ? { abs: true } : {}) }
  )
  const ops: string[] = [...chain.ops]
  if (terms.length === 1) {
    // 向导的自定义四则至少两项:单项补一个「+ 0」,算出来不变
    terms.push({ kind: 'const', value: 0 })
    ops.push('+')
  }

  const notes: string[] = []
  const unused = Object.keys(args).filter(k => !used.has(k))
  if (unused.length)
    notes.push(
      `参数 ${unused.join('、')} 定义了但表达式里没用到` +
        (chain.leaves.some(l => l.kind === 'const') ? ',表达式里是常数——疑似笔误,接管会照原样保留这个算法' : '')
    )

  const computation: Computation = {
    template: 'expr.custom',
    ...(ctx.hostType === 'ASSET' ? { asset: ctx.hostName } : { device: ctx.hostName }),
    terms,
    ops,
    output: outName,
    outputMode,
    adopted: true,
    ...(absAll ? { absAll: true } : {}),
    ...(cf.name !== outName ? { cfName: cf.name } : {}),
  }
  return { ok: true, computation, notes }
}
