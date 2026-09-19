/**
 * 从设备树拖设备进画布(T5.6):DataTransfer 的类型与数据形状、落点处建节点。
 * 图元由 device-defaults 决定;测点 key 经 ctx.host.client 取(拿不到就只建节点不加测点)。
 */
import { getSldSymbol, type SldPoint } from '@grid/scada-renderer'
import type { EntityRef } from '@grid/tb-client'
import type { MetaNode } from '../../../meta/MetaNode'
import { defaultPoints, pickSymbol, type DefaultPoints } from '../../device-defaults'
import type { SldEditorContext } from '../../ext'
import { dropEntity, findEntityByName } from './ops'

export const ENTITY_DRAG_TYPE = 'application/x-grid-entity'

export interface EntityDragData {
  type: 'DEVICE' | 'ASSET'
  name: string
  deviceType?: string
}

/** 拖动数据:从设备树的节点来 */
export const dragDataOf = (n: MetaNode): EntityDragData | undefined =>
  n.entity
    ? { type: n.entity.type, name: n.entity.name || n.name, ...(n.profile ? { deviceType: n.profile } : {}) }
    : undefined

/** 解析 DataTransfer 里的字符串;形状不对返回 undefined */
export function parseEntityDragData(raw: string): EntityDragData | undefined {
  try {
    const x = JSON.parse(raw) as Partial<EntityDragData> | null
    if (!x || (x.type !== 'DEVICE' && x.type !== 'ASSET') || typeof x.name !== 'string' || !x.name) return undefined
    return {
      type: x.type,
      name: x.name,
      ...(typeof x.deviceType === 'string' && x.deviceType ? { deviceType: x.deviceType } : {}),
    }
  } catch {
    return undefined
  }
}

/** 设备实际有的遥测 key;没有 client / 树上找不到实体 id / 请求失败 → 空 */
async function availableKeys(ctx: SldEditorContext, ref: EntityRef | undefined): Promise<string[]> {
  const client = ctx.host.client
  if (!client || !ref?.id) return []
  try {
    return (await client.tsKeys(ref)).map(k => k.key)
  } catch {
    return []
  }
}

/**
 * 在 at 处放一台设备:选图元 → 取 key → 挑默认测点 → 一笔 apply(一步撤销)→ 选中新节点。
 * 返回新节点 id;只读 / 被回滚时返回 undefined。
 */
export async function placeEntity(
  ctx: SldEditorContext,
  data: EntityDragData,
  at: SldPoint
): Promise<string | undefined> {
  if (ctx.readonly.value) return undefined
  const hit = findEntityByName(ctx.host.tree, data.type, data.name)
  const deviceType = data.deviceType ?? hit?.profile
  const symbol = getSldSymbol(pickSymbol({ name: data.name, deviceType })) ?? getSldSymbol('device-box')
  if (!symbol) return undefined
  const ref: EntityRef | undefined = hit ? { type: hit.type, id: hit.id, name: hit.name } : undefined
  const keys = await availableKeys(ctx, ref)
  const points: DefaultPoints = keys.length ? defaultPoints(symbol.id, keys) : { labels: [] }
  let id: string | undefined
  const ok = ctx.apply(d => {
    id = dropEntity(
      d,
      { entity: { type: data.type, name: data.name }, ref, symbol, at, points },
      kind => ctx.newId(kind),
      getSldSymbol
    )
  }, `放置设备 ${data.name}`)
  if (!ok || !id) return undefined
  ctx.select({ nodes: [id] })
  return id
}

/**
 * 「放到画布中央」的落点:契约里没有「当前视口中心」,取画布(doc.canvas)中央,
 * 已被别的节点占着就沿右下斜向错开 20,免得连放几台叠在一起。
 */
export function centerSpot(ctx: SldEditorContext): SldPoint {
  const { doc } = ctx.content.value
  const grid = doc.canvas.grid > 0 ? doc.canvas.grid : 10
  const snap = (v: number): number => Math.round(v / grid) * grid
  const p = { x: snap(doc.canvas.w / 2), y: snap(doc.canvas.h / 2) }
  const taken = new Set(doc.nodes.map(n => `${n.x},${n.y}`))
  for (let i = 0; i < 50 && taken.has(`${p.x},${p.y}`); i += 1) {
    p.x += 2 * grid
    p.y += 2 * grid
  }
  return p
}
