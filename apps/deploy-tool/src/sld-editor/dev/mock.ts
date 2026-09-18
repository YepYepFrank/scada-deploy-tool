/**
 * 独立开发入口的 mock 内容:1 条母线 + 3 个间隔(断路器 → 电表 → 连接点),带旋转节点、手工拐点、标签、分组框与 mock 绑定。
 * 只用基线上的 3 个内置图元(breaker / meter / junction);测试也拿它当往返样例。
 */
import type { Binding, SldDoc, SldLabel, SldNode, SldWire } from '@grid/scada-renderer'
import type { SldEditorContent } from '../ext'

const ts = (name: string, key: string): Binding => ({ mode: 'ts', entity: { type: 'DEVICE', id: '', name }, key })

export function makeMockContent(): SldEditorContent {
  const nodes: SldNode[] = []
  const wires: SldWire[] = []
  const labels: SldLabel[] = []
  const bindings: Record<string, Binding> = {}
  for (let i = 0; i < 3; i += 1) {
    const x = 200 + i * 200
    const dev = `PDR1_LP${i + 1}_IED1`
    const [brk, meter, junction] = [`n${i * 3 + 1}`, `n${i * 3 + 2}`, `n${i * 3 + 3}`]
    nodes.push(
      {
        id: brk,
        symbol: 'breaker',
        x,
        y: 160,
        rot: 0,
        name: `${i + 1}# 出线断路器`,
        entity: { type: 'DEVICE', name: dev },
        state: { pt: `p${i * 2 + 1}`, map: { '1': 'closed', '0': 'open' } },
      },
      { id: meter, symbol: 'meter', x, y: 260, rot: 0, name: `${i + 1}# 电表`, entity: { type: 'DEVICE', name: dev } },
      { id: junction, symbol: 'junction', x: x + 10, y: 340, rot: 0 }
    )
    wires.push(
      { id: `w${i * 3 + 1}`, from: { bus: 'b1', d: 140 + i * 200 }, to: { node: brk, port: 'a' } },
      { id: `w${i * 3 + 2}`, from: { node: brk, port: 'b' }, to: { node: meter, port: 'a' } },
      { id: `w${i * 3 + 3}`, from: { node: meter, port: 'b' }, to: { node: junction, port: 'n' } }
    )
    labels.push(
      {
        id: `l${i * 2 + 1}`,
        x: x + 50,
        y: 280,
        attach: meter,
        kind: 'value',
        pt: `p${i * 2 + 2}`,
        title: 'P',
        format: { digits: 1, unit: 'kW' },
      },
      { id: `l${i * 2 + 2}`, x: x - 10, y: 400, kind: 'text', text: `出线 ${i + 1}` }
    )
    bindings[`pt.p${i * 2 + 1}`] = ts(dev, 'breaker_status')
    bindings[`pt.p${i * 2 + 2}`] = ts(dev, 'P')
  }
  // 一个转了 90° 并镜像的断路器,用带手工拐点的线接回母线右端
  nodes.push({ id: 'n10', symbol: 'breaker', x: 820, y: 200, rot: 90, flip: true, name: '母联(旋转 90°)' })
  wires.push({
    id: 'w10',
    from: { bus: 'b1', d: 660 },
    to: { node: 'n10', port: 'a' },
    vertices: [
      [740, 160],
      [900, 160],
      [900, 220],
    ],
  })
  labels.push({ id: 'l7', x: 90, y: 80, kind: 'text', text: '10kV Ⅰ段母线', size: 14, color: 'a' })
  const doc: SldDoc = {
    v: 1,
    canvas: { w: 1200, h: 600, grid: 10 },
    nodes,
    buses: [{ id: 'b1', x1: 80, y1: 100, x2: 760, y2: 100, name: 'Ⅰ母', kv: 10 }],
    wires,
    labels,
    frames: [{ id: 'f1', x: 160, y: 130, w: 160, h: 290, title: 'LP1' }],
  }
  return { doc, bindings }
}
