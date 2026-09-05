// Live telemetry store: one WebSocket, per-device latest values + ring-buffered series.
import { reactive } from 'vue'
import { getToken, API_BASE } from '../api/tb'

const MAX_POINTS = 512 // 实时测点 ~40min@5s;兼容 5 分钟级一整天(288 点)/ 天级 90 天

export const store = reactive({
  status: 'connecting', // connecting | live | offline
  lastFrame: null,
  frames: 0,
  byName: {}, // name -> { latest: {k: v}, series: {k: [[ts, num], ...]} }
})

function ensure(name) {
  if (!store.byName[name]) store.byName[name] = { latest: {}, series: {} }
  return store.byName[name]
}

export function seedHistory(name, history) {
  const d = ensure(name)
  for (const [key, points] of Object.entries(history)) {
    d.series[key] = points.slice(-MAX_POINTS)
    if (points.length) d.latest[key] = points[points.length - 1][1]
  }
}

// 每次 connect 建独立 socket(大屏可能双身份取数:Public + 报表账号,各订各的设备)
export function connect(devices, token = null) {
  if (!devices.length) return
  // API_BASE 为绝对地址(自定义项目/单文件大屏直连 TB)时,WS 直接指向该主机
  const wsBase = /^https?:\/\//i.test(API_BASE)
    ? API_BASE.replace(/^http/i, 'ws')
    : `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}${API_BASE}`
  const ws = new WebSocket(`${wsBase}/api/ws/plugins/telemetry?token=${token || getToken()}`)
  const cmdToName = {}

  ws.onopen = () => {
    store.status = 'live'
    ws.send(
      JSON.stringify({
        tsSubCmds: devices.map((d, i) => {
          cmdToName[i + 1] = d.name
          ensure(d.name)
          return {
            entityType: d.entityType || 'DEVICE',
            entityId: d.id.id,
            scope: 'LATEST_TELEMETRY',
            cmdId: i + 1,
          }
        }),
      })
    )
  }

  ws.onmessage = ev => {
    const msg = JSON.parse(ev.data)
    const name = cmdToName[msg.subscriptionId]
    if (!name || !msg.data) return
    const d = ensure(name)
    store.lastFrame = Date.now()
    store.frames++
    for (const [key, arr] of Object.entries(msg.data)) {
      const [ts, raw] = arr[0]
      const num = parseFloat(raw)
      d.latest[key] = Number.isNaN(num) ? raw : num
      if (Number.isNaN(num)) continue
      const buf = d.series[key] || (d.series[key] = [])
      if (buf.length && buf[buf.length - 1][0] === ts) continue
      buf.push([ts, num])
      if (buf.length > MAX_POINTS) buf.splice(0, buf.length - MAX_POINTS)
    }
  }

  ws.onclose = () => {
    store.status = 'offline'
    setTimeout(() => connect(devices, token), 3000)
  }
  ws.onerror = () => ws.close()
}
