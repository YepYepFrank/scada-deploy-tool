#!/usr/bin/env node
// tbsite CLI:validate | plan | publish | cleanup | page | pages
// 凭据只从环境变量 / --env-file 读(默认 TB_USER / TB_PASSWORD),不接受命令行明文,不写日志。
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  cleanup,
  compile,
  ConfigError,
  expandConfig,
  listSitePages,
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
  tbsite publish  <站点.tbsite.json> [连接参数] [--by 操作者]
  tbsite cleanup  <站点.tbsite.json> [连接参数]
  tbsite page     <页面.pageconfig.json> --site <站点资产名> [--name 页面资产名] [--by 操作者] [连接参数]
  tbsite pages    --site <站点资产名> [连接参数]        列出站点下的 ScadaPage 资产与 version

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
    const failures = await publish(cfg, devIds, api, report, {
      publishedBy: typeof flags.by === 'string' ? flags.by : user,
    })
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
