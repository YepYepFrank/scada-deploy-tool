// T5.5 文档状态机:apply / 撤销 / 重做 / 回滚 / newId / content 每次换新对象
import { describe, expect, it, vi } from 'vitest'
import { registerBuiltinSldSymbols, SLD_ID_PATTERN, type SldDoc, type SldIssue } from '@grid/scada-renderer'
import { createSldStore } from '../src/sld-editor/store'
import { makeMockContent } from '../src/sld-editor/dev/mock'

registerBuiltinSldSymbols()

const noIssues = (): SldIssue[] => []
/** 名字叫 BAD 的节点算 error——模拟 validateSldDoc */
const badName = (doc: SldDoc): SldIssue[] =>
  doc.nodes
    .filter(n => n.name === 'BAD')
    .map(n => ({ level: 'error' as const, path: `nodes/${n.id}`, code: 'bad-id' as const, message: `${n.id} 不合法` }))

describe('createSldStore', () => {
  it('初始内容是深拷贝,不和传进来的对象共享引用', () => {
    const init = makeMockContent()
    const store = createSldStore(init, { validate: noIssues })
    expect(store.content.value).toEqual(init)
    expect(store.content.value).not.toBe(init)
    expect(store.content.value.doc.nodes[0]).not.toBe(init.doc.nodes[0])
  })

  it('apply:每次整体换新对象,旧快照不被改动', () => {
    const store = createSldStore(makeMockContent(), { validate: noIssues })
    const before = store.content.value
    const frozen = JSON.stringify(before)
    expect(store.apply(d => void (d.doc.nodes[0]!.name = '改名'), '改名')).toBe(true)
    expect(store.content.value).not.toBe(before)
    expect(store.content.value.doc).not.toBe(before.doc)
    expect(store.content.value.doc.nodes[0]!.name).toBe('改名')
    expect(JSON.stringify(before)).toBe(frozen)
  })

  it('apply:recipe 返回 false 或没有实际变化 → 不进撤销栈、content 不换', () => {
    const store = createSldStore(makeMockContent(), { validate: noIssues })
    const before = store.content.value
    expect(store.apply(() => false)).toBe(false)
    expect(store.apply(() => undefined)).toBe(false)
    expect(store.content.value).toBe(before)
    expect(store.canUndo.value).toBe(false)
  })

  it('doc 与 bindings 一起改、一起撤销', () => {
    const store = createSldStore(makeMockContent(), { validate: noIssues })
    store.apply(d => {
      d.doc.labels.push({ id: 'l99', x: 0, y: 0, kind: 'value', pt: 'p99' })
      d.bindings['pt.p99'] = { mode: 'ts', entity: { type: 'DEVICE', id: '', name: 'X' }, key: 'k' }
    }, '加测点')
    expect(store.content.value.bindings['pt.p99']).toBeDefined()
    store.undo()
    expect(store.content.value.bindings['pt.p99']).toBeUndefined()
    expect(store.content.value.doc.labels.find(l => l.id === 'l99')).toBeUndefined()
  })

  it('撤销 / 重做:回到同一个快照对象;新 apply 清空重做栈', () => {
    const store = createSldStore(makeMockContent(), { validate: noIssues })
    const s0 = store.content.value
    store.apply(d => void (d.doc.nodes[0]!.x += 10), '移动')
    const s1 = store.content.value
    store.apply(d => void (d.doc.nodes[0]!.x += 10), '再移动')
    expect(store.undoLabel.value).toBe('再移动')
    expect(store.undo()).toBe(true)
    expect(store.content.value).toBe(s1)
    expect(store.redoLabel.value).toBe('再移动')
    expect(store.undo()).toBe(true)
    expect(store.content.value).toBe(s0)
    expect(store.undo()).toBe(false)
    expect(store.redo()).toBe(true)
    expect(store.content.value).toBe(s1)
    store.apply(d => void (d.doc.nodes[0]!.y += 10), '岔开')
    expect(store.canRedo.value).toBe(false)
    expect(store.redo()).toBe(false)
  })

  it('撤销栈上限(可配;缺省 100)', () => {
    const small = createSldStore(makeMockContent(), { validate: noIssues, limit: 5 })
    for (let i = 0; i < 12; i += 1) small.apply(d => void (d.doc.nodes[0]!.x += 10), `第 ${i} 步`)
    let steps = 0
    while (small.undo()) steps += 1
    expect(steps).toBe(5)

    const store = createSldStore(makeMockContent(), { validate: noIssues })
    for (let i = 0; i < 130; i += 1) store.apply(d => void (d.doc.nodes[0]!.x += 10))
    steps = 0
    while (store.undo()) steps += 1
    expect(steps).toBe(100)
  })

  it('校验出 error → 整笔回滚并提示;下一次成功的 apply 清掉提示', () => {
    const store = createSldStore(makeMockContent(), { validate: badName })
    const before = store.content.value
    const ok = store.apply(d => {
      d.doc.nodes[0]!.name = 'BAD'
      d.doc.nodes[1]!.x += 100
    }, '改坏')
    expect(ok).toBe(false)
    expect(store.content.value).toBe(before)
    expect(store.canUndo.value).toBe(false)
    expect(store.notice.value).toContain('改坏')
    expect(store.notice.value).toContain('n1 不合法')
    store.apply(d => void (d.doc.nodes[1]!.x += 100), '正常')
    expect(store.notice.value).toBe('')
  })

  it('文档里本来就有的 error 不拦后续修改(只拦新带来的)', () => {
    const init = makeMockContent()
    init.doc.nodes[0]!.name = 'BAD'
    const store = createSldStore(init, { validate: badName })
    expect(store.apply(d => void (d.doc.nodes[1]!.x += 10))).toBe(true)
    expect(store.apply(d => void (d.doc.nodes[1]!.name = 'BAD'))).toBe(false)
  })

  it('缺省校验:validateSldDoc 抛错(基线上的桩)视为没有 error,不影响 apply', () => {
    const store = createSldStore(makeMockContent())
    expect(store.apply(d => void (d.doc.nodes[0]!.x += 10))).toBe(true)
  })

  it('newId:图内唯一、符合字符集、连续取不撞、撤销后也不复用', () => {
    const store = createSldStore(makeMockContent(), { validate: noIssues })
    const a = store.newId('n')
    const b = store.newId('n')
    expect(a).toBe('n11')
    expect(b).toBe('n12')
    const seen = new Set<string>()
    for (const kind of ['n', 'b', 'w', 'l', 'f', 'p'] as const) {
      for (let i = 0; i < 3; i += 1) {
        const id = store.newId(kind)
        expect(id).toMatch(SLD_ID_PATTERN)
        expect(id.startsWith(kind)).toBe(true)
        expect(seen.has(id)).toBe(false)
        seen.add(id)
      }
    }
    const id = store.newId('n')
    store.apply(d => void d.doc.nodes.push({ id, symbol: 'meter', x: 0, y: 0, rot: 0 }))
    store.undo()
    expect(store.newId('n')).not.toBe(id)
  })

  it('newId("p") 同时避开绑定里与图里引用到的测点', () => {
    const init = makeMockContent()
    init.bindings['pt.p40'] = { mode: 'ts', entity: { type: 'DEVICE', id: '', name: 'X' }, key: 'k' }
    init.doc.labels.push({ id: 'l50', x: 0, y: 0, kind: 'value', pt: 'p41' })
    const store = createSldStore(init, { validate: noIssues })
    expect(store.newId('p')).toBe('p42')
  })

  it('选择集:缺的键视为空;没变化不换对象;删掉元素后自动剔除', () => {
    const store = createSldStore(makeMockContent(), { validate: noIssues })
    store.select({ nodes: ['n1', 'nope'], buses: ['b1'] })
    expect(store.selection.value).toEqual({ nodes: ['n1'], buses: ['b1'], wires: [], labels: [], frames: [] })
    const same = store.selection.value
    store.select({ nodes: ['n1'], buses: ['b1'] })
    expect(store.selection.value).toBe(same)
    store.apply(d => void (d.doc.nodes = d.doc.nodes.filter(n => n.id !== 'n1')), '删')
    expect(store.selection.value.nodes).toEqual([])
    expect(store.selection.value.buses).toEqual(['b1'])
  })

  it('onChange:同步回调、带原因;reset 清空撤销栈', () => {
    const store = createSldStore(makeMockContent(), { validate: noIssues })
    const cb = vi.fn()
    const off = store.onChange(cb)
    store.apply(d => void (d.doc.nodes[0]!.x += 10))
    expect(cb.mock.calls[0]![0]).toBe(store.content.value)
    store.undo()
    store.redo()
    expect(cb.mock.calls.map(c => c[1])).toEqual(['apply', 'undo', 'redo'])
    store.reset(makeMockContent())
    expect(cb.mock.calls[3]![1]).toBe('reset')
    expect(store.canUndo.value).toBe(false)
    off()
    store.apply(d => void (d.doc.nodes[0]!.x += 10))
    expect(cb).toHaveBeenCalledTimes(4)
  })
})
