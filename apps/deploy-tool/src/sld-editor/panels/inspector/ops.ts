/**
 * 属性面板里「电气参数」的草稿修改(纯函数,可单测):电源点与其电压等级、母线电压等级、变压器各侧电压等级。
 * 带电着色按这些 kv 取色(ADR-005 D11);不填也能算带电,只是颜色退回主题强调色。
 * kv 传 undefined / 非正数 = 清掉该字段。
 */
import type { SldDoc } from '@grid/scada-renderer'

const validKv = (kv: number | undefined): kv is number => typeof kv === 'number' && Number.isFinite(kv) && kv > 0

/** 设 / 取消电源点;on 为 true 时 kv 可选 */
export function setNodeSource(doc: SldDoc, nodeId: string, on: boolean, kv?: number): boolean {
  const n = doc.nodes.find(x => x.id === nodeId)
  if (!n) return false
  if (!on) {
    if (!n.source) return false
    delete n.source
    return true
  }
  n.source = validKv(kv) ? { kv } : {}
  return true
}

/** 母线电压等级 */
export function setBusKv(doc: SldDoc, busId: string, kv: number | undefined): boolean {
  const b = doc.buses.find(x => x.id === busId)
  if (!b) return false
  if (validKv(kv)) b.kv = kv
  else if ('kv' in b) delete b.kv
  else return false
  return true
}

/** 变压器某一侧(端口)的电压等级;两侧都清空时去掉 portKv 字段 */
export function setPortKv(doc: SldDoc, nodeId: string, port: string, kv: number | undefined): boolean {
  const n = doc.nodes.find(x => x.id === nodeId)
  if (!n) return false
  const next = { ...(n.portKv ?? {}) }
  if (validKv(kv)) next[port] = kv
  else if (port in next) delete next[port]
  else return false
  if (Object.keys(next).length) n.portKv = next
  else delete n.portKv
  return true
}

/** 输入框文本 → kv(空串 / 非法 → undefined) */
export function parseKv(text: string): number | undefined {
  const v = Number(text.trim())
  return text.trim() && Number.isFinite(v) && v > 0 ? v : undefined
}
