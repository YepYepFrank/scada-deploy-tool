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
    publish.ts            publish(cfg, devIds, api, report, {publishedBy, retry, layeredSettleMs, checkHealth})
    health.ts             发布后自检:核对刚写的规则节点是否真的启动(checkChainHealth)
    cleanup.ts            cleanup(cfg, devIds, api, report)
bin/tbsite.ts           CLI(tsup 打到 dist/bin,bin/tbsite.mjs 是启动壳)
scripts/regen-python-plans.mjs   用冻结的 Python 版重生成 parity 快照(本机需 python)
scripts/migrate-site.mjs         从镜像取站点 siteConfig → 解析实体 id → 落 PageConfig 文件 + 迁移报告
src/page/publish-page.ts         页面发布器(T3.7):PageConfig → ScadaPage 资产,六步 + 逆序回滚;CLI `tbsite page / pages`
test/
  parity.test.ts        TS 版 vs Python 版写入计划(快照 fixtures/*.plan.py.json 已入库,CI 不需要 Python)
  core.test.ts          校验 / 展开 / CF / 汇聚分层 / 聚合链 / 告警链 / compile
  writer.test.ts        内存版 TB:二次发布幂等、retry 只重跑失败步骤、cleanup 不碰存量、发布后自检
  health.test.ts        自检判据:最近一次 STARTED、异常摘要、读不到事件不误判
  migrate.test.ts       T3.1 迁移函数:两份样本过 schema + 注册表,每种 card 映射、丢弃项、unresolved
  publish-page.test.ts  T3.7 页面发布器:六步、幂等、按名解析、注入失败逆序回滚、漂移
  live/                 连镜像的 live 用例(pnpm test:live,CI 不跑),见 live/README.md
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
pnpm tbsite publish sites/xx.tbsite.json         # TB_BASE / TB_USER / TB_PASSWORD 来自 dev/.env.local;发布后自检节点,有起不来的即退出 1
pnpm tbsite publish sites/xx.tbsite.json --no-health     # 跳过自检
pnpm tbsite cleanup sites/xx.tbsite.json
pnpm tbsite drift sites/xx.tbsite.json                  # 本地声明 / pages/ 文件 vs 线上 siteConfig / pageConfig 的差异(只读;--strict 给 CI)
pnpm tbsite migrate sites/xx.tbsite.json [--apply] [--from 2026-09-06] [--delete-old] [--rewrite-pages]   # 执行 ADR-003 迁移表,缺省 dry-run
#   --delete-old 会先核对「旧点都到新 key 了」再删;复制上界记在 migrations/<站点>.migrate-state.json,中断重试自动沿用(别删)
pnpm tbsite alarm-export sites/xx.tbsite.json           # 阈值告警 → 同事 JSON 文件 sites/exports/<站点>.alarm_config.json(ADR-001 二期)
pnpm tbsite alarm-export sites/xx.tbsite.json --write   # 再写到资产 JIZHAN_ALARM_CONFIG 的 alarm_config / alarm_devices;已有非空内容拒绝,--force 覆盖并留 .prev.json
```

## 输出前缀 `calc_`、级联白名单与迁移表(ADR-003,2026-09-06)

- 配置顶层 `outputPrefix: 'calc_'`(向导新建站点默认写;旧站点配置没有该字段 → 一律不改名,parity 固定样本因此不受影响)。`expandConfig` 统一加前缀:显式 `output`、对它的引用(告警 key、窗口 keys、汇聚 key、expr 输入 / terms、收益充放电 key)同步改名;派生名(`PAvg5m`、级联各级、收益 `Income/Cost/Daily`)由 `rollupMetadata` / `outputInventory` 按同一前缀生成。已带前缀的名字不重复加(幂等)。
- `plan.outputs`:这份配置会写出的全部 key(设备 / 资产 · kind cf / agg / rollup / cascade / revenue);`plan.cascadeKeys`:设备输出里被其它运算再当输入的 key(级联 5m → 1h、被 expr / 窗口聚合引用的 CF 输出),写进**告警链入口过滤**(`cascadeGuardScript`:资产消息放行;设备消息带前缀且不在白名单 → 丢弃,防回环)和站点资产属性 `calcCascadeKeys`。
- 迁移表:`renameTable(prev, next)` 列出「上一版没前缀、新版带前缀的同实体同名 key」;CLI `publish` 在 TB 上有旧版配置时写 `migrations/<站点>.rename.json`(与声明文件同目录),**只生成不执行**。
- 再发布清理旧输出:`publish` 的 cf 步骤先读站点资产上的上一版 `siteConfig`,删除它声明过、这一版不再有的设备 / 汇聚 CF(只删本站点自己写过的名字,不碰存量;也给单实体 5 个 CF 的上限腾位)。
- 汇聚 / 收益资产随站点:asset 步骤把 `tbsite-agg` 资产分给站点资产所属 Customer,并建 `站点 Contains 资产` 关系(编辑器资产树、Customer 视角都靠这两条)。
- `alarm.propagate: true`:建告警节点 `propagate + relationTypes: ['Contains']`(TB 4.3.1 的字段名;曾误写成 `propagateRelationTypes`,节点会启动失败、告警静默不建,2026-09-08 修),设备告警沿 `汇聚资产 Contains 设备`、`站点 Contains 汇聚资产` 上传到站点资产,页面「告警列表」绑站点资产即见全站告警。默认 false(parity 不变);向导新建站点默认开。
- 站点声明文件放 `dev/sites/<站点>.tbsite.json`(入库,可重放);镜像仙人山:`sites/xrs-mirror-test.tbsite.json`(2026-09-06)。

## 严格 PagePayload、漂移检测与迁移表执行(2026-09-08)

- `src/page/types.ts`:契约 §1–§3 的 TS 镜像(`PagePayload = PageConfig`、`WidgetConfig`、六种 `Binding`、`EntityRef`),不再用索引签名;`eachBinding / hasEntity / extEntityOf` 是遍历工具。`collectEntityRefs` 因此也把 `ext.params.entity` 纳入按名解析。向导传入时仍可 `as never`,发布器只读它认识的字段。
- `src/writer/drift.ts`:`diffJson`(对象按键、数组按 name / key / id 对齐、叶子按值)、`normalizeEntityRefs`(`{type,id,name} → {type,name}`,去掉发布回填 id 的假差异)、`readSiteState`、`detectSiteDrift(api, cfg, pages)`。CLI `tbsite drift`;`publish` 前打印线上 vs 本地的差异摘要(仍以本地为准)。
- `src/writer/migrate.ts`:`applyRenameTable(api, rows, { apply, from, deleteOld, cutover, report })` 把旧 key 历史复制到新 key(只补新 key 首点之前;`from` 再限起点;5000 点分页读、1000 点一批写),`deleteOld` 删同名 CF 与旧数据;`rewritePageKeys(page, rows)` 改页面文件里的绑定。CLI `tbsite migrate` 缺省 dry-run。镜像首跑记录 `docs/联调记录/迁移执行-2026-09-08.md`。

### 中断重试的数据安全(R4,2026-09-08)

复制上界取「新 key 当前首点」。第一批点写进去之后这个时刻就变早了,**重试时现算会把刚搬进去的第一个点当成新 key 的原始起点,余下历史全被跳过**;老版本随后还会照常删掉旧 key,那些点就两边都没有了。三道措施:

1. **上界钉住**:`cutover`(`cutoverKey(row)` → ts)由调用方传入。CLI 每次 `--apply` 后把本轮上界写进 `migrations/<站点>.migrate-state.json`,下次自动沿用——**这个文件别删**。
2. **删之前核对**(只读,两段都要过):上界之前,新 key 的点数不能少于旧 key;上界之后(新旧并行写过的重叠段),新 key 的点数也不能少于旧 key。上界被带偏时后一条必然不过,删除就被拦住,并说明原因。
3. **逐行容错**:一行出错记在 `error` 里不抛出,不影响其它行,而且出错的行绝不会走到删除。

核对没过或有行出错时 CLI 退出 1。修好后重跑同一条命令即可:上界已固定,写入按 ts 覆盖(幂等),不会漏搬也不会误删。

## 一条历史曲线绑定 = 一条序列(R3,2026-09-08)

渲染器按**绑定条数**出序列,折线组件的 `series` 槽位是 `multiple: true` —— 多条曲线用**多条绑定**,不是在一条绑定里堆多个测点。一条绑定里写了多个,除第一个之外都会被丢掉。

现在三处一起兜住:编辑器只让选一个测点(遇到早期配置给「拆成 N 条绑定 / 只留第一个」两个出口);校验层把多测点判为 error 并禁用发布,且**不连 TB 也生效**;渲染器仍按第一个测点渲染(不让历史页面整块报错)但打一条点名组件与槽位的 `console.warn`。

契约的 `keys` 仍是数组(一期契约已冻结,没收紧成 `maxItems: 1`),靠上面两道拦。

## Customer 归属:未分配标识与取消分配(R2 / R5,2026-09-08)

TB 用一个**占位 UUID** `13814000-1dd2-11b2-8080-808080808080` 表示「未分配 Customer」。它是非空字符串,所以 `if (asset.customerId?.id)` 会把「未分配」当成一个真实客户;真去 `POST /api/customer/<占位>/asset/…` 只会拿到 `404 Customer ... is not found`(镜像实测)。凡是读 `customerId` 都走 `customerIdOf(entity)`(`core/constants`),未分配一律归一成 `null`。

归属**始终跟着站点资产走**,三种转换都要落地——页面资产(`publishPage` 的 assign 步)与汇聚 / 收益资产(`followSiteAsset`)同一套语义:

| 站点 | 目标资产 | 动作 |
|---|---|---|
| 无 | 无 | 不动 |
| 有 | 同一个 | 不动(不重复分配) |
| 有 | 无 / 别的客户 | `POST /api/customer/<站点客户>/asset/<id>` |
| **无** | **有** | `DELETE /api/customer/asset/<id>` —— 原来这一格只打了条成功日志,页面就一直留在原 Customer 名下 |

注意:取消分配只在目标资产**确实有归属**时才调,本来就没分配再调一次真实 TB 会回 400。两个内存 TB mock 都照这个行为写了,谁把判断去掉都会被测试挡下。

## 发布时清理已删除的旧链(R1,2026-09-08)

`publish` 只写声明里有的链,`cleanup` 又是整站全清,中间没人负责「声明里去掉的运算,它那条链怎么办」。镜像上 08-31 发布的收益链就这样留了下来,链内两个 generator 每 5 分钟自跑一次往旧资产写数,一周后才被发现。

现在写三条链之前先跑一次清理(`pruneStaleChains`):

- 声明里不再需要的种类,把对应的链删掉;Root 链上还有节点转发给它的,只清空不删(Root 由高潮维护,工具永远不写 Root,2026-09-11)。
- **只删两类名字**,都是我们自己建的:本站点的默认链名(`Site Alarms · <站点>` 等,连早就孤立的旧链一起收拾),以及上一版已发布配置声明过的链名(覆盖自定义 `chainName` 与改名)。仍在本次声明里的名字进 keep 集合,绝不删。除这两类之外一律不碰,免得误删同事的链。
- 结果拼进对应步骤的结果行,例如 `alarm:ok 无(已删上一版的 Site Alarms · S)`;Root 还转发着的写成「已清空未删:…请高潮摘除后下次发布再删」。
- 清理失败不阻塞本次写入,只记一条 failure。
- 声明里还有告警时不动链、不摘 Root,避免无谓的节点重启。

## 发布后自检(2026-09-08)

TB 的规则节点如果配置字段名不对,`init` 抛异常、actor 起不来,之后进入该节点的消息被**静默丢弃**:非调试模式下 TB 不记事件、节点错误计数也是 0。镜像上「建告警节点」因为写了 `propagateRelationTypes`(TB CE 4.3.1 只认 `relationTypes`)就这样失败了一天多,直到里程碑 C 做 24 小时采样才发现。

唯一的痕迹是节点的 `LC_EVENT` 里一条 `STARTED success=false`。`publish` 写完链之后把它读回来核对(`writer/health.ts`):

- 查本站点这次该有的链(告警 / 聚合 / 收益)的全部节点,外加 Root 链上**只查我们那条转发节点** —— 别人的节点不归我们判定。
- 判据只有一条:某节点**最近一次** `STARTED` 的 `success === false`。修好重发后新的成功事件会覆盖旧的失败记录。
- 报出链名、节点名、节点类型和摘要过的异常:首行 + 最后一层 `Caused by`(它通常直接点名错的字段,并列出该配置类认得的全部字段,照着改就行),几十行 Java 栈帧丢掉。
- 有节点起不来 → 进 `failures`(step `health`),CLI 退出 1;站点配置照写(声明是真相,自检只是报告,改完编译器重发即可)。
- **读不到事件一律不算失败**:接口报错、取不到 tenantId、事件还没落库,都只报「跳过 / 未判定」。宁可漏报也不能误报把发布挡住。链没被改动时(如「转发已就位」)不会有新事件,计入「暂无事件」属正常。
- `--no-health` / `publish(..., { checkHealth: false })` 关掉。

## 告警导出成同事格式(ADR-001 决定 3,2026-09-08)

- `exportAlarmConfig(cfg, computations, { deviceIds?, labels? })`(`src/core/alarm-export.ts`,纯函数):把展开后的 `alarm.threshold` 运算导出成同事第二轮回填给的样例格式——模板数组 `alarm_config: [{ title, alarm_severity, operator, key, value }]` + 设备清单 `alarm_devices: [{ entityId, entityName, labelName }]`。`title` 取告警名(没有则 `key op value`),`operator` 用 `> < >= <= == !=`,同一模板去重,设备按首次出现排序,`labelName` 优先 TB label → 声明里的 `label` → 设备名。
- 对不上的地方只提示不阻塞(`notes`):边沿触发(他们的格式没有字段)、文案(不带)、离线导出没有 id、某条规则只覆盖部分设备(他们是「模板 × 清单」全乘,会对清单里全部设备生效)。
- `writeAlarmConfig(api, exp, { assetName?, assetType?, force? })`(`src/writer/alarm-export.ts`):资产 `JIZHAN_ALARM_CONFIG`(第三轮回填定的名字,没有则以 type `default` 新建,不分配 Customer)的 SERVER_SCOPE 属性 `alarm_config` / `alarm_devices`,以 JSON 值写入。这是他们引擎读的属性,**默认不覆盖已有非空内容**,`force` 才覆盖并把旧值带回(CLI 存成 `.prev.json`)。
- 一期仍由工具的站点规则链产生告警;导出只是给同事导入 / 核对。切到他们引擎时:`tbsite alarm-export --write` + 删掉我们的告警链(`cleanup`),两套引擎不要同时写告警表。镜像上 2026-09-08 已写过一次(资产 `691a45c0-ab32-11f1-88c6-2b21f8c26565`,1 条模板 + 32 台 IED)。

## 与旧 publisher.js 的差异

- `sum` 窗口聚合原来漏了后缀(会写出 `keyundefined`),现在 `spec.sfx.sum = 'Sum<窗口>'`,取数键也包含 sum 项(与 Python 版一致)。
- 校验失败抛 `ConfigError`(带 `errors` 数组),不再是裸 `Error('校验失败')`。
- 「设为 Public」步骤已移除(T3.7,2026-09-06):站点 / 汇聚资产不再公开;页面资产由 `publishPage` 分给站点所属 Customer。
- 页面发布器 `src/page/publish-page.ts`(T3.7):`publishPage(page, api, { siteName, pageName?, publishedBy })` 六步(按名称解析实体 → 查找 / 创建 ScadaPage 资产 → 历史入栈 → 写属性与 version → Contains 关系 → 分给 Customer),任一步失败逆序回滚;`listSitePages` / `readPageState` / `detectDrift`。CLI:`tbsite page <页面.json> --site <站点>`、`tbsite pages --site <站点>`。

## Python 版已知差异(parity 测试里显式改写)

告警建 / 清节点名(Python 用测点名,这里用告警名)、收益链切换资产节点名、展开提示文案。行为以本包为准。
