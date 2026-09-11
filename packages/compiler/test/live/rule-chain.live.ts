// T2.5 live:规则链路径在真实 TB(镜像)上跑通——publish → 断言 → 再 publish 幂等 → cleanup 全清。
// 用「改名 + 全部输出加前缀」的临时站点跑,复用 xrs-mirror-test 的设备但不碰它的 CF / 链 / 资产;
// 前后各拍一次 xrs-mirror-test 快照断言零差异。凭据见 env.ts;没凭据整组 skip。
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  cleanup,
  compile,
  listCfs,
  publish,
  resolveDeviceIds,
  siteChainNames,
  type Computation,
  type TbApi,
  type TbsiteConfig,
} from '../../src/index'
import { hasCreds, makeApi, snapshotSite, TB_BASE, type SiteSnapshot } from './env'

const FIXTURE = resolve(__dirname, '../fixtures/xrs-mirror-test.tbsite.json')
const ORIGINAL_SITE = 'xrs-mirror-test'

/** 把镜像上的站点配置改成一个不与存量重名的临时站点:站点名、输出 key、告警名、汇聚 / 收益资产名全部加前缀 */
export function tempSiteConfig(src: TbsiteConfig, tag: string): TbsiteConfig {
  const cfg = JSON.parse(JSON.stringify(src)) as TbsiteConfig
  const p = `${tag}_`
  cfg.site = { ...cfg.site, name: `${tag}-live`, label: `T2.5 live 临时站点(${tag})` }
  cfg.deviceTemplates = []
  cfg.rollup = {}
  cfg.alarm = {}
  const outputs = new Set((cfg.computations ?? []).map(c => c.output).filter(Boolean) as string[])
  for (const c of cfg.computations ?? []) {
    const x = c as Computation & { asset?: string; inputs?: Record<string, { key?: string }> }
    if (x.output) x.output = p + x.output
    if (x.asset) x.asset = p + x.asset
    if (x.name) x.name = `${tag} ${x.name}`
    // 引用到其它运算输出的输入,一起改名,保证图内引用自洽
    for (const ref of Object.values(x.inputs ?? {})) if (ref.key && outputs.has(ref.key)) ref.key = p + ref.key
  }
  return cfg
}

/** 租户档案 maxCalculatedFieldsPerEntity(镜像默认 5;core/constants 的「单实体 CF 上限 5」同源) */
const MAX_CF_PER_ENTITY = 5

/**
 * 镜像上 xrs-mirror-test 已占用同一批设备的 CF 名额(PDR1_LP1_IED1 上已有 4 个),临时站点再加会撞
 * 「Calculated fields per entity limit reached」。发布前按现状把设备级 CF 挪到同站点里有余量的设备上
 * (只改 device 字段与其 inputs 的 device;IED 设备的 P / Q 等 key 通用)。
 */
async function moveCfsToDevicesWithHeadroom(cfg: TbsiteConfig, devIds: Record<string, string>, api: TbApi) {
  const plan = compile(cfg, { devices: devIds })
  const need = new Map<string, number>()
  for (const c of plan.cfs) if (c.device) need.set(c.device, (need.get(c.device) ?? 0) + 1)
  const used = new Map<string, number>()
  const usedOf = async (dev: string) => {
    if (!used.has(dev)) used.set(dev, (await listCfs(api, 'DEVICE', devIds[dev]!)).length)
    return used.get(dev)!
  }
  for (const [dev, n] of need) {
    if ((await usedOf(dev)) + n <= MAX_CF_PER_ENTITY) continue
    let alt: string | undefined
    for (const d of cfg.devices.map(x => x.name)) {
      if (d === dev || need.has(d)) continue
      if ((await usedOf(d)) + n <= MAX_CF_PER_ENTITY) {
        alt = d
        break
      }
    }
    if (!alt) throw new Error(`没有设备能再放 ${n} 个 CF(${dev} 已用 ${await usedOf(dev)})`)
    for (const c of cfg.computations ?? []) {
      const x = c as Computation & { inputs?: Record<string, { device?: string }> }
      if (x.device === dev && (x.template.startsWith('expr.') || x.template.startsWith('formula.'))) {
        x.device = alt
        for (const ref of Object.values(x.inputs ?? {})) if (ref.device === dev) ref.device = alt
      }
    }
    used.set(alt, (await usedOf(alt)) + n)
    console.info(`[live] ${dev} 的 CF 名额不足,临时站点的 ${n} 个 CF 改放到 ${alt}`)
  }
}

describe.skipIf(!hasCreds)(`规则链路径(live @ ${TB_BASE})`, () => {
  const tag = `t25${Date.now().toString(36).slice(-4)}`
  const original = JSON.parse(readFileSync(FIXTURE, 'utf8')) as TbsiteConfig
  const cfg = tempSiteConfig(original, tag)
  let api: TbApi
  let devIds: Record<string, string>
  let baseline: SiteSnapshot
  const log: string[] = []
  const report = (step: string, status: string, detail?: string) =>
    log.push(`${step}:${status}${detail ? ' ' + detail : ''}`)

  beforeAll(async () => {
    api = await makeApi()
    const r = await resolveDeviceIds(
      api,
      cfg.devices.map(d => d.name)
    )
    if (r.missing.length) throw new Error(`镜像上缺设备:${r.missing.join(', ')}`)
    devIds = r.devIds
    await moveCfsToDevicesWithHeadroom(cfg, devIds, api)
    baseline = await snapshotSite(api, ORIGINAL_SITE, devIds)
  })
  afterAll(async () => {
    // 无论断言成败都清掉临时站点,不给镜像留垃圾
    if (api) await cleanup(cfg, devIds, api).catch(() => {})
  })

  it('publish:CF 数量、规则链名 / 节点数、Root 转发、站点资产与计划一致', async () => {
    const plan = compile(cfg, { devices: devIds })
    expect(plan.validation.errors).toEqual([])
    const failures = await publish(cfg, devIds, api, report, { publishedBy: 'live-test' })
    expect(failures).toEqual([])
    expect(log.filter(l => l.includes(':err'))).toEqual([])
    // 发布后自检:临时站点的链在 TB 上真的起来了(节点配置字段不对时这里会红)
    expect(log.filter(l => /^health:(ok|err)/.test(l)).at(-1)).toMatch(/^health:ok \d+ 个节点已启动/)

    const snap = await snapshotSite(api, cfg.site.name, devIds)
    // 设备 CF:计划里每个 device.output 都在
    for (const c of plan.cfs.filter(x => x.device))
      expect(snap.cfs[c.device!]?.[c.output], `CF ${c.device}.${c.output}`).toBeTruthy()
    // 规则链:名字来自 siteChainNames,节点 / 连线数与计划元数据一致
    const names = siteChainNames(cfg)
    const expectChains = [
      plan.rollup && { name: names.rollup, meta: plan.rollup.metadata },
      plan.alarm && { name: names.alarm, meta: plan.alarm.metadata },
      plan.revenue && { name: names.revenue, meta: plan.revenue.metadata },
    ].filter(Boolean) as { name: string; meta: { nodes: unknown[]; connections: unknown[] } }[]
    expect(snap.chains.map(c => c.name).sort()).toEqual(expectChains.map(c => c.name).sort())
    for (const e of expectChains) {
      const got = snap.chains.find(c => c.name === e.name)!
      expect([got.nodes, got.connections], e.name).toEqual([e.meta.nodes.length, e.meta.connections.length])
    }
    expect(snap.rootFlow).toBe(!!plan.alarm)
    expect(snap.rootNodes).toBe(baseline.rootNodes + (plan.alarm ? 1 : 0))
    // 站点资产 + siteConfig 属性(managedBy 语义:属性里存的就是我们发布的配置与 publishedBy)
    expect(snap.asset).toBeTruthy()
    const attrs: { key: string; value: unknown }[] = await api(
      `/api/plugins/telemetry/ASSET/${snap.asset}/values/attributes/SERVER_SCOPE?keys=siteConfig,siteConfigHistory`
    )
    const siteConfig = attrs.find(a => a.key === 'siteConfig')?.value as { site?: { name?: string } } | string
    const parsed = typeof siteConfig === 'string' ? JSON.parse(siteConfig) : siteConfig
    expect(parsed?.site?.name).toBe(cfg.site.name)
  })

  it('再 publish:幂等——CF / 规则链 id 不变、数量不变,历史 +1', async () => {
    const before = await snapshotSite(api, cfg.site.name, devIds)
    log.length = 0
    const failures = await publish(cfg, devIds, api, report, { publishedBy: 'live-test-2' })
    expect(failures).toEqual([])
    const after = await snapshotSite(api, cfg.site.name, devIds)
    expect(after).toEqual(before)
    expect(log.find(l => l.startsWith('cf:ok'))).toMatch(/新建 0 · 更新 \d+/)
    const attrs: { key: string; value: unknown }[] = await api(
      `/api/plugins/telemetry/ASSET/${after.asset}/values/attributes/SERVER_SCOPE?keys=siteConfigHistory`
    )
    const hist = attrs.find(a => a.key === 'siteConfigHistory')?.value
    const list = typeof hist === 'string' ? JSON.parse(hist) : hist
    expect(Array.isArray(list) && list.length).toBe(1)
  })

  it('cleanup:临时站点的 CF / 链 / Root 转发 / 资产全部清掉;xrs-mirror-test 前后零差异', async () => {
    const msg = await cleanup(cfg, devIds, api)
    expect(msg).toContain('站点资产已删除')
    const gone = await snapshotSite(api, cfg.site.name, devIds)
    expect(gone.asset).toBeNull()
    expect(gone.chains).toEqual([])
    expect(gone.rootFlow).toBe(false)
    expect(gone.rootNodes).toBe(baseline.rootNodes)
    const plan = compile(cfg, { devices: devIds })
    for (const c of plan.cfs.filter(x => x.device))
      expect(gone.cfs[c.device!]?.[c.output], `CF ${c.device}.${c.output} 应已删`).toBeUndefined()
    // 汇聚 / 收益资产也没了
    for (const a of plan.aggregates.map(x => x.asset).concat(plan.revenue?.assets ?? [])) {
      const found: { name: string }[] =
        (await api(`/api/tenant/assets?pageSize=50&page=0&textSearch=${encodeURIComponent(a)}`))?.data ?? []
      expect(
        found.some(x => x.name === a),
        `资产 ${a} 应已删`
      ).toBe(false)
    }
    // 存量站点纹丝不动
    expect(await snapshotSite(api, ORIGINAL_SITE, devIds)).toEqual(baseline)
  })
})
