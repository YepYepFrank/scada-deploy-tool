// applyRenameTable 的 from 选项:只搬这个时刻之后的旧点(镜像 TB 有 7 天 TTL,秒级旧数据没必要全量复制)
import { describe, expect, it } from 'vitest'
import { applyRenameTable, type RenameEntry, type TbApi } from '../src/index'

const row: RenameEntry = { entityType: 'DEVICE', entity: 'D1', old: 'pqSum', new: 'calc_pqSum', since: 't' }

function api(oldPts: number[], newFirst: number | null): { api: TbApi; posted: number[] } {
  const posted: number[] = []
  const fn: TbApi = async (url, data) => {
    if (url.startsWith('/api/tenant/devices?')) return { data: [{ id: { id: 'd1' }, name: 'D1' }] }
    if (url.includes('/values/timeseries?')) {
      const p = new URLSearchParams(url.split('?')[1])
      const key = p.get('keys')!
      const start = Number(p.get('startTs')),
        end = Number(p.get('endTs')),
        limit = Number(p.get('limit'))
      if (key === 'calc_pqSum') return { calc_pqSum: newFirst == null ? [] : [{ ts: newFirst, value: 1 }] }
      return {
        pqSum: oldPts
          .filter(t => t >= start && t <= end)
          .slice(0, limit)
          .map(t => ({ ts: t, value: t })),
      }
    }
    if (url.endsWith('/timeseries/ANY')) {
      for (const e of data as { ts: number }[]) posted.push(e.ts)
      return null
    }
    throw new Error('unhandled ' + url)
  }
  return { api: fn, posted }
}

describe('applyRenameTable · from', () => {
  it('from 之前的旧点不搬;区间仍止于新 key 首点', async () => {
    const { api: a, posted } = api([10, 20, 30, 40, 50, 60], 50)
    const r = await applyRenameTable(a, [row], { apply: true, from: 25 })
    expect(r[0]).toMatchObject({ points: 2, range: { from: 30, to: 40 }, newFirstTs: 50 })
    expect(posted).toEqual([30, 40])
  })
  it('from 大于新 key 首点 → 0 点(幂等,不写)', async () => {
    const { api: a, posted } = api([10, 20, 30], 20)
    const r = await applyRenameTable(a, [row], { apply: true, from: 20 })
    expect(r[0]!.points).toBe(0)
    expect(posted).toEqual([])
  })
})
