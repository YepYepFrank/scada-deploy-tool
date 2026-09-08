#!/usr/bin/env node
// tbsite CLI:validate | plan | publish | cleanup | page | pages
// 凭据只从环境变量 / --env-file 读(默认 TB_USER / TB_PASSWORD),不接受命令行明文,不写日志。
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, resolve } from 'node:path'
import {
  ALARM_CONFIG_ASSET,
  ALARM_CONFIG_ATTR,
  ALARM_DEVICES_ATTR,
  applyRenameTable,
  detectSiteDrift,
  diffJson,
  normalizeEntityRefs,
  rewritePageKeys,
  summarizeDiff,
  type LocalPage,
  type RenameEntry,
  cleanup,
  compile,
  ConfigError,
  expandConfig,
  exportAlarmConfig,
  findAsset,
  findDevice,
  writeAlarmConfig,
  listSitePages,
  renameTable,
  publish,
  publishPage,
  type PagePayload,
  resolveDeviceIds,
  summarizePlan,
  validateConfig,
} from '../src/index'
import type { IdMap, TbsiteConfig } from '../src/types'
import type { StepId, StepStatus, TbApi } from '../src/writer/api'

const USAGE = `用法:
  tbsite validate <站点.tbsite.json>
  tbsite plan     <站点.tbsite.json> [--json] [--out 计划.json] [--ids ids.json]
  tbsite publish  <站点.tbsite.json> [连接参数] [--by 操作者]   带 outputPrefix 且 TB 上有旧版配置时,把「旧 key → 新 key」写到 migrations/<站点>.rename.json(只生成不执行,ADR-003)
  tbsite cleanup  <站点.tbsite.json> [连接参数]
  tbsite page     <页面.pageconfig.json> --site <站点资产名> [--name 页面资产名] [--by 操作者] [连接参数]
  tbsite pages    --site <站点资产名> [连接参数]        列出站点下的 ScadaPage 资产与 version
  tbsite drift    <站点.tbsite.json> [--pages 目录] [--strict] [连接参数]
                  本地声明 / 页面文件 vs 线上 siteConfig / pageConfig 的差异(只读;--strict 有差异时退出码 1,给 CI 用)
  tbsite migrate  <站点.tbsite.json> [--table 迁移表] [--apply] [--from 时刻] [--delete-old] [--rewrite-pages] [--pages 目录] [连接参数]
                  执行 ADR-003 迁移表:旧 key 的历史复制到新 key(只补新 key 首点之前的区间;--from 再限定起点);缺省 dry-run;
                  --delete-old 复制后删旧 key 数据与同名 CF;--rewrite-pages 把页面文件里对旧 key 的绑定改名
  tbsite alarm-export <站点.tbsite.json> [--out 文件] [--offline] [--write [--force] [--asset 资产名]] [连接参数]
                  把站点的阈值告警导出成同事的 JSON(alarm_config 模板数组 + alarm_devices 设备清单,ADR-001 二期)。
                  默认连 TB 解析设备 id / label 并写文件(缺省 sites/exports/<站点>.alarm_config.json);--offline 不连;
                  --write 再写到资产 JIZHAN_ALARM_CONFIG(没有则建)的服务端属性,已有非空内容时拒绝,--force 覆盖并把旧值存到 .prev.json

连接参数(都可以省略,默认从环境变量取):
  --base URL           TB 地址,默认 $TB_BASE,再默认镜像 http://192.168.20.61:8080
  --user 账号          默认 $TB_USER
  --password-env NAME  放密码的环境变量名,默认 TB_PASSWORD(不接受 --password 明文)
  --env-file PATH      先从这个 KEY=VALUE 文件加载环境变量;默认从当前目录向上找 .env.local

plan 只打印写入计划,不登录、不写 TB;--ids 可给出 {devices,assets,chains} 名→id 映射替换占位串。`

type Args = { cmd: string; file: string; flags: Record<string, string | true> }
function parseArgs(argv: string[]): Args {
  const [cmd = '', ...rest] = argv
  const flags: Record<string, string | true> = {}
  let file = ''
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i]!
    if (a.startsWith('--')) {
      const k = a.slice(2)
      const next = rest[i + 1]
      if (next !== undefined && !next.startsWith('--')) {
        flags[k] = next
        i++
      } else flags[k] = true
    } else if (!file) file = a
  }
  return { cmd, file, flags }
}

function loadEnvFile(path: string) {
  if (!existsSync(path)) return
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/)
    if (m && !(m[1]! in process.env)) process.env[m[1]!] = m[2]!.replace(/^["']|["']$/g, '')
  }
}

/** 从当前目录向上找 .env.local(pnpm -F 会把 cwd 切到包目录,monorepo 根的 .env.local 也要能找到) */
function findEnvFile(): string {
  let dir = resolve('.')
  for (let i = 0; i < 4; i++) {
    const f = resolve(dir, '.env.local')
    if (existsSync(f)) return f
    const parent = resolve(dir, '..')
    if (parent === dir) break
    dir = parent
  }
  return resolve('.env.local')
}

/** --from:ISO 日期 / 时间或毫秒;非法即报错 */
function parseTs(s: string): number {
  const n = /^\d{12,}$/.test(s) ? Number(s) : Date.parse(s)
  if (!Number.isFinite(n)) throw new Error(`--from 无法解析:${s}(用 2026-09-01 或 2026-09-01T00:00:00+08:00 或毫秒)`)
  return n
}

/** 站点的本地页面文件:<pages 目录>/<站点名>-*.pageconfig.json(缺省 与声明文件同级的 pages/) */
function loadLocalPages(file: string, siteName: string, flags: Args['flags']): LocalPage[] {
  const dir = typeof flags.pages === 'string' ? resolve(flags.pages) : resolve(file, '..', 'pages')
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter(f => f.startsWith(`${siteName}-`) && f.endsWith('.pageconfig.json'))
    .map(f => {
      const p = resolve(dir, f)
      return { file: p, config: JSON.parse(readFileSync(p, 'utf8')) as PagePayload }
    })
}

function readConfig(file: string): TbsiteConfig {
  if (!file) throw new Error('缺少站点文件参数')
  return JSON.parse(readFileSync(resolve(file), 'utf8'))
}

async function connect(flags: Args['flags']): Promise<{ api: TbApi; user: string; base: string }> {
  if ('password' in flags) throw new Error('不接受 --password 明文,请用 --password-env 指定环境变量名')
  loadEnvFile(typeof flags['env-file'] === 'string' ? flags['env-file'] : findEnvFile())
  // 默认镜像地址与 scripts/tb-*.mjs 一致;正式环境请显式给 --base 或 TB_BASE
  const base = (
    typeof flags.base === 'string' ? flags.base : process.env.TB_BASE || 'http://192.168.20.61:8080'
  ).replace(/\/$/, '')
  const user = typeof flags.user === 'string' ? flags.user : process.env.TB_USER || ''
  const pwEnv = typeof flags['password-env'] === 'string' ? flags['password-env'] : 'TB_PASSWORD'
  const password = process.env[pwEnv] || ''
  if (!base || !user || !password)
    throw new Error(`缺少连接信息:需要 --base/$TB_BASE、--user/$TB_USER 与环境变量 ${pwEnv}(可写在 .env.local)`)
  let token = ''
  const api: TbApi = async (url, data, method) => {
    const r = await fetch(base + url, {
      method: method || (data ? 'POST' : 'GET'),
      headers: { 'Content-Type': 'application/json', ...(token ? { 'X-Authorization': `Bearer ${token}` } : {}) },
      body: data !== undefined && data !== null ? JSON.stringify(data) : undefined,
    })
    if (!r.ok) throw new Error(`${url} → HTTP ${r.status}`)
    const text = await r.text()
    return text ? JSON.parse(text) : null
  }
  token = (await api('/api/auth/login', { username: user, password })).token
  return { api, user, base }
}

const report = (step: StepId, status: StepStatus, detail?: string) => {
  const mark = status === 'ok' ? '✓' : status === 'err' ? '✗' : '…'
  console.log(`  ${mark} ${step.padEnd(8)} ${detail || ''}`)
}

async function main(argv: string[]) {
  const { cmd, file, flags } = parseArgs(argv)
  if (!cmd || cmd === '-h' || cmd === '--help' || flags.help) {
    console.log(USAGE)
    return 0
  }
  if (cmd === 'validate') {
    const cfg = readConfig(file)
    const errs = validateConfig(cfg)
    const { computations, notes } = expandConfig(cfg)
    for (const n of notes) console.log('  ~', n)
    if (errs.length) {
      console.log('配置校验失败:')
      for (const e of errs) console.log('  ✗', e)
      return 1
    }
    console.log(`✓ 配置校验通过 · 站点 ${cfg.site.name} · ${cfg.devices.length} 设备 · ${computations.length} 运算`)
    return 0
  }
  if (cmd === 'plan') {
    const cfg = readConfig(file)
    const ids: IdMap | undefined =
      typeof flags.ids === 'string' ? JSON.parse(readFileSync(resolve(flags.ids), 'utf8')) : undefined
    const plan = compile(cfg, ids)
    if (typeof flags.out === 'string') {
      writeFileSync(resolve(flags.out), JSON.stringify(plan, null, 2) + '\n')
      console.log(`已写入 ${flags.out}`)
    }
    if (flags.json) console.log(JSON.stringify(plan, null, 2))
    else for (const line of summarizePlan(plan)) console.log('  ', line)
    return 0
  }
  if (cmd === 'publish' || cmd === 'cleanup') {
    const cfg = readConfig(file)
    const errs = validateConfig(cfg)
    if (errs.length) throw new ConfigError(errs)
    const { api, user, base } = await connect(flags)
    console.log(`✓ 已登录 ${base}(${user})`)
    const { devIds, missing } = await resolveDeviceIds(
      api,
      cfg.devices.map(d => d.name)
    )
    if (cmd === 'cleanup') {
      console.log('已清理:' + (await cleanup(cfg, devIds, api, report)))
      return 0
    }
    if (missing.length) {
      console.log(`✗ ${missing.length} 台设备在 TB 中不存在(v2 不创建设备,由网关上报产生):${missing.join(', ')}`)
      return 1
    }
    // ADR-003 迁移表:发布前先取 TB 上的旧版配置(发布会把它推进历史)
    const prevCfg: TbsiteConfig | null = await (async () => {
      try {
        const a = await findAsset(api, cfg.site.name)
        if (!a) return null
        const attrs: { key: string; value: unknown }[] =
          (await api(`/api/plugins/telemetry/ASSET/${a.id.id}/values/attributes/SERVER_SCOPE?keys=siteConfig`)) || []
        const v = attrs.find(x => x.key === 'siteConfig')?.value
        return v ? ((typeof v === 'string' ? JSON.parse(v) : v) as TbsiteConfig) : null
      } catch {
        return null
      }
    })()
    // 漂移提示(架构 §10 变更单向):线上 siteConfig 与本地文件不同时列出来;发布仍以本地为准
    if (prevCfg) {
      const d = diffJson(normalizeEntityRefs(cfg), normalizeEntityRefs(prevCfg), {
        ignore: ['publishedAt', 'publishedBy', '_meta'],
      })
      if (d.length) {
        console.log(`~ 线上 siteConfig 与本地有 ${d.length} 处差异(发布以本地为准;明细 tbsite drift):`)
        for (const l of summarizeDiff(d).slice(0, 8)) console.log('   ', l)
        if (d.length > 8) console.log(`    … 还有 ${d.length - 8} 处`)
      }
    }
    const failures = await publish(cfg, devIds, api, report, {
      publishedBy: typeof flags.by === 'string' ? flags.by : user,
    })
    if (prevCfg && cfg.outputPrefix) {
      const rows = renameTable(
        { cfg: prevCfg, computations: expandConfig(prevCfg).computations },
        { cfg, computations: expandConfig(cfg).computations }
      )
      if (rows.length) {
        const out = resolve(file, '..', 'migrations', `${cfg.site.name}.rename.json`)
        mkdirSync(resolve(out, '..'), { recursive: true })
        writeFileSync(out, JSON.stringify(rows, null, 2) + '\n')
        console.log(`迁移表:${rows.length} 个旧 key 在新版带前缀出现,已写 ${out}(一期只记录不执行)`)
      }
    }
    if (failures.length) {
      console.log(`\n${failures.length} 项失败:`)
      for (const f of failures)
        console.log(`  - [${f.step}] ${f.device ? f.device + '.' : ''}${f.output || ''} ${f.error}`)
      return 1
    }
    console.log('\n完成:运算、汇聚、规则链与站点资产已就绪。')
    return 0
  }
  if (cmd === 'page' || cmd === 'pages') {
    const siteName = typeof flags.site === 'string' ? flags.site : ''
    if (!siteName) throw new Error('缺少 --site <站点资产名>')
    const { api, user, base } = await connect(flags)
    console.log(`✓ 已登录 ${base}(${user})`)
    if (cmd === 'pages') {
      const pages = await listSitePages(api, siteName)
      if (!pages.length) console.log(`站点「${siteName}」下没有 ScadaPage 资产`)
      for (const p of pages) console.log(`  ${p.name}  version ${p.version ?? '-'}  ${p.assetId}  ${p.label ?? ''}`)
      return 0
    }
    if (!file) throw new Error('缺少页面配置文件路径')
    const page = JSON.parse(readFileSync(resolve(file), 'utf8')) as PagePayload
    const r = await publishPage(page, api, {
      siteName,
      pageName: typeof flags.name === 'string' ? flags.name : undefined,
      publishedBy: typeof flags.by === 'string' ? flags.by : user,
      report: x =>
        console.log(
          `  ${x.status === 'ok' ? '✓' : x.status === 'err' ? '✗' : x.status === 'rollback' ? '↩' : '…'} ${x.step.padEnd(8)} ${x.detail || ''}`
        ),
    })
    if (!r.ok) {
      console.log(`\n✗ 发布失败于 ${r.failedStep}:${r.error}`)
      for (const u of r.unresolved) console.log(`  - ${u.type} ${u.name} @ ${u.at.join(', ')}`)
      if (r.rolledBack.length) console.log(`  已回滚:${r.rolledBack.join(' → ')}`)
      return 1
    }
    console.log(
      `\n完成:ScadaPage「${r.pageName}」version ${r.version} · 历史 ${r.historyLength} 版 · 资产 ${r.assetId}`
    )
    return 0
  }
  if (cmd === 'drift') {
    const cfg = readConfig(file)
    const pages = loadLocalPages(file, cfg.site.name, flags)
    const { api, user, base } = await connect(flags)
    console.log(`✓ 已登录 ${base}(${user})`)
    const r = await detectSiteDrift(api, cfg, pages)
    if (!r.remoteExists) console.log(`站点「${r.siteName}」线上没有 siteConfig(未发布过)`)
    else if (!r.siteDiff.length) console.log(`✓ 站点声明与线上一致(资产 ${r.assetId},历史 ${r.historyLength} 版)`)
    else {
      console.log(`~ 站点声明与线上有 ${r.siteDiff.length} 处差异(资产 ${r.assetId}):`)
      for (const l of summarizeDiff(r.siteDiff)) console.log('   ', l)
    }
    for (const p of r.pages) {
      const f = basename(p.file)
      if (!p.pageName) console.log(`~ 页面 ${f}「${p.title}」线上没有对应资产(未发布或已删)`)
      else if (!p.diff) console.log(`~ 页面 ${f} ↔ ${p.pageName}:线上 pageConfig 为空`)
      else if (!p.diff.length) console.log(`✓ 页面 ${f} ↔ ${p.pageName} version ${p.remoteVersion} 一致`)
      else {
        console.log(`~ 页面 ${f} ↔ ${p.pageName} version ${p.remoteVersion}:${p.diff.length} 处差异`)
        for (const l of summarizeDiff(p.diff).slice(0, 20)) console.log('   ', l)
        if (p.diff.length > 20) console.log(`    … 还有 ${p.diff.length - 20} 处`)
      }
    }
    for (const n of r.remoteOnlyPages) console.log(`~ 线上页面「${n}」本地 pages/ 里没有文件`)
    const drifted =
      r.siteDiff.length > 0 ||
      r.pages.some(p => !p.pageName || (p.diff?.length ?? 0) > 0) ||
      r.remoteOnlyPages.length > 0
    return flags.strict && drifted ? 1 : 0
  }
  if (cmd === 'migrate') {
    const cfg = readConfig(file)
    const table =
      typeof flags.table === 'string'
        ? resolve(flags.table)
        : resolve(file, '..', 'migrations', `${cfg.site.name}.rename.json`)
    if (!existsSync(table)) throw new Error(`没有迁移表 ${table}(publish 在旧 key 于新版带前缀出现时生成)`)
    const rows = JSON.parse(readFileSync(table, 'utf8')) as RenameEntry[]
    console.log(`迁移表 ${table}:${rows.length} 行${flags.apply ? '' : '(dry-run,加 --apply 执行)'}`)
    const pages = loadLocalPages(file, cfg.site.name, flags)
    let pageChanges = 0
    for (const p of pages) {
      const { page, changes } = rewritePageKeys(p.config, rows)
      if (!changes.length) continue
      pageChanges += changes.length
      for (const c of changes)
        console.log(
          `  ${flags['rewrite-pages'] ? '✓' : '·'} 页面 ${basename(p.file)} ${c.at}:${c.entity}.${c.old} → ${c.new}`
        )
      if (flags['rewrite-pages']) writeFileSync(p.file, JSON.stringify(page, null, 2) + '\n')
    }
    if (pages.length && !pageChanges) console.log('  页面文件里没有对旧 key 的绑定')
    else if (pageChanges && !flags['rewrite-pages'])
      console.log(`  (${pageChanges} 处页面绑定要改名,加 --rewrite-pages 改文件;改完用 tbsite page 重新发布)`)
    const { api, user, base } = await connect(flags)
    console.log(`✓ 已登录 ${base}(${user})`)
    const res = await applyRenameTable(api, rows, {
      apply: !!flags.apply,
      deleteOld: !!flags['delete-old'],
      from: typeof flags.from === 'string' ? parseTs(flags.from) : undefined,
      report: l => console.log('  ' + l),
    })
    const total = res.reduce((n, r) => n + r.points, 0)
    console.log(
      `${flags.apply ? '完成' : '计划'}:${res.filter(r => !r.skipped).length}/${rows.length} 行 · ${total} 点` +
        (flags['delete-old'] && flags.apply ? ' · 旧 key 数据与同名 CF 已删' : '')
    )
    return res.some(r => r.skipped) ? 1 : 0
  }
  if (cmd === 'alarm-export') {
    const cfg = readConfig(file)
    const errs = validateConfig(cfg)
    if (errs.length) throw new ConfigError(errs)
    const { computations } = expandConfig(cfg)
    const deviceIds: Record<string, string> = {}
    const labels: Record<string, string> = {}
    let conn: Awaited<ReturnType<typeof connect>> | null = null
    if (!flags.offline) {
      conn = await connect(flags)
      console.log(`✓ 已登录 ${conn.base}(${conn.user})`)
      const names = new Set<string>()
      for (const c of computations)
        if (c.template === 'alarm.threshold')
          for (const d of c.devices?.length ? c.devices : c.device ? [c.device] : []) names.add(d)
      for (const name of names) {
        const d = await findDevice(conn.api, name)
        if (d) {
          deviceIds[name] = d.id.id
          if (typeof d.label === 'string' && d.label) labels[name] = d.label
        }
      }
    }
    const exp = exportAlarmConfig(cfg, computations, { deviceIds, labels })
    const out =
      typeof flags.out === 'string'
        ? resolve(flags.out)
        : resolve(file, '..', 'exports', `${cfg.site.name}.alarm_config.json`)
    mkdirSync(resolve(out, '..'), { recursive: true })
    writeFileSync(
      out,
      JSON.stringify({ alarm_config: exp.alarm_config, alarm_devices: exp.alarm_devices }, null, 2) + '\n'
    )
    console.log(`导出 ${exp.alarm_config.length} 条模板 · ${exp.alarm_devices.length} 台设备 → ${out}`)
    for (const n of exp.notes) console.log('  ~', n)
    if (!flags.write) return 0
    if (!conn) throw new Error('--write 需要连接 TB,不能与 --offline 同用')
    const r = await writeAlarmConfig(conn.api, exp, {
      assetName: typeof flags.asset === 'string' ? flags.asset : undefined,
      force: !!flags.force,
    })
    if (!r.ok) {
      console.log(
        `✗ 资产 ${typeof flags.asset === 'string' ? flags.asset : ALARM_CONFIG_ASSET}(${r.assetId})已有非空 ${ALARM_CONFIG_ATTR},未覆盖;加 --force 覆盖(旧值会存到 ${out.replace(/\.json$/, '.prev.json')})`
      )
      return 1
    }
    if (r.previous) {
      const prev = out.replace(/\.json$/, '.prev.json')
      writeFileSync(prev, JSON.stringify(r.previous, null, 2) + '\n')
      console.log(`  旧值已存 ${prev}`)
    }
    console.log(`✓ 已写入资产 ${r.assetId}${r.created ? '(新建)' : ''} 的 ${ALARM_CONFIG_ATTR} / ${ALARM_DEVICES_ATTR}`)
    return 0
  }
  console.error(`未知命令 ${cmd}\n\n${USAGE}`)
  return 2
}

main(process.argv.slice(2)).then(
  code => process.exit(code),
  e => {
    console.error(
      e instanceof ConfigError
        ? '配置校验失败:\n  ✗ ' + e.errors.join('\n  ✗ ')
        : `错误:${e instanceof Error ? e.message : e}`
    )
    process.exit(1)
  }
)
