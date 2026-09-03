# 开发与提交规范

适用于本仓库全部提交,含 AI 辅助(Claude Code)产生的提交。三条硬规则:**小步上主干、提交信息规范、凭据不入库**。钩子与 CI 会强制其中可机检的部分。

## 1. 工作流:Trunk-Based Development

- 只有一条长期分支 `main`,始终可构建、可测试。没有 `develop` / `release` 分支。
- 默认**直接在 `main` 上小步提交**:一个提交 = 一个可独立验证的小节(计划任务的一个子步),本地验证通过后立刻提交并推送。
- 需要多次提交才能收口、或会让 `main` 中途不可构建的改动,开**短命分支**(命名 `t<任务号>-<slug>`,如 `t1.2-binding-resolver`),存活 ≤ 2 天,`--ff-only` 或 squash 合回 `main` 后删除。不允许分支落后 `main` 超过一天不 rebase。
- 未完成但要合入主干的功能用开关(环境变量 / 常量)隐藏,不靠分支隐藏。
- 里程碑用 tag 标记:`renderer@0.1.0`、`phase1-accepted` 等,不用分支。
- 提交前必须本地验证:文档改动至少通读一次;代码改动跑对应包的 `pnpm test`(有 live 用例的另跑 live);UI 改动在浏览器里看过。**未验证的半成品不提交**。

## 2. 提交信息:Conventional Commits

```
<type>(<scope>): <subject>
<空行>
<body:改了什么、为什么、怎么验证的>
<空行>
Refs: T2.1
Co-Authored-By: ...(如有)
```

- `type`:`feat` 新功能 · `fix` 缺陷 · `refactor` 不改行为的重构 · `docs` 文档 · `test` 测试 · `chore` 杂务 / 依赖 · `build` 构建 · `ci` 流水线 · `perf` 性能 · `style` 格式。
- `scope`:`renderer` / `tb-client` / `compiler` / `deploy-tool` / `docs` / `adr` / `repo`(根配置);多包同时改用 `repo` 或省略。
- `subject`:≤ 72 字符,中文或英文均可,不以句号结尾,祈使语气。
- `Refs:` 指向 `docs/开发计划-v2.md` 的任务号;多个用逗号。破坏契约的改动在 footer 加 `BREAKING CHANGE: ...` 并同步 ADR。
- `commit-msg` 钩子校验首行格式与 `Refs:`(docs / chore / ci 类型可省 Refs)。

示例:

```
feat(renderer): 绑定解析器按 mode 分派并在卸载时退订

遍历 widgets[].bindings,ts→subscribeTs,ts-history→getHistory 后追加订阅,
attr/alarm/const 各自处理。Vitest 用 MockDataSource 断言订阅集合与退订次数相等。

Refs: T1.2
```

## 3. 凭据不入库(零容忍)

- 密码、JWT、API token、私钥、含凭据的 URL(`http://user:pass@…`)**一律不进仓库**,包括文档示例、测试固定样本、截图、`.scadaproj`。
- 凭据只存在两处:`.env.local`(已 gitignore,模板见 `.env.example`)或运行时由人输入(向导登录框、CLI `--password-env`)。
- 文档 / 测试需要示例时用占位符 `<password>`、`<token>`,或明显无效值 `changeme`。
- `pre-commit` 钩子扫描暂存区(已知生产密码字面量、JWT 前缀 `eyJ`、`password = "…"` 赋值、私钥头、AWS/GitHub token 形态);CI 对全部历史跑 gitleaks。钩子命中即拒绝提交,**不允许 `--no-verify` 绕过**——误报请把模式加入 `.gitleaks.toml` allowlist 并说明理由。
- 若凭据已进历史:立即轮换该凭据(改密码 / 吊销 token),再用 `git filter-repo` 清历史并强推;两步缺一不可,只清历史不轮换等于没处理。

## 4. 钩子安装

克隆后执行一次(仓库内钩子位于 `.githooks/`,不依赖任何 npm 包):

```bash
git config core.hooksPath .githooks
```

## 5. 任务收尾清单

1. 本地验证通过(见 §1):代码改动至少跑 `pnpm typecheck && pnpm build && pnpm test && pnpm lint && pnpm format:check`;改了契约再跑 `pnpm gen:schema` 确认无 diff。CI(`.github/workflows/ci.yml`)在干净环境重复同一组检查并校验 dist 可被 Node 直接 import,失败即视为主干损坏,优先修复。
2. `git add -A && git commit`(钩子通过)。
3. `git push origin main`。
4. 在 `docs/开发计划-v2.md` 勾选任务并写日期;若与计划有偏差,缩进一行写「实际:…」。这条改动随本次或下一次提交进入。
