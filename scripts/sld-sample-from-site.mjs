#!/usr/bin/env node
// 由站点声明(*.tbsite.json)生成一张示例一次接线图页面(T5.9 实测用;ADR-005)。
// 布局照现有一次图案例的习惯:10 kV 进线 → 主变 → 0.4 kV 主母线;按设备名前缀分组,每组一段竖母线 + 向右的水平出线
// (简化开关 → 出线箭头 → 数值标签)。设备有 switch_state 就绑开关状态,数值标签优先绑 P。
// 实体只写名字、id 留空,发布时按名解析(ADR-002)。
//   node scripts/sld-sample-from-site.mjs sites/xrs-mirror-test.tbsite.json out.pageconfig.json [--repeat N]
// --repeat N:每台设备重复 N 条出线(压测用,N 份绑定指向同一测点),缺省 1。
// --title 文字:页面标题,缺省「接线图实测 · <站点>」。
import { readFileSync, writeFileSync } from 'node:fs'

const [, , sitePath, outPath, ...rest] = process.argv
if (!sitePath || !outPath) {
  console.error('用法:node scripts/sld-sample-from-site.mjs <站点.tbsite.json> <输出.pageconfig.json> [--repeat N]')
  process.exit(2)
}
const opt = name => (rest.includes(name) ? rest[rest.indexOf(name) + 1] : undefined)
const repeat = Number(opt('--repeat')) > 0 ? Number(opt('--repeat')) : 1
const site = JSON.parse(readFileSync(sitePath, 'utf8'))
const siteName = site.site.name

const G = 10
const ROW = 40 // 出线行距
const COL_W = 400 // 每组一列的宽度
const COL_TOP = 260 // 竖母线起点 y

const nodes = []
const buses = []
const wires = []
const labels = []
const frames = []
const bindings = {}
let seq = 0
const id = p => `${p}${++seq}`
const ts = (name, key) => ({ mode: 'ts', entity: { type: 'DEVICE', id: '', name }, key })

// 按设备名前缀分组:SSP1_… / SSP2_… / PDR…
const groupOf = n => (/^PDR/.test(n) ? 'PDR' : n.split('_')[0])
const groups = new Map()
for (const d of site.devices)
  for (let r = 0; r < repeat; r++)
    (groups.get(groupOf(d.name)) ?? groups.set(groupOf(d.name), []).get(groupOf(d.name))).push(d)
const cols = [...groups]
const maxRows = Math.max(...cols.map(([, ds]) => ds.length))
const W = Math.max(1200, 120 + cols.length * COL_W)
const H = COL_TOP + maxRows * ROW + 80

// 进线 + 主变 + 主母线
const mid = Math.round(W / 2 / G) * G
const src = id('n')
nodes.push({ id: src, symbol: 'incoming-arrow', x: mid - 10, y: 10, rot: 0, name: '10kV 进线', source: { kv: 10 } })
const qf0 = id('n')
nodes.push({ id: qf0, symbol: 'breaker', x: mid - 20, y: 50, rot: 0, name: '进线柜' })
const tr = id('n')
nodes.push({
  id: tr,
  symbol: 'transformer-2w',
  x: mid - 20,
  y: 80 + 40,
  rot: 0,
  name: '1#主变',
  portKv: { hv: 10, lv: 0.4 },
})
// 进线箭头端口在下(y=30),断路器 a(20,0) / b(20,60),主变 hv(20,0) / lv(20,80)——都在 x = mid
wires.push({ id: id('w'), from: { node: src, port: 'a' }, to: { node: qf0, port: 'a' } })
wires.push({ id: id('w'), from: { node: qf0, port: 'b' }, to: { node: tr, port: 'hv' } })
// 主变位置随上面几何取整后再算母线:主变 lv 在 y = 120 + 80 = 200 → 主母线放在它下面
const mainBus = id('b')
const busY = 240
buses.push({ id: mainBus, x1: 60, y1: busY, x2: W - 60, y2: busY, name: '0.4kV 母线', kv: 0.4 })
wires.push({ id: id('w'), from: { node: tr, port: 'lv' }, to: { bus: mainBus, d: mid - 60 } })
labels.push({ id: id('l'), x: 60, y: busY - 16, kind: 'text', text: '0.4kV I 段', size: 12 })

cols.forEach(([gname, ds], ci) => {
  const colX = 80 + ci * COL_W // 竖母线 x
  const top = busY + 60
  const bottom = top + ds.length * ROW
  frames.push({ id: id('f'), x: colX - 30, y: top - 40, w: COL_W - 20, h: bottom - top + 70, title: gname })
  // 主母线 → 分段开关 → 竖母线
  const qfc = id('n')
  nodes.push({ id: qfc, symbol: 'switch-simple', x: colX - 10, y: busY + 10, rot: 0 })
  wires.push({ id: id('w'), from: { bus: mainBus, d: colX - 60 }, to: { node: qfc, port: 'a' } })
  const vb = id('b')
  buses.push({ id: vb, x1: colX, y1: top, x2: colX, y2: bottom, kv: 0.4 })
  wires.push({ id: id('w'), from: { node: qfc, port: 'b' }, to: { bus: vb, d: 0 } })

  ds.forEach((d, j) => {
    const y = top + ROW / 2 + j * ROW
    // 简化开关旋转 90°:包围盒 40×20,a 在东、b 在西
    const sw = id('n')
    const keys = d.keys.map(k => k.key)
    const node = {
      id: sw,
      symbol: 'switch-simple',
      x: colX + 20,
      y: y - 10,
      rot: 90,
      name: d.name,
      entity: { type: 'DEVICE', name: d.name },
    }
    if (keys.includes('switch_state')) {
      const pt = id('p')
      bindings[`pt.${pt}`] = ts(d.name, 'switch_state')
      node.state = { pt, map: { 1: 'closed', 0: 'open' } }
    }
    nodes.push(node)
    wires.push({ id: id('w'), from: { bus: vb, d: y - top }, to: { node: sw, port: 'b' } })
    // 出线箭头旋转 270°:包围盒 30×20,端口 a 在西
    const ar = id('n')
    nodes.push({ id: ar, symbol: 'feeder-arrow', x: colX + 100, y: y - 10, rot: 270 })
    wires.push({ id: id('w'), from: { node: sw, port: 'a' }, to: { node: ar, port: 'a' } })
    const vk = keys.includes('P') ? 'P' : keys[0]
    if (vk) {
      const pt = id('p')
      bindings[`pt.${pt}`] = ts(d.name, vk)
      const unit = d.keys.find(k => k.key === vk)?.unit
      const short = d.name.replace(/_IED\d+$/, '').replace(/^(SSP\d_|PDR)/, m => (m.startsWith('PDR') ? 'PDR' : ''))
      labels.push({
        id: id('l'),
        x: colX + 150,
        y,
        attach: sw,
        kind: 'value',
        pt,
        title: short,
        format: { digits: 1, ...(unit ? { unit } : {}) },
        size: 12,
      })
    }
  })
})

const doc = { v: 1, canvas: { w: W, h: H, grid: G }, nodes, buses, wires, labels, frames }
const page = {
  schemaVersion: 1,
  template: 'monitor-3col',
  title: opt('--title') ?? `接线图实测 · ${siteName}`,
  widgets: [
    {
      id: 'w_sld_main',
      slot: 'main',
      type: 'sld',
      props: { doc, staleSeconds: 600, showNames: false },
      bindings: { ...bindings, alarms: [{ mode: 'alarm', entity: { type: 'ASSET', id: '', name: siteName } }] },
    },
  ],
}
writeFileSync(outPath, JSON.stringify(page, null, 2) + '\n')
const pts = Object.keys(bindings).length
console.log(
  `${outPath}:节点 ${nodes.length} · 母线 ${buses.length} · 连线 ${wires.length} · 标签 ${labels.length} · 分组 ${frames.length} · 测点绑定 ${pts} · ${(JSON.stringify(page).length / 1024).toFixed(1)} KB`
)
