/** T5.0 图元注册表:注册校验各条;内置图元合规(端口落栅格、片段只用 currentColor、坐标为整数)。 */
import { describe, it, expect, beforeEach } from 'vitest'
import {
  registerSldSymbol,
  getSldSymbol,
  listSldSymbols,
  resetSldSymbols,
  lookupSldSymbol,
  registerBuiltinSldSymbols,
  builtinSldSymbols,
  breakerSymbol,
  meterSymbol,
  junctionSymbol,
  unknownSldSymbol,
} from '../src/sld'
import type { SldPort, SldSymbolDefinition } from '../src/sld'

const base: SldSymbolDefinition = {
  id: 'demo',
  name: '示例',
  category: 'connect',
  w: 40,
  h: 40,
  ports: [
    { id: 'a', x: 20, y: 0, dir: 'n' },
    { id: 'b', x: 20, y: 40, dir: 's' },
  ],
  conduct: 'always',
  body: '',
}

beforeEach(() => resetSldSymbols())

describe('registerSldSymbol 校验', () => {
  it('合规的能注册、能查到', () => {
    registerSldSymbol(base)
    expect(getSldSymbol('demo')).toBe(base)
    expect(lookupSldSymbol('demo')).toBe(base)
    expect(getSldSymbol('nope')).toBeUndefined()
    expect(listSldSymbols()).toEqual([base])
  })

  it('id 必须匹配 ^[a-z][a-z0-9-]*$', () => {
    for (const id of ['', 'Breaker', '1abc', 'a_b', 'a.b', '断路器'])
      expect(() => registerSldSymbol({ ...base, id }), id).toThrow(/不符合/)
    expect(() => registerSldSymbol({ ...base, id: 'load-switch-2' })).not.toThrow()
  })

  it('w / h 必须大于 0', () => {
    expect(() => registerSldSymbol({ ...base, w: 0 })).toThrow(/w \/ h/)
    expect(() => registerSldSymbol({ ...base, h: -10 })).toThrow(/w \/ h/)
    expect(() => registerSldSymbol({ ...base, w: NaN })).toThrow(/w \/ h/)
  })

  it('端口 id 唯一', () => {
    const ports: SldPort[] = [base.ports[0]!, { ...base.ports[1]!, id: 'a' }]
    expect(() => registerSldSymbol({ ...base, ports })).toThrow(/端口 "a" 重复/)
  })

  it('端口坐标在包围盒边上或内部', () => {
    const at = (x: number, y: number): SldSymbolDefinition => ({ ...base, ports: [{ id: 'p', x, y, dir: 'n' }] })
    expect(() => registerSldSymbol(at(0, 0))).not.toThrow()
    expect(() => registerSldSymbol(at(40, 40))).not.toThrow()
    expect(() => registerSldSymbol(at(20, 20))).not.toThrow()
    expect(() => registerSldSymbol(at(50, 0))).toThrow(/超出包围盒/)
    expect(() => registerSldSymbol(at(20, -10))).toThrow(/超出包围盒/)
    expect(() => registerSldSymbol(at(NaN, 0))).toThrow(/超出包围盒/)
  })

  it("conduct = 'switch' 必须有三态齐全的 stateBody;其他导通方式不要求", () => {
    const sw: SldSymbolDefinition = { ...base, conduct: 'switch' }
    expect(() => registerSldSymbol(sw)).toThrow(/三态齐全/)
    const partial = { open: '', closed: '' } as SldSymbolDefinition['stateBody']
    expect(() => registerSldSymbol({ ...sw, stateBody: partial })).toThrow(/缺 "unknown"/)
    expect(() => registerSldSymbol({ ...sw, stateBody: { open: '', closed: '', unknown: '' } })).not.toThrow()
    expect(() => registerSldSymbol({ ...base, conduct: 'none' })).not.toThrow()
  })

  it('校验不过的不会进注册表;同 id 重复注册以后者为准', () => {
    expect(() => registerSldSymbol({ ...base, w: 0 })).toThrow()
    expect(listSldSymbols()).toEqual([])
    registerSldSymbol(base)
    const next = { ...base, name: '新版' }
    registerSldSymbol(next)
    expect(listSldSymbols()).toEqual([next])
  })

  it('resetSldSymbols 清空', () => {
    registerSldSymbol(base)
    resetSldSymbols()
    expect(listSldSymbols()).toEqual([])
  })
})

describe('图元文字约定', () => {
  it('片段里带 <text> 的图元注册时被拒', () => {
    expect(() =>
      registerSldSymbol({ ...meterSymbol, id: 'bad-text', body: meterSymbol.body + '<text x="0" y="0">A</text>' })
    ).toThrow(/texts/)
  })

  it('片段里带自闭合标签的图元注册时被拒', () => {
    expect(() =>
      registerSldSymbol({ ...meterSymbol, id: 'bad-close', body: '<line x1="0" y1="0" x2="10" y2="10" />' })
    ).toThrow(/显式闭合/)
    const stateBody = { open: '', closed: '<circle cx="5" cy="5" r="2"/>', unknown: ' ' }
    expect(() => registerSldSymbol({ ...meterSymbol, id: 'bad-close-state', stateBody })).toThrow(/显式闭合/)
  })
})

describe('内置图元', () => {
  it('registerBuiltinSldSymbols:全部通过校验,可重复调用', () => {
    registerBuiltinSldSymbols()
    registerBuiltinSldSymbols()
    // T5.2 起内置图元是整套图元库(清单与逐项约定见 sld-symbols-library.test.ts);T5.0 的三个样板仍在其中
    expect(listSldSymbols().map(s => s.id)).toEqual(builtinSldSymbols.map(s => s.id))
    expect(builtinSldSymbols).toEqual(expect.arrayContaining([breakerSymbol, meterSymbol, junctionSymbol]))
    expect(new Set(builtinSldSymbols.map(s => s.id)).size).toBe(builtinSldSymbols.length)
  })

  it('形状符合任务约定', () => {
    expect(breakerSymbol).toMatchObject({ conduct: 'switch', w: 40, h: 60 })
    expect(breakerSymbol.ports).toEqual([
      { id: 'a', x: 20, y: 0, dir: 'n' },
      { id: 'b', x: 20, y: 60, dir: 's' },
    ])
    expect(meterSymbol).toMatchObject({ conduct: 'always', w: 40, h: 40 })
    expect(meterSymbol.labelSlots).toHaveLength(3)
    // 文字不写进 body(会跟着旋转躺倒 / 镜像反字),写 texts
    expect(meterSymbol.body).not.toContain('<text')
    expect(meterSymbol.texts).toEqual([{ x: 20, y: 20, text: 'Wh', size: 12 }])
    expect(junctionSymbol).toMatchObject({ conduct: 'always', w: 20, h: 20 })
    expect(junctionSymbol.ports.map(p => p.dir).sort()).toEqual(['e', 'n', 's', 'w'])
  })

  it.each(builtinSldSymbols.map(s => [s.id, s] as const))('%s:包围盒与端口落在 10 的整数倍上', (_id, s) => {
    expect(s.w % 10).toBe(0)
    expect(s.h % 10).toBe(0)
    for (const p of s.ports) {
      expect(p.x % 10, `${s.id}.${p.id}.x`).toBe(0)
      expect(p.y % 10, `${s.id}.${p.id}.y`).toBe(0)
    }
  })

  const NAMED_COLORS =
    /\b(red|green|blue|black|white|gr[ae]y|yellow|orange|purple|pink|brown|cyan|magenta|lime|navy|teal|silver|gold|maroon|olive|aqua|fuchsia|transparent)\b/i

  it.each([...builtinSldSymbols, unknownSldSymbol].map(s => [s.id, s] as const))(
    '%s:SVG 片段只用 currentColor、线宽 2、坐标为整数',
    (_id, s) => {
      const fragments = [s.body, ...Object.values(s.stateBody ?? {})]
      for (const f of fragments) {
        expect(f).not.toMatch(/#|rgb|hsl/i)
        expect(f).not.toMatch(NAMED_COLORS)
        expect(f).not.toMatch(/style=|<svg|<script/i)
        // 标签显式闭合,不用自闭合(HTML 解析器不认,见 symbols/svg.ts)
        expect(f).not.toContain('/>')
        for (const [, v] of f.matchAll(/\bstroke="([^"]*)"/g)) expect(v).toBe('currentColor')
        for (const [, v] of f.matchAll(/\bfill="([^"]*)"/g)) expect(['currentColor', 'none']).toContain(v)
        for (const [, v] of f.matchAll(/\bstroke-width="([^"]*)"/g)) expect(v).toBe('2')
        // 属性值里不出现小数
        expect(f).not.toMatch(/="[^"]*\d\.\d[^"]*"/)
      }
      // 开关图元三态的片段互不相同
      if (s.stateBody) expect(new Set(Object.values(s.stateBody)).size).toBe(3)
    }
  )
})
