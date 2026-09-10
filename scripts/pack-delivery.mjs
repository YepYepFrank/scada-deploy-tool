/**
 * 打交付包(给同事 / 现场的 tarball),每个包都带上提交号。
 *
 *   pnpm pack:delivery                     # 构建 + 打三个包到 delivery/
 *   pnpm pack:delivery --only renderer,tb-client
 *   pnpm pack:delivery --no-build          # 已经 build 过,只打包
 *   pnpm pack:delivery --out D:/给庄艳芹/0910
 *
 * 做三件事:
 *   ① 文件名带提交号 —— `grid-scada-renderer-0.2.0-9061abb.tgz`,不看内容就知道是哪一版;
 *   ② 包内带 `build-info.json` —— 文件被改名、被转发几手之后仍然能查(见 build-info.mjs);
 *   ③ 出一份 `交付清单.md` —— 提交号、主题、每个包的 sha256、装法与核对法。
 *
 * 默认拒绝两种情况,因为它们打出来的包**没法追溯**:
 *   · 工作区有未提交改动 —— 提交号对不上包里的代码(`--allow-dirty` 强行打,文件名会带 `+dirty`);
 *   · HEAD 没推到 origin —— 提交号在共享仓库里查不到,写了等于没写(`--allow-unpushed`)。
 */
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { REPO_ROOT, gitInfo, writeBuildInfo } from './build-info.mjs'

/** 可交付的包;顺序即清单顺序 */
const PACKAGES = [
  { key: 'renderer', dir: 'packages/renderer', note: '组态渲染器 + 页面配置契约(宿主 import)' },
  { key: 'tb-client', dir: 'packages/tb-client', note: 'DataSource 契约类型 + 一致性套件(子路径 /testing)' },
  { key: 'compiler', dir: 'packages/compiler', note: '规则编译器 + tbsite 命令行(脚本化发布,可选)' },
]

const argv = process.argv.slice(2)
const flag = name => argv.includes(name)
const opt = (name, dflt) => {
  const i = argv.indexOf(name)
  return i >= 0 && argv[i + 1] ? argv[i + 1] : dflt
}
const only = opt('--only', null)
const outDir = resolve(opt('--out', join(REPO_ROOT, 'delivery')))
const targets = only ? PACKAGES.filter(p => only.split(',').includes(p.key)) : PACKAGES

const die = msg => {
  console.error('✗ ' + msg)
  process.exit(1)
}
const q = s => (/[\s"]/.test(s) ? JSON.stringify(s) : s)
/** pnpm 在 Windows 上是 .cmd,Node 20 起不带 shell 直接 execFile 会 EINVAL,所以一律走 shell */
const run = (cmd, args, cwd = REPO_ROOT) =>
  execFileSync(cmd + ' ' + args.map(q).join(' '), {
    cwd,
    shell: true,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit'],
  })

if (!targets.length) die(`--only ${only} 没匹配到任何包;可选:${PACKAGES.map(p => p.key).join(' / ')}`)

// ── ① 仓库状态必须可追溯 ──────────────────────────────────────────────
const info = gitInfo()
if (!info.available) die('这里不是 git 仓库(或没装 git),打出来的包无从追溯。请在仓库里打包。')
if (info.dirty && !flag('--allow-dirty'))
  die(
    '工作区有未提交的改动,提交号对不上包里的代码。\n' +
      '  先提交(或 git stash),或者明确用 --allow-dirty(文件名会带 +dirty,只适合自己临时验证)。'
  )

let pushed = 'yes'
try {
  execFileSync('git', ['merge-base', '--is-ancestor', 'HEAD', 'origin/main'], { cwd: REPO_ROOT, stdio: 'ignore' })
} catch {
  pushed = existsRef('origin/main') ? 'no' : 'unknown'
}
if (pushed !== 'yes' && !flag('--allow-unpushed'))
  die(
    pushed === 'no'
      ? `HEAD(${info.commitShort})还没推到 origin/main,同事按提交号查不到这份代码。\n  先 git push,或者用 --allow-unpushed。`
      : '查不到 origin/main(浅克隆?),无法确认这个提交已经推上去。\n  确认已推送后用 --allow-unpushed。'
  )

function existsRef(ref) {
  try {
    execFileSync('git', ['rev-parse', '--verify', ref], { cwd: REPO_ROOT, stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

// ── ② 构建 ────────────────────────────────────────────────────────────
if (!flag('--no-build')) {
  console.log('构建三个包…')
  run('pnpm', ['-r', '--filter', '@grid/*', 'run', 'build'])
}

// ── ③ 逐个打包 ────────────────────────────────────────────────────────
mkdirSync(outDir, { recursive: true })
const stamp = info.commitShort + (info.dirty ? '+dirty' : '')
// 暂存目录放在 outDir 里面:系统 temp 常在另一个盘,跨盘 rename 会 EXDEV
const staging = mkdtempSync(join(outDir, '.pack-'))
const results = []

try {
  for (const p of targets) {
    const dir = join(REPO_ROOT, p.dir)
    // build 里已经写过一次,这里再写一次:--no-build 时也要保证 build-info 是当前提交
    const bi = writeBuildInfo(dir, info)
    run('pnpm', ['pack', '--pack-destination', staging], dir)
    const made = readdirSync(staging).filter(f => f.endsWith('.tgz'))
    if (made.length !== 1) die(`${p.key}:期望产出 1 个 tgz,实际 ${made.length} 个`)
    const file = `${made[0].replace(/\.tgz$/, '')}-${stamp}.tgz`
    renameSync(join(staging, made[0]), join(outDir, file))
    const buf = readFileSync(join(outDir, file))
    results.push({
      ...p,
      file,
      name: bi.name,
      version: bi.version,
      bytes: statSync(join(outDir, file)).size,
      sha256: createHash('sha256').update(buf).digest('hex'),
    })
    console.log(`  ✓ ${file}  (${(buf.length / 1024).toFixed(0)} KB)`)
  }
} finally {
  rmSync(staging, { recursive: true, force: true })
}

// ── ④ 交付清单 ────────────────────────────────────────────────────────
const packedAt = new Date().toISOString()
const repoUrl = info.repo ?? '(无 origin)'
const lines = [
  `# 交付清单 · ${info.commitShort}${info.dirty ? '(工作区不干净!)' : ''}`,
  '',
  `- 提交:\`${info.commit}\``,
  `- 主题:${info.commitSubject}`,
  `- 提交时间:${info.commitDate}   分支:${info.branch}`,
  `- 仓库:${repoUrl}`,
  `- 打包时间:${packedAt}`,
  ...(info.dirty ? ['- **工作区有未提交改动,这份包不对应任何提交,不要用于交付。**'] : []),
  '',
  '| 包 | 文件 | 大小 | sha256 | 用途 |',
  '|---|---|---|---|---|',
  ...results.map(
    r =>
      `| \`${r.name}\` ${r.version} | \`${r.file}\` | ${(r.bytes / 1024).toFixed(0)} KB | \`${r.sha256.slice(0, 16)}…\` | ${r.note} |`
  ),
  '',
  '完整 sha256:',
  '',
  '```',
  ...results.map(r => `${r.sha256}  ${r.file}`),
  '```',
  '',
  '## 装法',
  '',
  '```bash',
  `pnpm add ${results.map(r => './' + r.file).join(' ')}`,
  '```',
  '',
  '## 核对拿到的是哪一版',
  '',
  '装完之后:',
  '',
  '```bash',
  `cat node_modules/${results[0]?.name ?? '@grid/scada-renderer'}/build-info.json`,
  '```',
  '',
  `里面的 \`commit\` 应为 \`${info.commit}\`。这个文件跟着包走,文件名被改了、转手几次也还在。`,
  '',
  '想把版本显示在界面上(出问题时截图就能确认现场跑的是哪一版):',
  '',
  '```js',
  "import info from '@grid/scada-renderer/build-info.json'   // Vite / webpack 直接这样写",
  '// 纯 Node ESM 里要加 import 属性:',
  "//   import info from '@grid/scada-renderer/build-info.json' with { type: 'json' }",
  '```',
  '',
  `对应源码:\`git -C <仓库> show ${info.commitShort}\`(先 \`git fetch\`)。`,
  '',
]
writeFileSync(join(outDir, '交付清单.md'), lines.join('\n') + '\n')

console.log(`\n${results.length} 个包 → ${outDir}`)
console.log(`提交 ${info.commitShort}  ${info.commitSubject}`)
console.log('清单:' + join(outDir, '交付清单.md'))
