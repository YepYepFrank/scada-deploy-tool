/**
 * 给包打上「这是哪个提交构建的」。
 *
 * 起因:2026-09-06 给庄艳芹的 tarball 没有任何版本标记,版本号又不随每次改动动
 * (`@grid/scada-renderer` 一直是 0.2.0),她拿到手无从判断里面有没有某个修复,
 * 我们也复现不出她那份。见 `docs/给同事的-TbClient拆分请求-2026-09-09.md` 结尾的承诺。
 *
 * 每个包 `build` 时都会写一份 `build-info.json` 到包根,并列进 `files`,于是它跟着
 * tarball 一起走。装完之后 `cat node_modules/@grid/scada-renderer/build-info.json`
 * 就能看到提交号;宿主应用也可以 `import 包名/build-info.json` 显示在界面上。
 *
 * 用法:node scripts/build-info.mjs <包目录>   (包目录省略时取当前目录)
 *
 * 构建绝不能因为没有 git 而失败(比如别人从源码压缩包里构建),所以取不到信息时
 * 写 null 而不是报错;真正把关的是 `pack-delivery.mjs`——交付包必须有可查的提交号。
 */
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { userInfo } from 'node:os'

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

const git = args =>
  execFileSync('git', args, { cwd: REPO_ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()

/**
 * 去掉远端地址里的 userinfo —— 有人会把账号和令牌写在主机名前面(@ 之前那一段),
 * 那种 origin 直接写进包里就是泄露。
 * (这里不写出那种地址的样子:gitleaks 会当成真凭据拦下,fe024b5 上已经误报过一次。)
 */
export function sanitizeRemote(url) {
  if (!url) return null
  return url.replace(/^(\w+:\/\/)[^@/]*@/, '$1').replace(/\.git$/, '')
}

/** 仓库状态;不在 git 仓库里(或没装 git)时返回 available: false,不抛 */
export function gitInfo() {
  try {
    const commit = git(['rev-parse', 'HEAD'])
    return {
      available: true,
      commit,
      commitShort: commit.slice(0, 7),
      commitDate: git(['log', '-1', '--format=%cI']),
      commitSubject: git(['log', '-1', '--format=%s']),
      branch: git(['rev-parse', '--abbrev-ref', 'HEAD']),
      // 有未提交改动 = 这个包和任何一个提交都对不上,必须让拿到的人看见
      dirty: git(['status', '--porcelain']) !== '',
      repo: sanitizeRemote(tryGit(['remote', 'get-url', 'origin'])),
    }
  } catch {
    return {
      available: false,
      commit: null,
      commitShort: null,
      commitDate: null,
      commitSubject: null,
      branch: null,
      dirty: null,
      repo: null,
    }
  }
}

function tryGit(args) {
  try {
    return git(args)
  } catch {
    return null
  }
}

function whoami() {
  return tryGit(['config', 'user.name']) || userInfo().username || null
}

/** 组装 build-info.json 的内容(纯函数,便于核对) */
export function composeBuildInfo(pkg, info, builtAt = new Date().toISOString(), builtBy = whoami()) {
  return {
    name: pkg.name,
    version: pkg.version,
    commit: info.commit,
    commitShort: info.commitShort,
    commitDate: info.commitDate,
    commitSubject: info.commitSubject,
    branch: info.branch,
    dirty: info.dirty,
    repo: info.repo,
    builtAt,
    builtBy,
  }
}

/** 写 <pkgDir>/build-info.json,返回写入的内容 */
export function writeBuildInfo(pkgDir, info = gitInfo()) {
  const pkg = JSON.parse(readFileSync(resolve(pkgDir, 'package.json'), 'utf8'))
  const out = composeBuildInfo(pkg, info)
  writeFileSync(resolve(pkgDir, 'build-info.json'), JSON.stringify(out, null, 2) + '\n')
  return out
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  const dir = resolve(process.argv[2] ?? '.')
  const out = writeBuildInfo(dir)
  const mark = out.commit ? `${out.commitShort}${out.dirty ? '+dirty' : ''}` : '(无 git 信息)'
  console.log(`build-info  ${out.name}@${out.version}  ${mark}`)
}
