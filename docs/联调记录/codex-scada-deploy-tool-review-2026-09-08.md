# scada-deploy-tool 代码审查与开发计划核对

审查日期：2026-09-08。仓库：[YepYepFrank/scada-deploy-tool](https://github.com/YepYepFrank/scada-deploy-tool)。审查基线：`main` 的 `ac73e584729a75f50f062bdf5b97e9ea8b11f570`，提交时间 2026-09-08 17:00:52（北京时间）。

**结论：主要编辑、编译、发布和渲染模块已经实现，现有自动化检查通过；但尚不满足一期完整验收条件，且补充边界测试确认了 5 个功能缺陷，其中 3 个 P1、2 个 P2。建议修复 P1 并补齐宿主与现场验收后，再认定一期完成。**

本次执行源码审查、本地构建及 mock 测试；没有修改业务源码、提交或推送代码，也没有对 TB/kz 环境执行发布、清理或迁移。复现中的数据删除仅发生在内存 mock 中。审查结束时受版本控制文件的 `git status --porcelain` 为空。

## 1. 已确认的问题

P1：应优先修复，影响数据完整性、告警行为或客户可见范围。P2：有明确触发条件的功能错误，应在相应功能验收前修复。R 编号与附件复现用例保持一致。

### R4 · [P1] 迁移中断后重试，会漏搬数据并可能删除唯一旧副本

代码位置：[writer/migrate.ts:107–108](https://github.com/YepYepFrank/scada-deploy-tool/blob/ac73e584729a75f50f062bdf5b97e9ea8b11f570/packages/compiler/src/writer/migrate.ts#L107-L108)，删除分支在 [130 行起](https://github.com/YepYepFrank/scada-deploy-tool/blob/ac73e584729a75f50f062bdf5b97e9ea8b11f570/packages/compiler/src/writer/migrate.ts#L130-L145)。

- 触发：执行 `migrate --apply --delete-old`，部分批次写入成功，随后网络请求失败，再运行同一迁移。
- 根因：每次启动都把“新 key 当前最早时间戳”作为复制上界；首批写入旧历史后，这个时间戳已经变早。重试时把已搬入的第一个历史点误认为新数据的原始起点，余下历史全部跳过，随后仍执行旧 key 全量删除。
- 本地复现：旧 key 有时间点 `[100,200,300]`，新 key 原有 `[400]`；第一批搬入 `100`，第二批失败。重试后新 key 只有 `[100,400]`，`200/300` 没有搬入，旧 key 已被删除。
- 修复建议：在迁移开始时持久化原始边界和进度；重试保持同一边界，并采用可重入的复制策略。删除旧数据前验证完整复制区间，不能以“本轮循环无异常”作为完成依据。
- 关联计划：ADR-003 历史迁移；2026-09-08 从二期提前落地的 `tbsite migrate`。

### R1 · [P1] 删除最后一条告警后重新发布，旧告警链仍在工作

代码位置：[writer/publish.ts:346–361](https://github.com/YepYepFrank/scada-deploy-tool/blob/ac73e584729a75f50f062bdf5b97e9ea8b11f570/packages/compiler/src/writer/publish.ts#L346-L361)。定时聚合与收益链的空配置分支也存在相同模式，分别见 [316 行](https://github.com/YepYepFrank/scada-deploy-tool/blob/ac73e584729a75f50f062bdf5b97e9ea8b11f570/packages/compiler/src/writer/publish.ts#L316)及 [337 行](https://github.com/YepYepFrank/scada-deploy-tool/blob/ac73e584729a75f50f062bdf5b97e9ea8b11f570/packages/compiler/src/writer/publish.ts#L337)。

- 触发：先发布含告警的站点，再删除所有 `alarm.threshold` 运算并重新发布。
- 根因：`alarms.length === 0` 时只报告“无”，没有清空/删除上一版链，也没有摘除 Root 转发；随后站点配置却更新成“不含告警”的声明。发布成功不代表实际运行状态与声明一致。
- 本地复现：两次发布均返回空失败列表；第二次发布后 `Site Alarms · S` 仍存在，现有代码也没有改动其 Root 转发和节点配置。测试针对告警路径；聚合/收益空分支的相同风险由静态代码确认。
- 影响：用户以为已经停用的规则继续产生告警或定时结果，后续检查仅比对保存的 `siteConfig` 还可能看不出运行状态残留。
- 修复建议：按上一版受管理实体清单与新配置做差异更新；移除已撤销的转发和规则。不要用整站 `cleanup` 代替更新发布，它会删除站点及其他仍需保留的对象。
- 关联计划：T1.3 更新发布、T4.1 全链路上线与实际运行一致性。

### R2 · [P1] 站点取消 Customer 分配后，页面仍留在原 Customer 下

代码位置：[page/publish-page.ts:323–325](https://github.com/YepYepFrank/scada-deploy-tool/blob/ac73e584729a75f50f062bdf5b97e9ea8b11f570/packages/compiler/src/page/publish-page.ts#L323-L325)。

- 触发：页面已随站点分配给 Customer A，之后将站点改成未分配，再发布同一页面。
- 根因：识别到站点无 Customer 时只写成功日志，没有对已有页面执行取消分配。
- 本地复现：第二次发布返回 `ok: true`，页面 `customerId` 仍为 `cust-xrs`，不是未分配标识。
- 影响：原 Customer 仍拥有页面资产的访问权限，页面配置、静态内容及仍可访问的数据未随站点归属撤销。这里并不意味着它能越过 TB 的设备权限读取所有遥测。
- 修复建议：对“有客户→无客户”显式调用页面取消分配接口，并把恢复原客户加入回滚栈；补齐无→有、有→另一客户、有→无三类测试。
- 关联计划：T3.7 发布器的 Customer 同步、T3.10/T4.2 客户权限验收。

### R3 · [P2] 历史绑定允许选择多个测点，但渲染器只保留第一个

代码位置：[binding-resolver.ts:214–230](https://github.com/YepYepFrank/scada-deploy-tool/blob/ac73e584729a75f50f062bdf5b97e9ea8b11f570/packages/renderer/src/binding-resolver.ts#L214-L230)。编辑器入口见 [BindingRow.vue:231–240](https://github.com/YepYepFrank/scada-deploy-tool/blob/ac73e584729a75f50f062bdf5b97e9ea8b11f570/apps/deploy-tool/src/editor/BindingRow.vue#L231-L240)。

- 触发：在一条历史曲线绑定中通过“再加一个测点”配置 `keys: ['P','Q']`。
- 根因：`getHistory` 请求全部 keys，但解析器取 `one.keys[0]`，只保留其历史并只订阅这一个 key。外部源也在 [207 行](https://github.com/YepYepFrank/scada-deploy-tool/blob/ac73e584729a75f50f062bdf5b97e9ea8b11f570/packages/renderer/src/binding-resolver.ts#L207)只取返回的第一条序列。
- 本地复现：mock 同时返回 P/Q 两条历史，解析结果只有 `['P']`；Q 被静默丢弃。
- 修复建议：统一“一项绑定一条序列”的契约与 UI。可把多选操作转换成多条单 key 绑定，并对单项 keys 数量做校验；也可完整展开多个返回序列，但须一并明确图例、实时订阅与数组语义。不能继续让用户选择后无提示地丢数据。
- 关联计划：T1.2 绑定解析、T3.4 绑定选择、T3.5 校验。

### R5 · [P2] 汇聚资产同步客户归属时，把未分配标识当成真实 Customer

代码位置：[writer/publish.ts:141](https://github.com/YepYepFrank/scada-deploy-tool/blob/ac73e584729a75f50f062bdf5b97e9ea8b11f570/packages/compiler/src/writer/publish.ts#L141)。

- 触发：目标站点未分配 Customer，而已有汇聚/收益资产仍属于一个客户。
- 根因：`followSiteAsset` 直接使用站点的 `customerId.id`；未过滤 TB 的 `NULL_UUID`。它是非空字符串，因此会请求向该“客户”分配资产，而不是取消分配。
- 本地复现：mock 对向 `NULL_UUID` 分配的请求返回 404；发布返回 `step: 'asset'` 失败。失败发生前站点配置等内容已写入，形成部分更新。
- 修复建议：统一页面和汇聚资产的 Customer ID 归一化及取消分配逻辑，并明确旧归属在同步失败时的处理方式。
- 关联计划：T1.3 规则发布、T3.7/T4.2 资产归属与客户可见性。

## 2. 本次实际验证结果

本地环境：Windows、Node `24.15.0`、pnpm `9.15.9`。仓库 CI 使用 Node 22，故本次不宣称已经覆盖 Node 22 或目标 Linux 环境。初次误用本机 pnpm 11 后，已改用项目指定版本重新安装；其自动添加的 workspace 设置也已还原。

| 检查 | 结果 | 说明 |
|---|---|---|
| 指定 pnpm 版本、冻结锁文件安装 | 通过 | `pnpm install --frozen-lockfile` |
| 四个 workspace 类型检查 | 通过 | compiler、tb-client、renderer、deploy-tool |
| 三个包构建 | 通过 | 含 ESM 与类型声明 |
| 现有测试 | **198/198 通过** | compiler 81、tb-client 19、renderer 45、deploy-tool 53；26 个测试文件 |
| Python parity | 3/3 通过 | 包含于 compiler；基于仓库固定 Python 输出快照，没有在本次重新执行仓库外 Python 编译器 |
| JSON Schema 同步检查 | 通过 | 包含于 renderer schema 测试；测试后受跟踪源码无变化 |
| 部署工具多页构建 | 通过 | provisioner / editor / site |
| 独立大屏构建 | 通过 | `site.html` 约 802.25 kB，gzip 270.65 kB；构建另输出 logo 资源，未进行“只复制 HTML”的浏览器交付验收 |
| lint / format:check | 通过 | lint 有 Node 对配置文件模块类型的提示，不是规则失败 |
| 本次新增边界复现 | **5/5 按正确行为断言失败** | 对应上述 5 个缺陷；辅助测试独立运行，不混入原有 198 条测试 |
| TB/kz live、宿主浏览器验收 | 未执行 | 没有使用联调凭据或运行环境；仓库中的历史联调记录仅作为已有证据，未冒充本次结果 |

顺序说明：compiler 的迁移测试依赖 renderer 构建产物。首次在构建未完成时跑测试会提示“缺少 packages/renderer/dist”；按 CI 的“先 build 后 test”顺序重跑后 198 条全部通过。此项不计为本次功能缺陷。

测试通过说明现有场景稳定，不能推出边界条件完整。此次缺口集中在状态变化与失败恢复：删除最后一条规则、客户归属撤销、迁移分批中断，以及 UI 与解析器之间的数据形状不一致。

## 3. 按开发计划逐项核对

依据：[开发计划-v2.md（固定提交）](https://github.com/YepYepFrank/scada-deploy-tool/blob/ac73e584729a75f50f062bdf5b97e9ea8b11f570/docs/%E5%BC%80%E5%8F%91%E8%AE%A1%E5%88%92-v2.md)。按文档当前条目共 **31 项，22 项已勾选、9 项未勾选**。22/31≈71% 仅为文档勾选比例，任务工作量不同，且有条件勾选、外部依赖与范围调整，**不能作为功能完成率**。

“本地通过”指代码/本地测试可核对；“记录支持”指仓库文档声称曾完成，本次没有重跑目标环境验收。

| 任务 | 计划标记 | 本次判断与证据 |
|---|---|---|
| T0.1 四项模型决定 | 已勾选 | 四份 ADR 存在，有后续定稿与签字记录；按后续定稿解释，不能只读旧推荐段落。 |
| T0.2 契约冻结 | 已勾选 | TS 契约、生成 Schema、校验与非法样本均存在，本地 schema 测试通过；宿主类型导入仍属外部验证。 |
| T0.3 monorepo 与迁入 | 已勾选 | 三包一应用结构成立；指定版本安装、类型检查与构建通过。原项目目录冻结状态在此 repo 外，未复核。 |
| T0.4 联调站点与账号 | 已勾选 | 联调环境文档存在；实体当前可访问性和账号登录本次未验证。 |
| T1.1 正式 tbClient 0.1 | 未勾选 | 未完成外部交付验收。本仓库有 DataSource 契约、LegacyDataSource、testing 一致性套件，不能代替同事仓库实现的交付。 |
| T1.2 渲染器骨架 | 已勾选 | ScadaPage、注册表、绑定解析、布局与 mock 测试存在并通过；R3 显示历史多 key 路径不完整。 |
| T1.3 TS 编译核心与 CLI | 已勾选 | 编译、writer、CLI、parity 与 mock 发布通过；R1/R5 影响更新发布与归属同步，目标环境本次未重跑。 |
| T1.4 SVG 接线图 props 化 | 未勾选、暂缓 | 计划已明确一期用 image 占位；不计为未兑现的当前一期必做功能。 |
| T2.1 六种改造组件 | 已勾选 | number-card、gauge、line、dual-axis、overview-card、alarm-list 均有实现及集中组件测试。本次没有重做前后并排视觉验收。 |
| T2.2 四种新组件 | 已勾选 | status-light、table、image、text 均存在，组件测试通过。 |
| T2.3 三个页面模板 | 已勾选 | overview-a、monitor-3col、grid-3x3 实现与模板测试存在；本次未做各视口浏览器验收。 |
| T2.4 dev 展示与包交付 | 已勾选 | dev 展示源码与 0.2.0 renderer 构建可核对；文档明确正式同事宿主 import 验证并入 T2.6，尚未闭环。 |
| T2.5 已完成模块测试起步 | 已勾选 | live 测试源码与历史记录存在，元数据 mock 测试通过；Profile 路径按 ADR-001 取消，本次没有重跑 live。 |
| T2.6 宿主应用接入 | 未勾选 | 关键外部阻塞：正式宿主路由、菜单、渲染与运行数据需在同事仓库验收；SVG 部分按延期处理。 |
| T2.7 里程碑 A 演示 | 已勾选、我方部分 | 样例与联调记录存在；任务完成标准要求 A 全部通过，目前正式宿主相关条目仍未完成。 |
| T3.1 siteConfig 迁移 | 已勾选 | 迁移函数与 15 条测试通过。这里是页面配置迁移，与 R4 的遥测历史 key 迁移不是同一个功能。 |
| T3.2 模板/槽位 UI | 已勾选 | EditorApp、SlotBoard、WidgetPicker、撤销重做及向导接入存在，相关测试通过。 |
| T3.3 属性表单 | 已勾选 | propsSchema 表单、数值/数组校验与撤销合并有实现和测试。 |
| T3.4 绑定选择器 | 已勾选 | 元数据树、虚拟列表、KeyPicker、绑定编辑实现和测试通过；历史多 key 选项触发 R3。ext 通用参数仍需编辑 JSON。 |
| T3.5 四层校验 | 已勾选 | schema、注册表、props、必填、实体/key 校验和 actions 提示实现；对 ext 跳过实体/key 存在性层，不能称覆盖所有绑定。 |
| T3.6 预览与客户视角 | 已勾选 | 独立 Customer 登录、错误汇总和切换数据源有 mock 测试；真实权限与正式宿主对照未在本次执行。 |
| T3.7 发布/项目/漂移 | 已勾选 | 六步发布、回滚、历史、按名解析、scadaproj、漂移检测存在，现有测试通过；R2 说明客户归属撤销未覆盖，正式宿主可见性仍待验收。 |
| T3.8 登录薄壳与清理 | 已勾选 | standalone 登录/页面列表/渲染源码存在并可构建，旧数据链路有删除记录。长期会话不刷新 token 是交付限制，见下文。 |
| T3.9 模板与打磨 | 已勾选 | 0.2.0、migrateProps、缩放与空态测试可核对；视觉结果仅有历史记录支持。 |
| T3.10 正式客户端反馈与权限 | 未勾选 | 需同事仓库正式客户端及宿主 CUSTOMER_USER 验证；LegacyDataSource 的 mock 通过不能替代。 |
| T3.11 测试收尾 | 已勾选 | 规则链/live、kz/live、元数据测试与说明存在；本次仅确认本地部分，live 依据历史记录。 |
| T4.1 全链路联调 | 未勾选 | 未有本次“工程人员独立≤2小时、开发者介入0次、持续运行24小时”的证据。 |
| T4.2 客户视角验收 | 未勾选 | 单文件大屏有部分历史记录，正式宿主侧仍待 T2.6/T3.10；不能判定全部完成。 |
| T4.3 缺陷修正 | 未勾选 | 本次新增 3 个 P1、2 个 P2，需要关闭或明确排期；不满足验收前 P0/P1 全关闭的条件。 |
| T4.4 文档 | 未勾选 | 操作说明、截图和前端部署指南 v2 存在；未参与开发者独立照文档操作的验收未完成；根目录 handoff 是仓库外交付，未核对。 |
| T4.5 一期验收 | 未勾选 | C 未全部完成；当前版本 renderer 0.2.0、tb-client 0.0.1、compiler 0.1.0，不是三个 1.0.0-rc.1；本地完整克隆的 tag 列表为空。 |

### 里程碑判断

| 里程碑 | 本次结论 | 尚缺的关键证据 |
|---|---|---|
| A：手写 JSON 在正式宿主实时渲染 | **未完整通过** | 同事宿主路由与实时渲染、同一 JSON 的视觉对照、正式宿主构建集成。SVG 已暂缓。 |
| B：无代码编辑、发布、宿主刷新可见 | **工具侧链路已实现，完整验收未闭环** | 文档的“宿主刷新可见”实际用独立大屏作部分替代，并注明正式宿主待 T2.6；另需修复 R2/R3 等边界。 |
| C：真实项目独立上线 | **未通过** | 工程人员独立操作、告警修复后重新累计的24小时验证、正式宿主客户视角、文档验证及版本/tag。 |

C 的稳定性记录明确：告警节点在 2026-09-08 06:53Z 修复后重新计时（北京时间 14:53），因此到 2026-09-09 14:53 前不足完整 24 小时。此处是对仓库历史记录的时间核对，没有重新查询线上采样数据。

## 4. 需要在交付说明中明确的限制

1. **长期会话尚未闭环。** StandaloneApp 登录只保存 access token，创建 LegacyDataSource 时提供固定 `s.token`；LegacyDataSource 明确不负责 token 刷新。token 失效后的重连不会自动拿到新 token，REST 告警轮询除 403 外会保留旧结果并重试。需要正式客户端接入，或在独立薄壳中实现刷新/明确过期退出，再做跨有效期验收。本次未测真实 token 有效期，不把这一项伪装成 live 复现。
2. **ext 的无代码配置与校验有缺口。** BindingRow 的 ext 参数通过 JSON 编辑；`validateBindingsLayer` 对 ext 直接跳过。虽有 CLI/发布阶段实体按名解析支持，但“所有业务绑定均可树选且存在性已校验”尚不能成立。契约/ADR 后续冻结的 `{entity,keys}` 应补到编辑器与校验器。
3. **文档含旧结论，需整理现行判据。** 计划 C 清单仍写 LegacyDataSource“无重连”，但当前源码有 reconnect timer、订阅重放，一致性测试也覆盖重连；正式客户端 token 刷新等验收依然未完成。建议将推荐稿、已废弃要求、最终决定清楚分开。
4. **不把范围调整误判为漏做。** 按 ADR-001 最终决定，Profile 告警一律不写；按 T1.4 修订，SVG 接线图一期暂缓；RPC、地图注册、自定义模板、Tauri、E2E 自动化仍在二期。它们不应计入当前必做功能缺陷。

## 5. 建议的收尾顺序

1. 修复 R4，先保证迁移失败可恢复、删除前有完整性验证；将中断重试用例纳入常规测试。
2. 修复 R1/R2，补齐配置撤销、客户归属撤销这两类状态转换。
3. 修复 R3/R5，统一数据绑定语义与资产归属处理；为 ext 补树选和校验。
4. 完成 T1.1/T2.6/T3.10：用正式客户端和正式宿主运行同一组契约测试，并覆盖 token 过期、断线恢复、客户越权错误与包集成。
5. 在隔离联调环境重跑更新发布、回滚、迁移、客户视角，再完成24小时观察和工程人员独立操作，最后整理版本与验收 tag。

本报告不代替生产环境验收。缺陷修复完成后，应以具体回归结果关闭对应 R 编号，而不是仅重新勾选计划任务。

附件 `scada-review-evidence.zip` 包含复现测试、运行配置、现有测试/构建/检查日志及运行说明；复现测试对“正确行为”断言，在本次基线预期有 5 个失败。
