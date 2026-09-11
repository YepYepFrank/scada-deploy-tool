// 第 1 步目标环境清单(2026-09-11):内置 / 自定义都能重命名、删除;内置的删除是本机隐藏。
import { describe, expect, it } from 'vitest'
import { fallbackEnv, hideBuiltin, labelTaken, mergeEnvs, renameBuiltin, type EnvDef } from '../src/provisioner/envs'

const B: Record<string, EnvDef> = {
  demo: { label: '生产镜像(/api 直连)', base: '', defUser: 'u', defPass: '' },
  mirror: { label: '生产镜像', base: '/tbm', defUser: 'u', defPass: '' },
}
const C = [{ id: 'c1', label: '仙人山二期', base: 'http://10.0.0.1:8080' }]

describe('目标环境清单', () => {
  it('合并:内置在前、自定义在后,各带来源标记;内置改名只换显示名、地址不变', () => {
    const m = mergeEnvs(B, { mirror: { label: '镜像 · 走代理' } }, C)
    expect(Object.keys(m)).toEqual(['demo', 'mirror', 'c1'])
    expect(m.mirror).toMatchObject({ label: '镜像 · 走代理', base: '/tbm', builtin: true })
    expect(m.c1).toMatchObject({ label: '仙人山二期', base: 'http://10.0.0.1:8080', custom: true })
  })

  it('删除内置 = 从下拉里隐藏(不提供恢复);其余环境不受影响', () => {
    const o = hideBuiltin(renameBuiltin({}, B, 'demo', '直连'), 'demo')
    expect(o).toEqual({ demo: { label: '直连', hidden: true } })
    expect(Object.keys(mergeEnvs(B, o, C))).toEqual(['mirror', 'c1'])
  })

  it('内置改名:空名或改回默认名 = 去掉覆盖', () => {
    const o = renameBuiltin({}, B, 'mirror', '新名')
    expect(o).toEqual({ mirror: { label: '新名' } })
    expect(renameBuiltin(o, B, 'mirror', '  ')).toEqual({})
    expect(renameBuiltin(o, B, 'mirror', '生产镜像')).toEqual({})
    // 已隐藏的改回默认名时,隐藏状态保留
    expect(renameBuiltin(hideBuiltin(o, 'mirror'), B, 'mirror', '')).toEqual({ mirror: { hidden: true } })
  })

  it('重名检查排除自己;当前环境被删后优先退回 mirror,没有就退到第一个', () => {
    const m = mergeEnvs(B, {}, C)
    expect(labelTaken(m, ' 生产镜像 ')).toBe(true)
    expect(labelTaken(m, '生产镜像', 'mirror')).toBe(false)
    expect(fallbackEnv(m)).toBe('mirror')
    expect(fallbackEnv(mergeEnvs(B, { mirror: { hidden: true } }, C))).toBe('demo')
    expect(fallbackEnv({})).toBeNull()
  })
})
