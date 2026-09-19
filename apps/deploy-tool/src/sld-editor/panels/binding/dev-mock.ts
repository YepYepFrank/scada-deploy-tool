/**
 * 绑定面板自测用的假宿主(T5.6):一棵假设备树 + 返回固定 key 列表的假 MetaClient + 几个测点中文名。
 * 不连网络。设备名与 dev/mock.ts 的 mock 图对得上(PDR1_LP1..3_IED1),另加电表 / PCS / BMS / 光伏 / 充电桩 / 变压器 / 除湿机
 * 供试拖入规则。接进独立开发入口(dev/DevHost.vue):
 *   const host: SldEditorHost = { siteName: 'mock-site', ...mockHost() }
 */
import type { EntityRef } from '@grid/tb-client'
import { buildMetaTree, MetaClient, type KeyInfo, type TbDevice } from '../../../meta/MetaNode'
import type { SldEditorHost } from '../../ext'

const IED_KEYS = ['switch_state', 'P', 'Q', 'Ia', 'Ib', 'Ic', 'Uab', 'Ubc', 'Uca', 'F', 'breaker_status']
const KEYS_BY_KIND: Record<string, string[]> = {
  IED: IED_KEYS,
  METER: ['P', 'Q', 'Ia', 'Ib', 'Ic', 'Ua', 'Ub', 'Uc', 'PF', 'EPI'],
  PCS: ['P', 'Q', 'Udc', 'Idc', 'F', 'run_state'],
  BMS: ['SOC', 'SOH', 'U', 'I', 'P', 'max_cell_temp'],
  PV: ['P', 'Q', 'Udc', 'Idc', 'F', 'day_energy'],
  CHARGER: ['P', 'U', 'I', 'gun_state'],
  TR: ['P', 'Q', 'Ia', 'Ib', 'Ic', 'PF', 'oil_temp'],
  OTHER: ['run_state', 'temp', 'humidity'],
}

interface MockDevice {
  name: string
  kind: keyof typeof KEYS_BY_KIND
  label?: string
}
const GATEWAY = { id: 'gw-1', name: 'PDR1_GW', label: '1# 配电房网关' }
const DEVICES: MockDevice[] = [
  { name: 'PDR1_LP1_IED1', kind: 'IED', label: '1# 出线保护' },
  { name: 'PDR1_LP2_IED1', kind: 'IED', label: '2# 出线保护' },
  { name: 'PDR1_LP3_IED1', kind: 'IED', label: '3# 出线保护' },
  { name: 'PDR1_LP4_IED1', kind: 'IED', label: '4# 出线保护' },
  { name: 'PDR1_METER1', kind: 'METER', label: '关口电表' },
  { name: 'ESS_PCS1', kind: 'PCS', label: '储能变流器' },
  { name: 'ESS_BMS1', kind: 'BMS', label: '电池堆' },
  { name: 'PV_INV1', kind: 'PV', label: '1# 光伏逆变器' },
  { name: 'EV_CHARGER1', kind: 'CHARGER', label: '1# 充电桩' },
  { name: 'TR1', kind: 'TR', label: '1# 主变' },
  { name: 'DEHUMIDIFIER1', kind: 'OTHER', label: '除湿机' },
]

const idOf = (name: string): string => `mock-${name}`

/** 不连网络的 MetaClient:tsKeys 按设备种类给固定 key 列表(带假最近值);属性 / 告警给空 */
class MockMetaClient extends MetaClient {
  constructor() {
    super(() => Promise.reject(new Error('mock:不连网络')))
  }
  override tsKeys(entity: EntityRef): Promise<KeyInfo[]> {
    const dev = DEVICES.find(d => idOf(d.name) === entity.id)
    const keys = dev ? KEYS_BY_KIND[dev.kind]! : []
    return Promise.resolve(
      keys.map((key, i) => ({ key, kind: 'number' as const, latest: key.includes('state') ? 1 : 10 + i }))
    )
  }
  override attrKeys(): Promise<string[]> {
    return Promise.resolve(['model', 'serial_no'])
  }
  override alarmTypes(): Promise<string[]> {
    return Promise.resolve([])
  }
}

const KEY_CN: Record<string, string> = {
  switch_state: '开关状态',
  breaker_status: '断路器状态',
  P: '有功功率',
  Q: '无功功率',
  SOC: '荷电状态',
  F: '频率',
  PF: '功率因数',
}

export function mockHost(): SldEditorHost {
  const devices: TbDevice[] = [
    { id: { id: GATEWAY.id }, name: GATEWAY.name, type: 'gateway', label: GATEWAY.label },
    ...DEVICES.map(d => ({
      id: { id: idOf(d.name) },
      name: d.name,
      type: d.kind,
      label: d.label,
      additionalInfo: { lastConnectedGateway: GATEWAY.id },
    })),
  ]
  const tree = buildMetaTree('mock-site', devices, [{ id: { id: 'asset-site' }, name: 'mock-site', type: 'site' }])
  return {
    tree,
    client: new MockMetaClient(),
    declared: null,
    keyCn: key => KEY_CN[key] ?? '',
    siteName: 'mock-site',
  }
}
