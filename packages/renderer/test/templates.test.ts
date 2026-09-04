/**
 * T2.3 模板:三个内置模板可注册、槽位不重叠(scaled)/ areas 完整(grid)、accepts 与内置组件一致;
 * 用每个模板各配一份合法配置通过注册表校验,并在 <ScadaPage design> 下渲染出对应槽位。
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'

vi.mock('echarts/core', () => ({
  init: () => ({ setOption: vi.fn(), resize: vi.fn(), dispose: vi.fn() }),
  use: () => {},
  color: { modifyAlpha: (c: string) => c },
  graphic: { LinearGradient: class {} },
}))
vi.mock('echarts/charts', () => ({ LineChart: {}, BarChart: {}, GaugeChart: {} }))
vi.mock('echarts/components', () => ({ GridComponent: {}, TooltipComponent: {}, LegendComponent: {} }))
vi.mock('echarts/renderers', () => ({ CanvasRenderer: {} }))

import {
  ScadaPage,
  registerBuiltins,
  resetRegistry,
  validateAgainstRegistry,
  builtinTemplates,
  builtinWidgets,
  listTemplates,
} from '../src/index'
import type { PageConfig } from '../src/schema/page-config'
import { validatePageConfig } from '../src/schema'

beforeEach(() => {
  resetRegistry()
  registerBuiltins()
})

const DEV = { type: 'DEVICE', id: 'd1', name: '设备一' } as const

describe('内置模板', () => {
  it('三个模板已注册,scaled 槽位在设计稿内且互不重叠,grid 的 areas 覆盖全部槽位', () => {
    expect(
      listTemplates()
        .map(t => t.id)
        .sort()
    ).toEqual(['grid-3x3', 'monitor-3col', 'overview-a'])
    for (const t of builtinTemplates) {
      if (t.kind === 'scaled') {
        const rects = t.slots.map(s => ({ n: s.name, ...(s.area as { x: number; y: number; w: number; h: number }) }))
        for (const r of rects) {
          expect(r.x + r.w, `${t.id}.${r.n} 超出宽度`).toBeLessThanOrEqual(t.design!.w)
          expect(r.y + r.h, `${t.id}.${r.n} 超出高度`).toBeLessThanOrEqual(t.design!.h)
        }
        for (let i = 0; i < rects.length; i++)
          for (let j = i + 1; j < rects.length; j++) {
            const a = rects[i]!,
              b = rects[j]!
            const overlap = a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
            expect(overlap, `${t.id}: ${a.n} 与 ${b.n} 重叠`).toBe(false)
          }
      } else {
        const named = new Set(t.areas!.join(' ').split(/\s+/))
        for (const s of t.slots) expect(named.has(String(s.area)), `${t.id}.${s.name} 不在 areas`).toBe(true)
      }
    }
  })

  it('accepts 里引用的组件类型要么已内置,要么是 T2.2 计划内的类型', () => {
    const known = new Set([...builtinWidgets.map(w => w.type), 'status-light', 'table', 'image'])
    for (const t of builtinTemplates)
      for (const s of t.slots) {
        for (const a of s.accepts ?? []) expect(known.has(a), `${t.id}.${s.name} accepts 未知类型 ${a}`).toBe(true)
        if (s.fixed) expect(known.has(s.fixed.type)).toBe(true)
      }
  })

  const configs: Record<string, PageConfig> = {
    'overview-a': {
      schemaVersion: 1,
      template: 'overview-a',
      widgets: [
        {
          id: 'w-s1',
          slot: 's1',
          type: 'number-card',
          props: { title: 'P' },
          bindings: { value: { mode: 'ts', entity: DEV, key: 'P' } },
        },
        {
          id: 'w-s2',
          slot: 's2',
          type: 'gauge',
          props: { title: 'F', min: 49, max: 51 },
          bindings: { value: { mode: 'ts', entity: DEV, key: 'F' } },
        },
        {
          id: 'w-s3',
          slot: 's3',
          type: 'overview-card',
          props: { items: [{ label: 'Ia' }] },
          bindings: { items: [{ mode: 'ts', entity: DEV, key: 'Ia' }] },
        },
        {
          id: 'w-g1',
          slot: 'g1',
          type: 'line',
          props: { title: '24h' },
          bindings: { series: [{ mode: 'ts-history', entity: DEV, keys: ['P'], window: '24h' }] },
        },
        {
          id: 'w-g2',
          slot: 'g2',
          type: 'dual-axis',
          bindings: { primary: { mode: 'ts-history', entity: DEV, keys: ['P'], window: '2h' } },
        },
        { id: 'w-g3', slot: 'g3', type: 'alarm-list', bindings: { alarms: { mode: 'alarm', entity: DEV } } },
      ],
    },
    'monitor-3col': {
      schemaVersion: 1,
      template: 'monitor-3col',
      widgets: [
        { id: 'w-l1', slot: 'l1', type: 'overview-card', bindings: { items: [{ mode: 'ts', entity: DEV, key: 'P' }] } },
        { id: 'w-main', slot: 'main', type: 'text', props: { content: '主视区' }, bindings: {} },
        {
          id: 'w-c1',
          slot: 'c1',
          type: 'line',
          bindings: { series: [{ mode: 'ts-history', entity: DEV, keys: ['P'], window: '2h' }] },
        },
        { id: 'w-r1', slot: 'r1', type: 'gauge', bindings: { value: { mode: 'ts', entity: DEV, key: 'SOC' } } },
      ],
    },
    'grid-3x3': {
      schemaVersion: 1,
      template: 'grid-3x3',
      widgets: [
        { id: 'w-r1c1', slot: 'r1c1', type: 'number-card', bindings: { value: { mode: 'const', value: 1 } } },
        { id: 'w-r2c2', slot: 'r2c2', type: 'line', bindings: { series: [{ mode: 'const', value: [] }] } },
        { id: 'w-r3c3', slot: 'r3c3', type: 'alarm-list', bindings: { alarms: { mode: 'const', value: [] } } },
      ],
    },
  }

  for (const [id, cfg] of Object.entries(configs)) {
    it(`${id}:合法配置通过 schema + 注册表校验,design 模式渲染出全部槽位与组件`, async () => {
      expect(validatePageConfig(cfg).ok).toBe(true)
      expect(validateAgainstRegistry(cfg).filter(i => i.level === 'error')).toEqual([])
      const w = mount(ScadaPage, { props: { config: cfg, design: true } })
      await nextTick()
      const tpl = builtinTemplates.find(t => t.id === id)!
      expect(w.findAll('.sr-slot')).toHaveLength(tpl.slots.length)
      expect(w.findAll('.sr-widget')).toHaveLength(cfg.widgets.length)
      expect(w.find('.sr-root').attributes('data-template')).toBe(id)
      if (tpl.kind === 'grid') expect(w.find('.sr-root').attributes('style')).toContain('grid-template-areas')
      else expect(w.find('.sr-root').attributes('style')).toContain('scale(')
      w.unmount()
    })
  }

  it('accepts 违规被注册表拦下(overview-a 的指标位不接受曲线)', () => {
    const cfg: PageConfig = {
      schemaVersion: 1,
      template: 'overview-a',
      widgets: [
        { id: 'w-s1', slot: 's1', type: 'line', bindings: { series: [{ mode: 'const', value: [] }] } },
        { id: 'w-g1', slot: 'g1', type: 'text', bindings: {} },
      ],
    }
    const errs = validateAgainstRegistry(cfg).filter(i => i.level === 'error')
    expect(errs.some(e => e.path === '/widgets/w-s1/slot')).toBe(true)
  })
})
