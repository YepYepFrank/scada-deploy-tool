# dev/ — 0 代码部署工具 · 一期开发目录(v2 架构)

> 本目录是 v2 架构(`resource/scada-deploy-tool-architecture-v2.html`)的落地工程根。
> 从 2026-09-03 起,所有与「包级集成」路线相关的新代码、文档、决策记录都放在这里;
> 目录外的 `tb-frontend/`、`tb-compiler/` 是现有工具,进入 monorepo 之前保持只读参照(见开发计划 §2.3)。

## 先读什么

| 文件 | 用途 |
|---|---|
| [`docs/开发计划-v2.md`](docs/开发计划-v2.md) | **权威计划**:目标、范围、四周排期、每个任务的目标 / 交付物 / 完成标准、里程碑验收清单、风险 |
| [`docs/决策记录/`](docs/决策记录/) | 第 1 周前两天必须议定的四项模型决定(ADR-001 ~ 004),含推荐方案;冻结后状态改为「已采纳」 |
| `../resource/scada-deploy-tool-architecture-v2.html` | 架构说明(为什么这样设计)。计划文档不重复解释理由,只引用章节号 |
| [`CONTRIBUTING.md`](CONTRIBUTING.md) | **提交规范**:Trunk-Based Development、Conventional Commits、凭据不入库;克隆后先 `git config core.hooksPath .githooks` |

GitHub:私有库 [YepYepFrank/scada-deploy-tool](https://github.com/YepYepFrank/scada-deploy-tool),团队成员由所有者邀请。

## 目录布局(pnpm workspaces monorepo,第 1 周 T0.3 初始化)

```
dev/
├─ pnpm-workspace.yaml          # T0.3 生成
├─ package.json                 # 根脚本:dev / build / test / lint(T0.3)
├─ tsconfig.base.json
├─ packages/
│  ├─ renderer/                 # @grid/scada-renderer  组态渲染器 + 契约(schema 子路径导出)
│  ├─ tb-client/                # @grid/tb-client       TB 数据访问(包一层同事 request.js / websocket.js)
│  └─ compiler/                 # @grid/tbsite-compiler 规则编译核心(从 publisher.js 抽 TS)+ CLI bin
├─ apps/
│  └─ deploy-tool/              # 部署工具(编辑壳)——由 tb-frontend/ 迁入,引用上面三个包
└─ docs/
   ├─ 开发计划-v2.md
   ├─ 决策记录/                 # ADR
   └─ (第 1 周起)契约-v1.md、联调记录、操作说明
```

同事的生产前端应用**不在**本目录:开发期以 `file:` 链接本目录下的包,正式版按 tag 取(架构 §3)。
若双方同意,也可作为 `apps/host-app` 加入 workspace。

## 常用命令

```bash
pnpm install                 # 安装全部 workspace 依赖(需 pnpm 9,node ≥ 20)
pnpm dev                     # 部署工具 dev 服务器(5173);或 launch.json 的 deploy-tool 配置
pnpm typecheck               # 各包 tsc --noEmit
pnpm test                    # 各包 vitest
pnpm lint                    # ESLint 9(迁入的向导代码只告警)
pnpm format:check            # Prettier(*.md 与迁入的旧代码目录已忽略);pnpm format 自动修
pnpm build                   # tsup 打包三个 packages(ESM + .d.ts),产物可被 Node 直接 import
pnpm gen:schema              # 由 page-config.ts 重新生成 JSON Schema(改契约后必跑)
pnpm -F @grid/scada-renderer test:schema   # 仅契约校验测试
```

`../tb-frontend/` 已冻结,只作参照(见其 `README-FROZEN.md` / 计划 §2.3);`tbsite_compile.py` 在 T1.3 同构测试通过后冻结。

契约人读版:[`docs/契约-v1.md`](docs/契约-v1.md)(状态见其顶部;权威定义在 `packages/renderer/src/schema/` 与 `packages/tb-client/src/data-source.ts`)。

## 工程约定(摘要,详见计划 §2)

- 包名前缀 `@grid/`;新包一律 TypeScript;`apps/deploy-tool` 里现有 2700 行向导保留 JS,新模块 TS。
- 渲染器的 `vue` 与 `@grid/tb-client` 是 **peerDependencies**(架构 §8 / §10「两份 Vue 运行时」)。
- 契约(PageConfig 等)只在 `packages/renderer/src/schema/` 定义一次;JSON Schema 由类型生成,不手写。
- 目标 TB:生产镜像 `192.168.20.61:8080`(TB CE 4.3.1.3);凭据不入库,走 `.env.local`(已 gitignore)。
- 每个任务完成的判据以计划文档「完成标准」为准,勾选任务时在计划文档同一行追加日期。
