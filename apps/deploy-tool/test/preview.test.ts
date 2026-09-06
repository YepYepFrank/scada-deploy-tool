// T3.6 预览 + Customer 视角:同一份 JSON 换身份渲染;无权实体的订阅被拒 → 组件错误态 + 顶部计数。
import { describe, expect, it, vi } from 'vitest'
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

import { registerBuiltins, type PageConfig } from '@grid/scada-renderer'
import type { DataSource } from '@grid/tb-client'
import PreviewPane from '../src/editor/PreviewPane.vue'

registerBuiltins()

const OK = { type: 'DEVICE', id: 'dev-ok', name: 'SSP1_GP1_IED1' } as const
const SECRET = { type: 'DEVICE', id: 'dev-secret', name: 'BS_1_CK' } as const
const config: PageConfig = {
  schemaVersion: 1,
  template: 'overview-a',
  title: '预览验收',
  widgets: [
    { id: 'w-ok', type: 'number-card', slot: 's1', bindings: { value: { mode: 'ts', entity: OK, key: 'P' } } },
    { id: 'w-secret', type: 'number-card', slot: 's2', bindings: { value: { mode: 'ts', entity: SECRET, key: 'P' } } },
    {
      id: 'w-g1',
      type: 'line',
      slot: 'g1',
      bindings: { series: [{ mode: 'ts-history', entity: OK, keys: ['P'], window: '1h' }] },
    },
  ],
}

/** 假数据源:按「当前 token 是谁」决定哪些实体可见;不可见的订阅像 TB 一样回 onError 一次 */
function fakeSource(getToken: () => string) {
  const disposed = vi.fn()
  const canSee = (id: string) => getToken() === 'tenant-jwt' || id !== SECRET.id
  const deny = (onError?: (e: Error) => void) =>
    queueMicrotask(() => onError?.(new Error('TB 订阅被拒绝(2):Failed to fetch data!')))
  const ds: DataSource & { dispose(): void; disposed: typeof disposed } = {
    status: 'live',
    onStatus: cb => {
      cb('live')
      return () => {}
    },
    subscribeTs: (entity, keys, cb, onError) => {
      if (!canSee(entity.id)) deny(onError)
      else queueMicrotask(() => cb(keys.map(key => ({ key, points: [{ ts: 1, value: 42.5 }] }))))
      return () => {}
    },
    subscribeAttr: (entity, _scope, _keys, _cb, onError) => {
      if (!canSee(entity.id)) deny(onError)
      return () => {}
    },
    subscribeAlarms: (entity, _types, cb, onError) => {
      if (!canSee(entity.id)) deny(onError)
      else cb([])
      return () => {}
    },
    getHistory: async entity => {
      if (!canSee(entity.id)) throw new Error('HTTP 403')
      return { P: [{ ts: 1, value: 1 }] }
    },
    getLatest: async () => ({}),
    dispose: disposed,
    disposed,
  }
  return ds
}

const flush = async () => {
  for (let i = 0; i < 6; i++) await Promise.resolve()
  await nextTick()
}

const fetchImpl = vi.fn(async (url: string) => {
  if (url.endsWith('/api/auth/login')) return new Response(JSON.stringify({ token: 'customer-jwt' }), { status: 200 })
  if (url.endsWith('/api/auth/user'))
    return new Response(JSON.stringify({ authority: 'CUSTOMER_USER' }), { status: 200 })
  return new Response('', { status: 404 })
}) as unknown as typeof fetch

describe('预览 + Customer 视角', () => {
  it('租户视角:全部绑定可见,没有横幅;数值到组件', async () => {
    const made: ReturnType<typeof fakeSource>[] = []
    const w = mount(PreviewPane, {
      props: {
        config,
        base: '/tbm',
        tenantToken: 'tenant-jwt',
        tenantUser: 'tenant@thingsboard.org',
        makeSource: (_b, getToken) => {
          const s = fakeSource(getToken)
          made.push(s)
          return s
        },
      },
    })
    await flush()
    expect(made).toHaveLength(1)
    expect(w.find('[data-role="banner"]').exists()).toBe(false)
    expect(w.find('.sr-widget[data-widget="w-secret"] .sr-error').exists()).toBe(false)
    expect(w.find('.sr-widget[data-widget="w-ok"]').text()).toContain('42.5')
    w.unmount()
    expect(made[0]!.disposed).toHaveBeenCalled()
  })

  it('Customer 视角:登录后换数据源渲染同一份 JSON;未分配设备的组件为错误态,顶部计数 1', async () => {
    const made: ReturnType<typeof fakeSource>[] = []
    const w = mount(PreviewPane, {
      props: {
        config,
        base: '/tbm',
        tenantToken: 'tenant-jwt',
        customerUser: 'xrs-viewer@gridops.local',
        fetchImpl,
        makeSource: (_b, getToken) => {
          const s = fakeSource(getToken)
          made.push(s)
          return s
        },
      },
    })
    await flush()
    await w.find('input[value="customer"]').setValue()
    await flush()
    // 没登录:没有数据源,提示先登录
    expect(w.find('.pv-empty').text()).toContain('CUSTOMER_USER')
    expect(made[0]!.disposed).toHaveBeenCalled()
    await w.find('[data-role="cust-pass"]').setValue('secret')
    await w.find('[data-role="cust-login"]').trigger('click')
    await flush()
    await flush()
    expect(w.find('[data-role="cust-msg"]').text()).toContain('CUSTOMER_USER')
    expect(made).toHaveLength(2)
    expect(w.find('[data-role="invisible-count"]').text()).toBe(
      '1 个绑定在该Customer「xrs-viewer@gridops.local」下不可见'
    )
    expect(w.find('[data-role="failed-count"]').exists()).toBe(false)
    expect(w.find('.sr-widget[data-widget="w-secret"] .sr-error').exists()).toBe(true)
    expect(w.find('.sr-widget[data-widget="w-ok"] .sr-error').exists()).toBe(false)
    expect(w.find('.pv-banner li').text()).toContain('number-card · s2 / value')
    // 切回租户:横幅消失,错误态消失
    await w.find('input[value="tenant"]').setValue()
    await flush()
    expect(w.find('[data-role="banner"]').exists()).toBe(false)
    expect(w.find('.sr-widget[data-widget="w-secret"] .sr-error').exists()).toBe(false)
    expect(made).toHaveLength(3)
  })
})
