/** T5.2 图元库:清单齐全;逐个图元检查硬约定(栅格、端口、只用 currentColor、显式闭合、文字写 texts、三态);全部旋转 / 镜像组合能挂载。 */
import { describe, it, expect, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import {
  SldSymbol,
  builtinSldSymbolGroups,
  builtinSldSymbols,
  getSldSymbol,
  listSldSymbols,
  registerBuiltinSldSymbols,
  resetSldSymbols,
  symbolBoxSize,
  symbolPoint,
} from '../src/sld'
import type { SldRotation, SldSwitchState, SldSymbolDefinition } from '../src/sld'

/** 任务清单(分类顺序即 builtinSldSymbols 的顺序) */
const EXPECTED_IDS = [
  // 开关类
  'breaker',
  'breaker-cart',
  'disconnector',
  'earth-switch',
  'load-switch',
  'switch-simple',
  // 常通类
  'fuse',
  'ct',
  'cable-head',
  'reactor',
  'meter',
  'junction',
  // 变压器
  'transformer-2w',
  // 终端类
  'pt',
  'arrester',
  'capacitor',
  'load',
  'feeder-arrow',
  'charger',
  'live-indicator',
  // 电源类
  'grid-source',
  'generator',
  'pv-array',
  'incoming-arrow',
  // 储能 / 变流
  'inverter',
  'pcs',
  'battery',
  // 通用
  'device-box',
  'status-light',
]

const STATES: SldSwitchState[] = ['open', 'closed', 'unknown']
const ROTATIONS: SldRotation[] = [0, 90, 180, 270]
const CATEGORIES = ['switch', 'transformer', 'measure', 'source', 'load', 'storage', 'protect', 'connect']
const NAMED_COLORS =
  /\b(red|green|blue|black|white|gr[ae]y|yellow|orange|purple|pink|brown|cyan|magenta|lime|navy|teal|silver|gold|maroon|olive|aqua|fuchsia|transparent)\b/i

const fragmentsOf = (s: SldSymbolDefinition): string[] => [s.body, ...Object.values(s.stateBody ?? {})]
const byId = (id: string): SldSymbolDefinition => builtinSldSymbols.find(s => s.id === id)!
const each = builtinSldSymbols.map(s => [s.id, s] as const)

beforeEach(() => resetSldSymbols())

describe('图元库清单', () => {
  it('与任务清单一致、按分类顺序、id 唯一且合规', () => {
    const ids = builtinSldSymbols.map(s => s.id)
    expect(ids).toEqual(EXPECTED_IDS)
    expect(new Set(ids).size).toBe(ids.length)
    for (const id of ids) expect(id).toMatch(/^[a-z][a-z0-9-]*$/)
  })

  it('分组覆盖全部图元,互不重叠', () => {
    const grouped = builtinSldSymbolGroups.flatMap(g => g.symbols)
    expect(grouped).toEqual(builtinSldSymbols)
    expect(new Set(builtinSldSymbolGroups.map(g => g.id)).size).toBe(builtinSldSymbolGroups.length)
    for (const g of builtinSldSymbolGroups) expect(g.title).toBeTruthy()
  })

  it('registerBuiltinSldSymbols 后注册表里恰好是清单上这些(可重复调用)', () => {
    registerBuiltinSldSymbols()
    registerBuiltinSldSymbols()
    expect(listSldSymbols()).toHaveLength(EXPECTED_IDS.length)
    for (const id of EXPECTED_IDS) expect(getSldSymbol(id), id).toBe(byId(id))
  })
})

describe.each(each)('图元 %s', (_id, s) => {
  it('有中文名与合法分类', () => {
    expect(s.name).toMatch(/[一-龥]/)
    expect(CATEGORIES).toContain(s.category)
  })

  it('包围盒、端口坐标是 10 的整数倍;端口在包围盒内、id 唯一', () => {
    expect(s.w).toBeGreaterThan(0)
    expect(s.h).toBeGreaterThan(0)
    expect(s.w % 10).toBe(0)
    expect(s.h % 10).toBe(0)
    for (const p of s.ports) {
      expect(p.x % 10, `${p.id}.x`).toBe(0)
      expect(p.y % 10, `${p.id}.y`).toBe(0)
      expect(p.x, `${p.id}.x`).toBeGreaterThanOrEqual(0)
      expect(p.x, `${p.id}.x`).toBeLessThanOrEqual(s.w)
      expect(p.y, `${p.id}.y`).toBeGreaterThanOrEqual(0)
      expect(p.y, `${p.id}.y`).toBeLessThanOrEqual(s.h)
    }
    expect(new Set(s.ports.map(p => p.id)).size).toBe(s.ports.length)
  })

  it('端口在包围盒边上,朝向与所在的边一致(junction 特例:四个端口都在圆点中心)', () => {
    if (s.id === 'junction') return
    for (const p of s.ports) {
      const edge = { n: p.y === 0, s: p.y === s.h, w: p.x === 0, e: p.x === s.w }
      expect(edge[p.dir], `${p.id} 朝 ${p.dir}`).toBe(true)
    }
  })

  it('SVG 片段:只用 currentColor、线宽 2、整数坐标、显式闭合、没有 <text>', () => {
    for (const f of fragmentsOf(s)) {
      expect(f).not.toMatch(/#|rgb|hsl/i)
      expect(f).not.toMatch(NAMED_COLORS)
      expect(f).not.toMatch(/<text/i)
      expect(f).not.toContain('/>')
      expect(f).not.toMatch(/style=|class=|<svg|<script|<g[\s>]/i)
      for (const [, v] of f.matchAll(/\bstroke="([^"]*)"/g)) expect(v).toBe('currentColor')
      for (const [, v] of f.matchAll(/\bfill="([^"]*)"/g)) expect(['currentColor', 'none']).toContain(v)
      for (const [, v] of f.matchAll(/\bstroke-width="([^"]*)"/g)) expect(v).toBe('2')
      expect(f).not.toMatch(/="[^"]*\d\.\d[^"]*"/)
      // 每个元素都描边(不出现漏写 stroke 而看不见的线),开闭标签数一致
      const opens = [...f.matchAll(/<([a-z]+)\s/g)].map(m => m[1])
      const closes = [...f.matchAll(/<\/([a-z]+)>/g)].map(m => m[1])
      expect(closes).toEqual(opens)
      expect([...f.matchAll(/stroke="currentColor"/g)]).toHaveLength(opens.length)
    }
  })

  it('图形不画出包围盒(线宽压边除外)', () => {
    // 只查能直接读出坐标的属性;path / points 逐个数字对照 max(w, h)
    for (const f of fragmentsOf(s)) {
      for (const [, k, v] of f.matchAll(/\b(x1|x2|cx|x)="(-?\d+)"/g)) {
        expect(Number(v), `${k}=${v}`).toBeGreaterThanOrEqual(0)
        expect(Number(v), `${k}=${v}`).toBeLessThanOrEqual(s.w)
      }
      for (const [, k, v] of f.matchAll(/\b(y1|y2|cy|y)="(-?\d+)"/g)) {
        expect(Number(v), `${k}=${v}`).toBeGreaterThanOrEqual(0)
        expect(Number(v), `${k}=${v}`).toBeLessThanOrEqual(s.h)
      }
      for (const [, cx, cy, r] of f.matchAll(/cx="(\d+)" cy="(\d+)" r="(\d+)"/g)) {
        expect(Number(cx) - Number(r)).toBeGreaterThanOrEqual(0)
        expect(Number(cx) + Number(r)).toBeLessThanOrEqual(s.w)
        expect(Number(cy) - Number(r)).toBeGreaterThanOrEqual(0)
        expect(Number(cy) + Number(r)).toBeLessThanOrEqual(s.h)
      }
      for (const [, pts] of f.matchAll(/points="([^"]*)"/g)) {
        for (const pair of pts!.split(' ')) {
          const [x, y] = pair.split(',').map(Number)
          expect(x).toBeGreaterThanOrEqual(0)
          expect(x).toBeLessThanOrEqual(s.w)
          expect(y).toBeGreaterThanOrEqual(0)
          expect(y).toBeLessThanOrEqual(s.h)
        }
      }
    }
  })

  it('texts:整数坐标、在包围盒内、非空', () => {
    for (const t of s.texts ?? []) {
      expect(Number.isInteger(t.x) && Number.isInteger(t.y)).toBe(true)
      expect(t.x).toBeGreaterThan(0)
      expect(t.x).toBeLessThan(s.w)
      expect(t.y).toBeGreaterThan(0)
      expect(t.y).toBeLessThan(s.h)
      expect(t.text.length).toBeGreaterThan(0)
    }
  })

  it("stateBody:conduct = 'switch' 必须三态齐全;有 stateBody 的三态齐全且互不相同,unknown 用虚线", () => {
    if (s.conduct === 'switch') expect(s.stateBody).toBeDefined()
    if (!s.stateBody) return
    for (const st of STATES) expect(typeof s.stateBody[st], st).toBe('string')
    expect(new Set(STATES.map(st => s.stateBody![st])).size).toBe(3)
    expect(s.stateBody.unknown).toContain('stroke-dasharray')
    expect(s.stateBody.open).not.toContain('stroke-dasharray')
    expect(s.stateBody.closed).not.toContain('stroke-dasharray')
  })

  it('导通方式与端口 id 的约定', () => {
    const ids = s.ports.map(p => p.id)
    if (s.conduct === 'transformer') expect(ids).toEqual(['hv', 'lv'])
    if (s.defaultSource) expect(s.conduct).toBe('none')
    if (s.conduct === 'always' || s.conduct === 'switch') expect(s.ports.length).toBeGreaterThanOrEqual(2)
    if (s.ports.length === 1) expect(ids).toEqual(['a'])
    if (s.ports.length === 2 && s.conduct !== 'transformer') {
      expect(ids).toEqual(['a', 'b'])
      // a 在上、b 在下(竖向画)
      expect(s.ports[0]).toMatchObject({ y: 0, dir: 'n' })
      expect(s.ports[1]).toMatchObject({ y: s.h, dir: 's' })
    }
  })

  it('labelSlots:2–3 个,在图元右侧纵向排开、间距 20(junction 不带)', () => {
    if (s.id === 'junction') return
    const slots = s.labelSlots ?? []
    expect(slots.length).toBeGreaterThanOrEqual(2)
    expect(slots.length).toBeLessThanOrEqual(3)
    slots.forEach((slot, i) => {
      expect(slot.dx).toBe(s.w + 10)
      expect(slot.dy % 10).toBe(0)
      if (i > 0) expect(slot.dy - slots[i - 1]!.dy).toBe(20)
    })
  })

  it('4 个旋转 × 是否镜像都能挂载 <SldSymbol>,端口变换后仍落在旋转后的包围盒边上', () => {
    registerBuiltinSldSymbols()
    for (const rot of ROTATIONS)
      for (const flip of [false, true]) {
        for (const state of s.stateBody ? STATES : [undefined]) {
          const w = mount(SldSymbol, { props: { symbol: s.id, rot, flip, state } })
          expect(w.classes()).not.toContain('sr-sld-symbol-unknown')
          expect(w.find('.sr-sld-symbol-body').element.innerHTML).toBe(s.body)
          if (s.stateBody) expect(w.find('.sr-sld-symbol-state').element.innerHTML).toBe(s.stateBody[state!])
          expect(w.findAll('text')).toHaveLength(s.texts?.length ?? 0)
          w.unmount()
        }
        const box = symbolBoxSize(s, rot)
        for (const p of s.ports) {
          const at = symbolPoint(s, rot, flip, p.x, p.y)
          expect(at.x % 10 === 0 && at.y % 10 === 0, `${p.id} rot=${rot} flip=${flip}`).toBe(true)
          expect(at.x >= 0 && at.x <= box.w && at.y >= 0 && at.y <= box.h).toBe(true)
        }
      }
  })
})

describe('个别图元的约定', () => {
  it('电源类都标 defaultSource;电池也标(放电时是电源)', () => {
    const sources = builtinSldSymbols.filter(s => s.defaultSource).map(s => s.id)
    expect(sources).toEqual(['grid-source', 'generator', 'pv-array', 'incoming-arrow', 'battery'])
  })

  it('开关类:除接地开关外 conduct 都是 switch;接地开关 conduct = none 但三态齐全', () => {
    const group = builtinSldSymbolGroups.find(g => g.id === 'switch')!
    for (const s of group.symbols) {
      expect(s.conduct, s.id).toBe(s.id === 'earth-switch' ? 'none' : 'switch')
      expect(Object.keys(s.stateBody ?? {}).sort(), s.id).toEqual(['closed', 'open', 'unknown'])
    }
    expect(byId('earth-switch').ports).toHaveLength(1)
  })

  it('简化开关:合位实心、分位空心、unknown 虚线框', () => {
    const { stateBody } = byId('switch-simple')
    expect(stateBody!.closed).toContain('fill="currentColor"')
    expect(stateBody!.open).toContain('fill="none"')
    expect(stateBody!.unknown).toContain('stroke-dasharray')
  })

  it('双绕组变:两个相交的圆,端口 hv 在上、lv 在下', () => {
    const t = byId('transformer-2w')
    const circles = [...t.body.matchAll(/cx="(\d+)" cy="(\d+)" r="(\d+)"/g)].map(m => m.slice(1).map(Number))
    expect(circles).toHaveLength(2)
    const [c1, c2] = circles as [number[], number[]]
    expect(Math.abs(c1[1]! - c2[1]!)).toBeLessThan(c1[2]! + c2[2]!)
    expect(t.ports).toEqual([
      { id: 'hv', x: 20, y: 0, dir: 'n' },
      { id: 'lv', x: 20, y: 80, dir: 's' },
    ])
  })

  it('设备框 80×40、四边中点各一个端口、不写字;状态灯 20×20、无端口、三态', () => {
    const box = byId('device-box')
    expect(box).toMatchObject({ w: 80, h: 40, conduct: 'none' })
    expect(box.texts).toBeUndefined()
    expect(box.ports.map(p => [p.x, p.y, p.dir])).toEqual([
      [40, 0, 'n'],
      [80, 20, 'e'],
      [40, 40, 's'],
      [0, 20, 'w'],
    ])
    const light = byId('status-light')
    expect(light).toMatchObject({ w: 20, h: 20, conduct: 'none', ports: [] })
    expect(light.stateBody!.closed).toContain('fill="currentColor"')
    expect(light.stateBody!.open).toContain('fill="none"')
  })

  it('图元里的字都在 texts:发电机 G、储能变流器 PCS、逆变器 ~ / =、电表 Wh', () => {
    const textOf = (id: string): string[] => (byId(id).texts ?? []).map(t => t.text)
    expect(textOf('generator')).toContain('G')
    expect(textOf('pcs')).toEqual(['PCS'])
    expect(textOf('inverter')).toEqual(['~', '='])
    expect(textOf('meter')).toEqual(['Wh'])
  })
})
