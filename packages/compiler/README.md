# @grid/tbsite-compiler

规则编译核心 + 写入器 + `tbsite` CLI。把站点声明(`*.tbsite.json`,tbsite/v1、v2)编译成 ThingsBoard 的计算字段、规则链与资产属性。

原来有两套编译器(向导里的 `publisher.js` 与 `tb-compiler/tbsite_compile.py`),T1.3 起只剩本包:`publisher.js` 是本包的薄壳,Python 版已冻结(只留 `--plan-json` 供 parity 测试)。改编译逻辑只改这里。

```
src/
  types.ts              TbsiteConfig / Computation / CalculatedField / RuleChainMetadata / WritePlan / IdMap
  core/                 纯函数,无网络
    templates.ts          matchSelector / itemKeys / expandTemplates(设备模板展开,告警跨设备合并)
    validate.ts           validateConfig
    cf.ts                 buildCf(expr.add / expr.subtract / expr.custom → 设备 SIMPLE CF)
    aggregate.ts          resolveAggMembers / buildAggCfs(跨设备汇聚 → tbsite-agg 资产 CF,>10 台分层)
    rollup.ts             rollupGroups / rollupMetadata(窗口聚合 / 差值 / 积分流水线 + 5m→1h→1d 级联)
    alarm.ts              alarmMetadata(阈值告警链,edge 触发带状态属性)
    revenue.ts            revenueMetadata(分时电价收益链 + 当日累计)
    scripts.ts            规则链 Transform 节点里的 JS 文本
    plan.ts               compile(cfg, ids) → WritePlan;placeholderIds / summarizePlan / ConfigError
  migrate/              T3.1:旧 siteConfig.layout → PageConfig(migrateSiteConfig,纯函数;向导 src/migrate 只做转发)
  writer/               把计划落到 TB,注入 TbApi(与向导的 api(url, data, method) 同签名,可 mock)
    api.ts                TbApi / Reporter / RetryScope;findDevice / resolveDeviceIds / ensureAsset / ensureChain
    publish.ts            publish(cfg, devIds, api, report, {publishedBy, retry, makePublic, layeredSettleMs})
    cleanup.ts            cleanup(cfg, devIds, api, report)
bin/tbsite.ts           CLI(tsup 打到 dist/bin,bin/tbsite.mjs 是启动壳)
scripts/regen-python-plans.mjs   用冻结的 Python 版重生成 parity 快照(本机需 python)
scripts/migrate-site.mjs         从镜像取站点 siteConfig → 解析实体 id → 落 PageConfig 文件 + 迁移报告
scripts/put-pageconfig.mjs       里程碑 A 临时:PageConfig → ScadaPage 资产(T3.7 后删)
test/
  parity.test.ts        TS 版 vs Python 版写入计划(快照 fixtures/*.plan.py.json 已入库,CI 不需要 Python)
  core.test.ts          校验 / 展开 / CF / 汇聚分层 / 聚合链 / 告警链 / compile
  writer.test.ts        内存版 TB:二次发布幂等、retry 只重跑失败步骤、cleanup 不碰存量
  migrate.test.ts       两份样本迁移后过 schema + 注册表校验(用 packages/renderer/dist,先 pnpm build)、每种 card、丢弃情形
  fixtures/             demo-site、xrs-mirror-test(来自 tb-compiler/sites/)
  live/                 需 TB_BASE / TB_USER / TB_PASSWORD,手动跑(T2.5)
```

## 用法

```ts
import { compile, publish, summarizePlan } from '@grid/tbsite-compiler'

const plan = compile(cfg) // 不联网;id 用 dev:<名> / asset:<名> / chain:<名> 占位
summarizePlan(plan) // 向导「预览发布内容」用的几行摘要

const failures = await publish(cfg, devIds, api, report, { publishedBy: '张三' })
// failures 为空即全部成功;失败项可用 { retry: { steps, cf, agg } } 只重发
```

CLI(先 `pnpm build`;凭据只从环境变量 / `.env.local` 读,不接受 `--password` 明文):

```bash
pnpm tbsite validate sites/xx.tbsite.json
pnpm tbsite plan sites/xx.tbsite.json            # 只打印计划;--json 输出整份计划
pnpm tbsite publish sites/xx.tbsite.json         # TB_BASE / TB_USER / TB_PASSWORD 来自 dev/.env.local
pnpm tbsite cleanup sites/xx.tbsite.json
```

## 与旧 publisher.js 的差异

- `sum` 窗口聚合原来漏了后缀(会写出 `keyundefined`),现在 `spec.sfx.sum = 'Sum<窗口>'`,取数键也包含 sum 项(与 Python 版一致)。
- 校验失败抛 `ConfigError`(带 `errors` 数组),不再是裸 `Error('校验失败')`。
- 新增 `makePublic` 选项(默认 true,保持现网行为);T3.8 改为分给 Customer 后关掉。

## Python 版已知差异(parity 测试里显式改写)

告警建 / 清节点名(Python 用测点名,这里用告警名)、收益链切换资产节点名、展开提示文案。行为以本包为准。
