/**
 * X6 3.x 画布装配(ADR-005 Spike A 的做法):形状 / anchor / router 注册、Graph 选项、插件。
 * 3.x 的插件(Snapline / Selection / MiniMap / Dnd / Transform)全部在主包 `@antv/x6` 里,样式由插件自己注入。
 * **不用 History / Keyboard / Clipboard 插件**:撤销的是文档(store.ts),快捷键与剪贴板也在文档层做。
 * `async: false`:异步渲染在清空 / 重载后会残留旧视图(Spike A)。
 *
 * 这里只管「画布长什么样、能怎么拖」;用户操作怎么落回文档在 SldEditor.vue(经 x6-adapter 的 read* 与 store.apply)。
 */
import {
  Dnd,
  Graph,
  MiniMap,
  Point,
  Selection,
  Snapline,
  Transform,
  type Cell,
  type EdgeView,
  type Node,
  type NodeView,
} from '@antv/x6'
import { register } from '@antv/x6-vue-shape'
import { SLD_GRID, busOffset, busPoint, getSldSymbol, isFreeSizeSymbol, type SldPoint } from '@grid/scada-renderer'
import SldNodeView from './SldNodeView.vue'
import {
  BUS_ANCHOR,
  BUS_THICK,
  PORT_GROUP,
  SHAPE_BUS,
  SHAPE_FRAME,
  METER_BG,
  METER_EMPTY_INK,
  METER_INK,
  METER_LINE,
  SHAPE_LABEL,
  SHAPE_NODE,
  busAttrs,
  busOfCell,
  nodeToCell,
  pickBusD,
  snapshotOf,
  wireBase,
  type SldCellKind,
} from './x6-adapter'
import { registerSldRouter, SLD_CONNECTOR, SLD_ROUTER } from './x6-router'

export const kindOfCell = (cell: Cell | null | undefined): SldCellKind | 'draft' | 'dnd' | undefined =>
  (cell?.getData() as { kind?: SldCellKind | 'draft' | 'dnd' } | undefined)?.kind

const isBusCell = (cell: Cell | null | undefined): cell is Node => !!cell && cell.isNode() && cell.shape === SHAPE_BUS
const isSymbolCell = (cell: Cell | null | undefined): cell is Node =>
  !!cell && cell.isNode() && cell.shape === SHAPE_NODE

/** 拖线预览时母线 anchor 要知道鼠标在哪(落点规则 pickBusD 要用),按 graph 记一份 */
const lastMouse = new WeakMap<Graph, SldPoint>()

let registered = false
function registerOnce(): void {
  if (registered) return
  registered = true
  registerSldRouter(Graph)

  // ① 图元 = Vue 组件节点(Teleport 模式,挂在编辑器这一个 app 下)。端口 absolute 布局,坐标由 adapter 按 portPosition 给
  register({
    shape: SHAPE_NODE,
    component: SldNodeView,
    width: 40,
    height: 40,
    attrs: { fo: { style: 'overflow: visible' } },
    ports: {
      groups: {
        [PORT_GROUP]: {
          position: 'absolute',
          attrs: {
            circle: { r: 4, magnet: true, class: 'sld-port', fill: '#0b1a33', stroke: '#19b7ff', strokeWidth: 1 },
          },
        },
      },
    },
  })

  // ② 母线:普通 SVG 节点,透明命中区 + 粗线(横竖靠 attrs 切换,不用 angle)
  Graph.registerNode(
    SHAPE_BUS,
    {
      inherit: 'rect',
      markup: [
        { tagName: 'rect', selector: 'hit' },
        { tagName: 'rect', selector: 'body' },
        { tagName: 'text', selector: 'label' },
      ],
      attrs: {
        ...busAttrs(true),
        body: { ...busAttrs(true).body, fill: 'currentColor', stroke: 'none', class: 'sld-bus-line' },
        label: {
          text: '',
          refX: 0,
          refY: -8,
          fontSize: 11,
          fill: '#8fb3e0',
          textAnchor: 'start',
          pointerEvents: 'none',
        },
      },
    },
    true
  )

  // ③ 标签:透明命中盒 + 左对齐、垂直居中的文字(与运行时 <text dominant-baseline="middle"> 对齐)
  Graph.registerNode(
    SHAPE_LABEL,
    {
      inherit: 'rect',
      markup: [
        { tagName: 'rect', selector: 'hit' },
        { tagName: 'text', selector: 'text' },
        // 数码框(2026-09-23):框 + 垫底的「8」+ 亮的段 + 单位;纯文字标签把这四个藏起来
        { tagName: 'rect', selector: 'box' },
        { tagName: 'path', selector: 'ghost' },
        { tagName: 'path', selector: 'digits' },
        { tagName: 'text', selector: 'unit' },
      ],
      attrs: {
        hit: { refWidth: '100%', refHeight: '100%', fill: 'transparent', stroke: 'none' },
        box: { display: 'none', rx: 1.5, fill: METER_BG, stroke: METER_LINE, strokeWidth: 1 },
        ghost: { display: 'none', fill: METER_INK, fillOpacity: 0.07, stroke: 'none' },
        digits: { display: 'none', fill: METER_EMPTY_INK, stroke: 'none' },
        unit: {
          display: 'none',
          refY: '50%',
          fontSize: 12,
          fill: '#c9d8ee',
          textAnchor: 'start',
          textVerticalAnchor: 'middle',
        },
        text: {
          text: '',
          refX: 0,
          refY: '50%',
          fontSize: 12,
          fill: '#c9d8ee',
          textAnchor: 'start',
          textVerticalAnchor: 'middle',
        },
      },
    },
    true
  )

  // ④ 分组框:虚线矩形 + 标题。只有边框(10px 透明描边)和标题能点中,框里面的空白照样能框选 / 点到里面的元素
  Graph.registerNode(
    SHAPE_FRAME,
    {
      inherit: 'rect',
      markup: [
        { tagName: 'rect', selector: 'hit' },
        { tagName: 'rect', selector: 'body' },
        { tagName: 'text', selector: 'title' },
      ],
      attrs: {
        hit: {
          refWidth: '100%',
          refHeight: '100%',
          fill: 'none',
          stroke: 'transparent',
          strokeWidth: 10,
          pointerEvents: 'stroke',
        },
        body: {
          refWidth: '100%',
          refHeight: '100%',
          fill: 'none',
          stroke: '#5b7aa8',
          strokeWidth: 1,
          strokeDasharray: '6 4',
          pointerEvents: 'none',
        },
        title: { text: '', refX: 6, refY: -9, fontSize: 12, fill: '#8fb3e0', textAnchor: 'start' },
      },
    },
    true
  )

  // ⑤ anchor:端口 → 端口中心;母线 → 按终端参数里的 d 调 busPoint();没有 d(正在拖的线)→ 按落点规则预览
  Graph.registerAnchor(
    BUS_ANCHOR,
    function (this: EdgeView, view: NodeView, magnet: SVGElement, ref, args: { d?: number }) {
      const cell = view.cell
      const bus = isBusCell(cell) && magnet === view.container ? busOfCell(snapshotOf(cell)) : undefined
      if (!bus) return view.getBBoxOfElement(magnet).getCenter()
      if (typeof args.d === 'number') {
        const p = busPoint(bus, args.d)
        return new Point(p.x, p.y)
      }
      let other: SldPoint | undefined
      if (ref instanceof Element) {
        const rv = this.graph.findViewByElem(ref)
        other = rv ? rv.getBBoxOfElement(ref).getCenter() : undefined
      } else other = { x: ref.x, y: ref.y }
      const mouse = lastMouse.get(this.graph) ?? other
      const d = mouse ? pickBusD(bus, mouse, other) : busOffset(bus, { x: bus.x1, y: bus.y1 })
      const p = busPoint(bus, d)
      return new Point(p.x, p.y)
    },
    true
  )
}

export interface SldCanvasOptions {
  isReadonly: () => boolean
  /** 图元面板拖进来落下:at = 节点左上角(已吸附栅格) */
  onDropSymbol: (symbolId: string, at: SldPoint) => void
}

export interface SldCanvas {
  graph: Graph
  /** 从图元面板按下鼠标开始拖 */
  startSymbolDrag: (symbolId: string, e: MouseEvent) => void
  dispose: () => void
}

export function createSldCanvas(container: HTMLElement, minimap: HTMLElement, opts: SldCanvasOptions): SldCanvas {
  registerOnce()
  const editable = (): boolean => !opts.isReadonly()

  const graph = new Graph({
    container,
    // 盯着外层包装元素的尺寸(盯 container 自己的话,X6 给它写死宽高之后就再也缩不回去)
    autoResize: container.parentElement ?? true,
    background: false,
    grid: { size: SLD_GRID, visible: true, type: 'dot', args: { color: 'rgba(120, 160, 210, 0.35)', thickness: 1 } },
    async: false,
    // 平移自己做(见下面 installPan):要同时支持「空格 + 左键」和「右键」,X6 的 panning 配不出这个组合
    panning: false,
    mousewheel: { enabled: true, factor: 1.1, minScale: 0.1, maxScale: 4, zoomAtMousePosition: true },
    scaling: { min: 0.1, max: 4 },
    preventDefaultContextMenu: true,
    interacting: () =>
      editable()
        ? { nodeMovable: true, edgeMovable: false, edgeLabelMovable: false, magnetConnectable: true }
        : { nodeMovable: false, edgeMovable: false, edgeLabelMovable: false, magnetConnectable: false },
    highlighting: {
      magnetAvailable: { name: 'stroke', args: { attrs: { stroke: '#22c55e', 'stroke-width': 2 } } },
      magnetAdsorbed: { name: 'stroke', args: { attrs: { stroke: '#f59e0b', 'stroke-width': 3 } } },
    },
    connecting: {
      snap: { radius: 24, anchor: 'bbox' },
      allowBlank: false,
      allowLoop: false,
      allowMulti: true,
      allowPort: true,
      allowEdge: false,
      // 只有母线节点整体可作为终点;图元必须接端口。函数形式对每个候选终端都会被调,要自己先判类型(Spike A)
      allowNode: ({ targetCell, sourceCell, type }) => isBusCell(type === 'source' ? sourceCell : targetCell),
      highlight: true,
      anchor: BUS_ANCHOR,
      connectionPoint: 'anchor',
      router: { name: SLD_ROUTER },
      connector: { ...SLD_CONNECTOR },
      createEdge() {
        // 草稿线:落定后由编辑器读成 SldWire、经 store.apply 进文档,再由 syncGraph 建正式的线;草稿随即删掉
        return this.createEdge({ ...wireBase(), data: { kind: 'draft' } })
      },
      validateMagnet: () => editable(),
      validateConnection({ sourceCell, targetCell, sourceMagnet, targetMagnet }) {
        if (!sourceCell || !targetCell || sourceCell === targetCell) return false
        if (isBusCell(sourceCell) && isBusCell(targetCell)) return false
        if (isSymbolCell(sourceCell) && !sourceMagnet) return false
        if (isSymbolCell(targetCell) && !targetMagnet) return false
        return (
          (isBusCell(sourceCell) || isSymbolCell(sourceCell)) && (isBusCell(targetCell) || isSymbolCell(targetCell))
        )
      },
    },
  })

  graph
    .use(new Snapline({ enabled: true, resizing: true, tolerance: 8 }))
    .use(
      new Selection({
        enabled: true,
        multiple: true,
        rubberband: true,
        rubberEdge: true,
        movable: true,
        // 严格框选:完全框住才算——不然在分组框 / 长母线里面拉个小框也会把它们选上
        strict: true,
        showNodeSelectionBox: true,
        showEdgeSelectionBox: false,
        // 选中框不挡事件:否则选中后点不到端口(Spike A)
        pointerEvents: 'none',
      })
    )
    .use(
      new Transform({
        resizing: {
          // 图元也能拖拉改大小(2026-09-21):锁定宽高比,松手后吸附到最近的合法倍数(见 ops.resizeNodeByBox)
          enabled: node =>
            editable() && (node.shape === SHAPE_BUS || node.shape === SHAPE_FRAME || node.shape === SHAPE_NODE),
          orthogonal: true,
          // 设备框这类 freeBody 图元可以随便拉长宽(2026-09-22);其余图元仍锁宽高比、松手吸附到合法倍数
          preserveAspectRatio: node => node.shape === SHAPE_NODE && !isFreeSizeNode(node),
          minWidth: node =>
            node.shape === SHAPE_NODE
              ? SLD_GRID
              : node.shape === SHAPE_BUS && !isHorizontalBus(node)
                ? BUS_THICK
                : 2 * SLD_GRID,
          maxWidth: node => (node.shape === SHAPE_BUS && !isHorizontalBus(node) ? BUS_THICK : Number.MAX_SAFE_INTEGER),
          minHeight: node =>
            node.shape === SHAPE_NODE
              ? SLD_GRID
              : node.shape === SHAPE_BUS && isHorizontalBus(node)
                ? BUS_THICK
                : 2 * SLD_GRID,
          maxHeight: node => (node.shape === SHAPE_BUS && isHorizontalBus(node) ? BUS_THICK : Number.MAX_SAFE_INTEGER),
        },
        rotating: false,
      })
    )
    .use(
      new MiniMap({
        container: minimap,
        width: 200,
        height: 130,
        padding: 10,
        scalable: false,
        graphOptions: { async: false },
      })
    )

  const onMouseMove = (e: MouseEvent): void => {
    const p = graph.clientToLocal(e.clientX, e.clientY)
    lastMouse.set(graph, { x: p.x, y: p.y })
  }
  container.addEventListener('mousemove', onMouseMove)
  const uninstallPan = installPan(container, graph)

  const dnd = new Dnd({
    target: graph,
    scaled: false,
    getDragNode: node => node.clone({ keepId: false }),
    getDropNode: node => node.clone({ keepId: false }),
    // 不让 Dnd 自己往画布里加节点:图的真相是文档。这里拿到落点(已吸附栅格),交给编辑器走 store.apply
    validateNode: dropping => {
      const symbol = (dropping.getData() as { node?: { symbol?: string } } | undefined)?.node?.symbol
      const { x, y } = dropping.getPosition()
      if (symbol) opts.onDropSymbol(symbol, { x, y })
      return false
    },
  })

  return {
    graph,
    startSymbolDrag(symbolId, e) {
      if (!editable() || !getSldSymbol(symbolId)) return
      const cell = nodeToCell({ id: 'dnd', symbol: symbolId, x: 0, y: 0, rot: 0 })
      const { id: _id, ...meta } = cell
      dnd.start(graph.createNode({ ...meta, data: { kind: 'dnd', node: cell.data.node } }), e)
    },
    dispose() {
      container.removeEventListener('mousemove', onMouseMove)
      uninstallPan()
      dnd.dispose()
      graph.dispose()
    },
  }
}

/** 这个节点是不是能自由改宽高的图元(设备框):拖手柄时不锁宽高比 */
const isFreeSizeNode = (node: Node): boolean => {
  const n = (node.getData() as { node?: { symbol?: string } } | undefined)?.node
  return isFreeSizeSymbol(n?.symbol ? getSldSymbol(n.symbol) : undefined)
}

const isHorizontalBus = (node: Node): boolean =>
  (node.getData() as { horizontal?: boolean } | undefined)?.horizontal !== false

/**
 * 平移:右键 / 中键拖,或按住空格用左键拖。在捕获阶段拦下 mousedown,X6 就不会同时开始框选 / 拖节点。
 * 返回卸载函数。
 */
function installPan(container: HTMLElement, graph: Graph): () => void {
  let space = false
  let last: { x: number; y: number } | null = null
  const isTyping = (t: EventTarget | null): boolean => {
    const el = t as HTMLElement | null
    return (
      !!el && typeof el.tagName === 'string' && (/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) || el.isContentEditable)
    )
  }
  const onKeyDown = (e: KeyboardEvent): void => {
    if (e.code !== 'Space' || isTyping(e.target)) return
    space = true
    container.classList.add('sld-pannable')
    // 空格会滚动页面 / 触发聚焦按钮的点击
    if (container.matches(':hover')) e.preventDefault()
  }
  const onKeyUp = (e: KeyboardEvent): void => {
    if (e.code !== 'Space') return
    space = false
    container.classList.remove('sld-pannable')
  }
  const onMove = (e: MouseEvent): void => {
    if (!last) return
    graph.translateBy(e.clientX - last.x, e.clientY - last.y)
    last = { x: e.clientX, y: e.clientY }
  }
  const onUp = (): void => {
    last = null
    container.classList.remove('sld-panning')
    document.removeEventListener('mousemove', onMove, true)
    document.removeEventListener('mouseup', onUp, true)
  }
  const onDown = (e: MouseEvent): void => {
    if (!(e.button === 2 || e.button === 1 || (e.button === 0 && space))) return
    e.stopPropagation()
    e.preventDefault()
    last = { x: e.clientX, y: e.clientY }
    container.classList.add('sld-panning')
    document.addEventListener('mousemove', onMove, true)
    document.addEventListener('mouseup', onUp, true)
  }
  const onBlur = (): void => {
    space = false
    container.classList.remove('sld-pannable')
  }
  container.addEventListener('mousedown', onDown, true)
  window.addEventListener('keydown', onKeyDown)
  window.addEventListener('keyup', onKeyUp)
  window.addEventListener('blur', onBlur)
  return () => {
    onUp()
    container.removeEventListener('mousedown', onDown, true)
    window.removeEventListener('keydown', onKeyDown)
    window.removeEventListener('keyup', onKeyUp)
    window.removeEventListener('blur', onBlur)
  }
}
