/** 接线图接入测试的样例:按节点数生成一张大图(每间隔 3 节点 / 3 连线 / 2 标签 / 2 测点)。 */
import type { Binding, SldLabel, SldNode, SldWire } from '@grid/scada-renderer'
import type { SldEditorContent } from '../src/sld-editor/ext'

const ts = (name: string, key: string): Binding => ({ mode: 'ts', entity: { type: 'DEVICE', id: '', name }, key })

/** nodes = 目标节点数(向上取到 3 的倍数) */
export function bigContent(nodes: number): SldEditorContent {
  const bays = Math.ceil(nodes / 3)
  const ns: SldNode[] = []
  const ws: SldWire[] = []
  const ls: SldLabel[] = []
  const bindings: Record<string, Binding> = {}
  for (let i = 0; i < bays; i += 1) {
    const x = 100 + i * 60
    const dev = `PDR1_LP${i + 1}_IED1`
    const [brk, meter, junction] = [`n${i * 3 + 1}`, `n${i * 3 + 2}`, `n${i * 3 + 3}`]
    ns.push(
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
    ws.push(
      { id: `w${i * 3 + 1}`, from: { bus: 'b1', d: 40 + i * 60 }, to: { node: brk, port: 'a' } },
      { id: `w${i * 3 + 2}`, from: { node: brk, port: 'b' }, to: { node: meter, port: 'a' } },
      { id: `w${i * 3 + 3}`, from: { node: meter, port: 'b' }, to: { node: junction, port: 'n' } }
    )
    ls.push(
      { id: `l${i * 2 + 1}`, kind: 'text', x, y: 130, text: `${i + 1}# 出线`, attach: brk },
      { id: `l${i * 2 + 2}`, kind: 'value', x: x + 30, y: 270, pt: `p${i * 2 + 2}`, title: 'P', attach: meter }
    )
    bindings[`pt.p${i * 2 + 1}`] = ts(dev, 'breaker_status')
    bindings[`pt.p${i * 2 + 2}`] = ts(dev, 'active_power_total')
  }
  return {
    doc: {
      v: 1,
      canvas: { w: 200 + bays * 60, h: 900, grid: 10 },
      nodes: ns,
      buses: [{ id: 'b1', x1: 60, y1: 100, x2: 140 + bays * 60, y2: 100 }],
      wires: ws,
      labels: ls,
    },
    bindings,
  }
}
