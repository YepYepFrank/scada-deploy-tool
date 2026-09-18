// T5.5 x6-adapter 的纯函数层:SldDoc → X6 cell 描述(plain JSON)→ SldDoc 往返;端口位置;母线拉伸;画布读回
import { describe, expect, it } from 'vitest'
import {
  busPoint,
  getSldSymbol,
  lookupSldSymbol,
  nodeBox,
  portPosition,
  registerBuiltinSldSymbols,
  type SldDoc,
  type SldNode,
  type SldRotation,
} from '@grid/scada-renderer'
import {
  BUS_THICK,
  cellsToDoc,
  diffGeometry,
  docToCells,
  labelToCell,
  nodeToCell,
  pickBusD,
  selectionOfCells,
  type SldBoxCell,
  type SldCell,
  type SldNodeCell,
  type SldWireCell,
} from '../src/sld-editor/x6-adapter'
import {
  addWire,
  applyGeometry,
  bestPort,
  busFromDrag,
  copyFragment,
  deleteSelection,
  flipSelection,
  frameFromDrag,
  moveSelection,
  pasteFragment,
  resizeBus,
  rotateSelection,
} from '../src/sld-editor/doc-ops'
import { makeMockContent } from '../src/sld-editor/dev/mock'

registerBuiltinSldSymbols()

const mockDoc = (): SldDoc => makeMockContent().doc
const viaJson = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T
const boxCell = (cells: SldCell[], id: string): SldBoxCell => cells.find(c => c.id === id) as SldBoxCell

describe('docToCells / cellsToDoc 往返', () => {
  it('mock 图(旋转 + 镜像节点、母线端 d、手工拐点、frames、两种标签)往返深相等', () => {
    const doc = mockDoc()
    const cells = docToCells(doc)
    expect(cellsToDoc(cells, doc)).toEqual(doc)
    // cell 描述是 plain JSON:过一遍 JSON 还是它
    expect(viaJson(cells)).toEqual(cells)
    expect(cellsToDoc(viaJson(cells), doc)).toEqual(doc)
  })

  it('四个旋转角 × 镜像、垂直母线、底图、各种可选字段都不丢', () => {
    const nodes: SldNode[] = []
    ;([0, 90, 180, 270] as SldRotation[]).forEach((rot, i) => {
      nodes.push({ id: `a${i}`, symbol: 'breaker', x: 100 * i, y: 0, rot })
      nodes.push({ id: `f${i}`, symbol: 'meter', x: 100 * i, y: 200, rot, flip: true, source: { kv: 10 } })
    })
    nodes.push({ id: 't1', symbol: 'no-such-symbol', x: 500, y: 500, rot: 90, portKv: { hv: 10, lv: 0.4 } })
    const doc: SldDoc = {
      v: 1,
      canvas: { w: 1920, h: 1080, grid: 10 },
      background: { src: 'data:image/png;base64,AAAA', opacity: 0.4, x: 10 },
      nodes,
      buses: [
        { id: 'bv', x1: 600, y1: 100, x2: 600, y2: 500, kv: 0.4 },
        { id: 'bh', x1: 0, y1: 400, x2: 20, y2: 400 }, // 长度 = 命中盒厚度:横竖不能靠宽高猜
      ],
      wires: [
        { id: 'w1', from: { node: 'a0', port: 'b' }, to: { bus: 'bv', d: 120 } },
        { id: 'w2', from: { bus: 'bh', d: 0 }, to: { node: 'f1', port: 'a' }, vertices: [[30, 300]] },
      ],
      labels: [
        { id: 'l1', x: 40, y: 60, kind: 'text', text: '标题', size: 20, color: '#fff' },
        { id: 'l2', x: 40, y: 90, kind: 'value', pt: 'p1', attach: 'a0', format: { map: { '0': '停止' } }, color: 'b' },
      ],
    }
    expect(cellsToDoc(docToCells(doc), doc)).toEqual(doc)
  })

  it('旧图没有 frames 字段:往返后也不多出来;有空数组则保留', () => {
    const doc = mockDoc()
    delete doc.frames
    expect('frames' in cellsToDoc(docToCells(doc), doc)).toBe(false)
    doc.frames = []
    expect(cellsToDoc(docToCells(doc), doc).frames).toEqual([])
  })

  it('不合约定的母线(反向 / 斜)没被动过就原样还回去', () => {
    const doc = mockDoc()
    doc.buses.push({ id: 'b2', x1: 500, y1: 500, x2: 100, y2: 500 }, { id: 'b3', x1: 0, y1: 0, x2: 300, y2: 40 })
    expect(cellsToDoc(docToCells(doc), doc).buses).toEqual(doc.buses)
  })

  it('cell 顺序:X6 节点在前、连线在后(连线引用的 cell 必须先建)', () => {
    const cells = docToCells(mockDoc())
    const firstEdge = cells.findIndex(c => c.shape === 'edge')
    expect(cells.slice(firstEdge).every(c => c.shape === 'edge')).toBe(true)
  })
})

describe('节点 cell', () => {
  it('不用 angle:宽高取 nodeBox(),左上角 = node.x / y', () => {
    for (const rot of [0, 90, 180, 270] as SldRotation[]) {
      const node: SldNode = { id: 'n', symbol: 'breaker', x: 130, y: 70, rot }
      const cell = nodeToCell(node)
      const box = nodeBox(node, getSldSymbol('breaker')!)
      expect([cell.x, cell.y, cell.width, cell.height]).toEqual([box.x, box.y, box.w, box.h])
      expect('angle' in cell).toBe(false)
    }
  })

  it('端口是 absolute 布局,节点位置 + 端口偏移 = portPosition()', () => {
    for (const symbol of ['breaker', 'meter', 'junction'])
      for (const rot of [0, 90, 180, 270] as SldRotation[])
        for (const flip of [false, true]) {
          const node: SldNode = { id: 'n', symbol, x: 250, y: 310, rot, flip }
          const def = getSldSymbol(symbol)!
          const cell = nodeToCell(node)
          expect(cell.ports.items.map(p => p.id)).toEqual(def.ports.map(p => p.id))
          for (const item of cell.ports.items) {
            expect(item.group).toBe('p')
            expect({ x: cell.x + item.args.x, y: cell.y + item.args.y }).toEqual(portPosition(node, def, item.id))
          }
        }
  })

  it('未知图元:占位框大小、没有端口', () => {
    const cell = nodeToCell({ id: 'n', symbol: 'nope', x: 0, y: 0, rot: 90 })
    expect([cell.width, cell.height, cell.ports.items.length]).toEqual([40, 40, 0])
  })
})

describe('母线与连线 cell', () => {
  it('母线节点:命中盒厚 BUS_THICK,中线就是母线;左上角落栅格', () => {
    const cells = docToCells(mockDoc())
    const bus = boxCell(cells, 'b1')
    expect([bus.x, bus.y, bus.width, bus.height]).toEqual([80, 100 - BUS_THICK / 2, 680, BUS_THICK])
    expect(bus.x % 10).toBe(0)
    expect(bus.y % 10).toBe(0)
  })

  it('母线端的 d 存在终端的 anchor 参数里;端口端存 cell + port', () => {
    const w = docToCells(mockDoc()).find(c => c.id === 'w1') as SldWireCell
    expect(w.source).toEqual({ cell: 'b1', anchor: { name: 'sld-bus', args: { d: 140 } } })
    expect(w.target).toEqual({ cell: 'n1', port: 'a' })
    expect(w.router).toEqual({ name: 'sld' })
    expect(w.connector).toEqual({ name: 'rounded', args: { radius: 4 } })
  })

  it('标签节点:y 是文字垂直中线;命中盒高度取偶数格', () => {
    const cell = labelToCell({ id: 'l', x: 40, y: 60, kind: 'text', text: 'abc' })
    expect(cell.y + cell.height / 2).toBe(60)
    expect(cell.height % 20).toBe(0)
    expect(
      labelToCell({ id: 'l', x: 0, y: 0, kind: 'value', pt: 'p', title: 'P', format: { unit: 'kW' } }).attrs.text!.text
    ).toBe('P -- kW')
  })
})

describe('画布读回:diffGeometry + applyGeometry', () => {
  it('没动过 → 空 patch(不落栅格的旧坐标也不会被顺手改掉)', () => {
    const doc = mockDoc()
    doc.labels[0]!.x = 253
    const p = diffGeometry(doc, docToCells(doc))
    expect(p).toEqual({ nodes: [], buses: [], labels: [], frames: [], wires: [] })
  })

  it('拖动节点:带浮点噪声的位置吸回栅格;依附的标签跟着走', () => {
    const doc = mockDoc()
    const cells = docToCells(doc)
    const n2 = boxCell(cells, 'n2')
    n2.x += 29.99999999999947
    n2.y += 40
    const patch = diffGeometry(doc, cells)
    expect(patch.nodes).toEqual([{ id: 'n2', x: 230, y: 300 }])
    const label = doc.labels.find(l => l.id === 'l1')!
    const was = { x: label.x, y: label.y }
    applyGeometry(doc, patch)
    expect(doc.nodes.find(n => n.id === 'n2')).toMatchObject({ x: 230, y: 300 })
    expect({ x: label.x, y: label.y }).toEqual({ x: was.x + 30, y: was.y + 40 })
    // 同步回画布后再比,应当没有差异
    expect(diffGeometry(doc, docToCells(doc)).nodes).toEqual([])
  })

  it('依附标签和节点一起被拖:标签不重复位移', () => {
    const doc = mockDoc()
    const cells = docToCells(doc)
    boxCell(cells, 'n2').x += 50
    boxCell(cells, 'l1').x += 50
    const was = doc.labels.find(l => l.id === 'l1')!.x
    applyGeometry(doc, diffGeometry(doc, cells))
    expect(doc.labels.find(l => l.id === 'l1')!.x).toBe(was + 50)
  })

  it('拐点:拖过的吸栅格;删光则去掉 vertices 字段;only 限定只读某个 cell', () => {
    const doc = mockDoc()
    const cells = docToCells(doc)
    const w10 = cells.find(c => c.id === 'w10') as SldWireCell
    w10.vertices[0] = { x: 743.2, y: 158.9 }
    boxCell(cells, 'n1').x += 10
    const patch = diffGeometry(doc, cells, new Set(['w10']))
    expect(patch.nodes).toEqual([])
    expect(patch.wires).toEqual([
      {
        id: 'w10',
        vertices: [
          [740, 160],
          [900, 160],
          [900, 220],
        ],
      },
    ])
    w10.vertices = []
    applyGeometry(doc, diffGeometry(doc, cells, new Set(['w10'])))
    expect('vertices' in doc.wires.find(w => w.id === 'w10')!).toBe(false)
  })

  it('分组框拉伸读回 x / y / w / h', () => {
    const doc = mockDoc()
    const cells = docToCells(doc)
    const f = boxCell(cells, 'f1')
    f.width += 40.3
    f.y -= 20
    f.height += 20
    applyGeometry(doc, diffGeometry(doc, cells))
    expect(doc.frames![0]).toEqual({ id: 'f1', x: 160, y: 110, w: 200, h: 310, title: 'LP1' })
  })
})

describe('母线拉伸:接点保持画面位置', () => {
  const tapPoints = (doc: SldDoc) =>
    doc.wires
      .flatMap(w => [w.from, w.to])
      .flatMap(e =>
        'bus' in e
          ? [
              busPoint(
                doc.buses.find(b => b.id === e.bus)!,
                e.d
              ),
            ]
          : []
      )

  it('从 (x1,y1) 端拉长 / 缩短:各接点的 d 统一加减位移,画面位置不变', () => {
    for (const dx of [-60, 40]) {
      const doc = mockDoc()
      const before = tapPoints(doc)
      const cells = docToCells(doc)
      const bus = boxCell(cells, 'b1')
      bus.x += dx // Transform 拖左端手柄:x 变、宽度反向变
      bus.width -= dx
      applyGeometry(doc, diffGeometry(doc, cells, new Set(['b1'])))
      expect(doc.buses[0]).toMatchObject({ x1: 80 + dx, y1: 100, x2: 760, y2: 100 })
      expect(tapPoints(doc)).toEqual(before)
      expect(doc.wires.find(w => w.id === 'w1')!.from).toEqual({ bus: 'b1', d: 140 - dx })
    }
  })

  it('从 (x2,y2) 端拉伸:d 不动;缩过了接点则夹到新端点', () => {
    const doc = mockDoc()
    const before = tapPoints(doc)
    resizeBus(doc, 'b1', { x1: 80, y1: 100, x2: 900, y2: 100 })
    expect(tapPoints(doc)).toEqual(before)
    resizeBus(doc, 'b1', { x1: 80, y1: 100, x2: 600, y2: 100 })
    expect(doc.wires.find(w => w.id === 'w10')!.from).toEqual({ bus: 'b1', d: 520 })
    expect(doc.wires.find(w => w.id === 'w1')!.from).toEqual({ bus: 'b1', d: 140 })
  })

  it('整体平移:d 不变', () => {
    const doc = mockDoc()
    const cells = docToCells(doc)
    const bus = boxCell(cells, 'b1')
    bus.x += 50
    bus.y += 30
    applyGeometry(doc, diffGeometry(doc, cells))
    expect(doc.buses[0]).toMatchObject({ x1: 130, y1: 130, x2: 810, y2: 130 })
    expect(doc.wires.find(w => w.id === 'w1')!.from).toEqual({ bus: 'b1', d: 140 })
  })

  it('垂直母线从上端拉伸同理', () => {
    const doc = mockDoc()
    doc.buses.push({ id: 'b2', x1: 1000, y1: 100, x2: 1000, y2: 400 })
    doc.wires.push({ id: 'w20', from: { bus: 'b2', d: 100 }, to: { node: 'n10', port: 'a' } })
    resizeBus(doc, 'b2', { x1: 1000, y1: 40, x2: 1000, y2: 400 })
    expect(busPoint(doc.buses[1]!, (doc.wires.at(-1)!.from as { d: number }).d)).toEqual({ x: 1000, y: 200 })
  })
})

describe('拖线落到母线上:pickBusD', () => {
  const bus = mockDoc().buses[0]!
  it('对端在母线范围内且离鼠标不远 → 取对端的垂足(线是直的)', () => {
    expect(pickBusD(bus, { x: 233, y: 104 }, { x: 220, y: 160 })).toBe(140)
  })
  it('对端离得远 / 不在范围内 → 取鼠标的垂足并吸附栅格、夹到两端', () => {
    expect(pickBusD(bus, { x: 433, y: 96 }, { x: 220, y: 160 })).toBe(350)
    expect(pickBusD(bus, { x: 20, y: 96 }, { x: 10, y: 160 })).toBe(0)
    expect(pickBusD(bus, { x: 2000, y: 96 }, undefined)).toBe(680)
  })
})

describe('doc-ops', () => {
  it('旋转:rot + 90,绕中心转且左上角仍落栅格;转 4 次回到原位', () => {
    const doc = mockDoc()
    const sel = { nodes: ['n1'], buses: [], wires: [], labels: [] }
    const start = { ...doc.nodes[0]! }
    rotateSelection(doc, sel, lookupSldSymbol)
    expect(doc.nodes[0]).toMatchObject({ rot: 90, x: 190, y: 170 })
    for (let i = 0; i < 3; i += 1) rotateSelection(doc, sel, lookupSldSymbol)
    expect(doc.nodes[0]).toEqual(start)
  })

  it('旋转母线:横竖互换,长度与 d 不变', () => {
    const doc = mockDoc()
    rotateSelection(doc, { nodes: [], buses: ['b1'], wires: [], labels: [] }, lookupSldSymbol)
    const b = doc.buses[0]!
    expect(b.x1).toBe(b.x2)
    expect(b.y2 - b.y1).toBe(680)
    expect(Math.abs(b.y1 % 10)).toBe(0)
  })

  it('镜像:切换 flip,false 时不留字段', () => {
    const doc = mockDoc()
    const sel = { nodes: ['n1'], buses: [], wires: [], labels: [] }
    flipSelection(doc, sel)
    expect(doc.nodes[0]!.flip).toBe(true)
    flipSelection(doc, sel)
    expect('flip' in doc.nodes[0]!).toBe(false)
  })

  it('微移:依附标签跟随;两端都动的线其拐点一起动', () => {
    const doc = mockDoc()
    moveSelection(doc, { nodes: ['n10', 'n2'], buses: ['b1'], wires: [], labels: [], frames: ['f1'] }, 10, -10)
    expect(doc.nodes.find(n => n.id === 'n10')).toMatchObject({ x: 830, y: 190 })
    expect(doc.labels.find(l => l.id === 'l1')).toMatchObject({ x: 260, y: 270 })
    expect(doc.wires.find(w => w.id === 'w10')!.vertices![0]).toEqual([750, 150])
    expect(doc.frames![0]).toMatchObject({ x: 170, y: 120 })
  })

  it('删除:连在上面的线、依附的标签一并删', () => {
    const doc = mockDoc()
    deleteSelection(doc, { nodes: ['n2'], buses: [], wires: [], labels: [], frames: ['f1'] })
    expect(doc.wires.map(w => w.id)).not.toContain('w2')
    expect(doc.wires.map(w => w.id)).not.toContain('w3')
    expect(doc.labels.map(l => l.id)).not.toContain('l1')
    expect(doc.frames).toEqual([])
    deleteSelection(doc, { nodes: [], buses: ['b1'], wires: [], labels: [] })
    expect(doc.wires.some(w => 'bus' in w.from)).toBe(false)
  })

  it('复制粘贴:id 重编、偏移 20、内部连线改指新节点、依附标签跟新节点;原件不动', () => {
    const doc = mockDoc()
    const snapshot = viaJson(doc)
    const frag = copyFragment(doc, { nodes: ['n1', 'n2'], buses: [], wires: [], labels: [], frames: ['f1'] })
    expect(frag.wires.map(w => w.id)).toEqual(['w2']) // 只带两端都在片段里的线
    expect(frag.labels.map(l => l.id)).toEqual(['l1'])
    let seq = 100
    const sel = pasteFragment(doc, frag, kind => `${kind}${(seq += 1)}`)
    expect(sel).toEqual({ nodes: ['n101', 'n102'], buses: [], wires: ['w103'], labels: ['l104'], frames: ['f105'] })
    expect(doc.nodes.find(n => n.id === 'n101')).toMatchObject({ x: 220, y: 180, symbol: 'breaker' })
    expect(doc.wires.find(w => w.id === 'w103')).toMatchObject({
      from: { node: 'n101', port: 'b' },
      to: { node: 'n102', port: 'a' },
    })
    expect(doc.labels.find(l => l.id === 'l104')).toMatchObject({ attach: 'n102', x: 270, y: 300 })
    expect(doc.frames!.at(-1)).toMatchObject({ id: 'f105', x: 180, y: 150 })
    expect(doc.nodes.slice(0, snapshot.nodes.length)).toEqual(snapshot.nodes)
    const ids = [...doc.nodes, ...doc.buses, ...doc.wires, ...doc.labels, ...doc.frames!].map(x => x.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('只复制标签:依附的节点不在片段里 → 贴出来的不再依附', () => {
    const doc = mockDoc()
    const frag = copyFragment(doc, { nodes: [], buses: [], wires: [], labels: ['l1'] })
    pasteFragment(doc, frag, () => 'l900')
    expect('attach' in doc.labels.at(-1)!).toBe(false)
  })

  it('画母线 / 分组框:吸栅格、归一成左上 → 右下;太短不建', () => {
    expect(busFromDrag({ x: 303, y: 98 }, { x: 96, y: 140 })).toEqual({ x1: 100, y1: 100, x2: 300, y2: 100 })
    expect(busFromDrag({ x: 100, y: 300 }, { x: 120, y: 95 })).toEqual({ x1: 100, y1: 100, x2: 100, y2: 300 })
    expect(busFromDrag({ x: 100, y: 100 }, { x: 108, y: 104 })).toBeUndefined()
    expect(frameFromDrag({ x: 200, y: 200 }, { x: 101, y: 99 })).toEqual({ x: 100, y: 100, w: 100, h: 100 })
    expect(frameFromDrag({ x: 0, y: 0 }, { x: 10, y: 200 })).toBeUndefined()
  })

  it('连接点四个端口叠在一起:按对端方向挑端口', () => {
    const node: SldNode = { id: 'j', symbol: 'junction', x: 100, y: 100, rot: 0 }
    const def = getSldSymbol('junction')!
    expect(bestPort(node, def, 'n', { x: 300, y: 110 })).toBe('e')
    expect(bestPort(node, def, 'n', { x: 110, y: 400 })).toBe('s')
    expect(bestPort({ ...node, rot: 90 }, def, 'n', { x: 300, y: 110 })).toBe('n') // 转 90° 后 n 朝东
    expect(
      bestPort({ id: 'b', symbol: 'breaker', x: 0, y: 0, rot: 0 }, getSldSymbol('breaker')!, 'a', { x: 0, y: 900 })
    ).toBe('a')
  })

  it('addWire:拒绝自连、母线连母线、重复线(不分方向)', () => {
    const doc = mockDoc()
    expect(addWire(doc, 'x1', { node: 'n1', port: 'a' }, { node: 'n1', port: 'a' })).toBe(false)
    expect(addWire(doc, 'x2', { bus: 'b1', d: 0 }, { bus: 'b1', d: 100 })).toBe(false)
    expect(addWire(doc, 'x3', { node: 'n1', port: 'a' }, { bus: 'b1', d: 140 })).toBe(false)
    expect(addWire(doc, 'x4', { node: 'n3', port: 's' }, { bus: 'b1', d: 300 })).toBe(true)
    expect(doc.wires.at(-1)).toEqual({ id: 'x4', from: { node: 'n3', port: 's' }, to: { bus: 'b1', d: 300 } })
  })
})

describe('selectionOfCells', () => {
  it('按 data.kind 分桶,忽略不是本适配器建的 cell', () => {
    const cells = docToCells(mockDoc()).filter(c => ['n1', 'b1', 'w1', 'l1', 'f1'].includes(c.id))
    const sel = selectionOfCells([...cells, { id: 'ghost' }, { id: 'draft', data: { kind: 'draft' } }])
    expect(sel).toEqual({ nodes: ['n1'], buses: ['b1'], wires: ['w1'], labels: ['l1'], frames: ['f1'] })
    expect((cells[0] as SldNodeCell | SldBoxCell).data.kind).toBeDefined()
  })
})
