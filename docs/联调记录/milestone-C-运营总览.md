# 里程碑 C 候选页面「仙人山服务区 · 运营总览」· 2026-09-07

> 目的:清单第 3 项——用同事已在 TB 上算好的站点级资产遥测(KEY 清单 / 接口汇总里的 `REALTIME_* / SITE_OVERVIEW`)做一版正式总览页,再用 `ext` 绑一条 30 天曲线,作为里程碑 C 的验收页面。页面文件 `sites/pages/xrs-mirror-test-运营总览.pageconfig.json`,用 `tbsite page … --site xrs-mirror-test --name "仙人山服务区 · 运营总览"` 发布,ScadaPage 资产 `8c435790-aa82-11f1-88c6-2b21f8c26565` version 1,由 `xrs-mirror-test` Contains、分给「仙人山服务区」。

## 1. 页面内容(overview-a,9 槽位)

| 槽位 | 组件 | 数据 | 来源 |
|---|---|---|---|
| banner | alarm-list | `xrs-mirror-test` 资产的告警(工具告警链 `propagate` 沿 Contains 上传) | 我们 |
| s1 | number-card 全站负荷总功率 | `REALTIME_TOTAL_LOAD_POWER.tsLoadPowerTotal` | 同事 |
| s2 | number-card 全站发电功率 | `SITE_OVERVIEW.totalGenerationPower` | 同事 |
| s3 | number-card IED 进线总有功 | `xrs-mirror-test-agg.calc_totalP`(32 台 IED 汇聚) | 我们 |
| s4 | number-card 光伏出力总功率 | `REALTIME_TOTAL_PV_POWER.tsPvPowerTotal` | 同事 |
| g1 | line 24h(TB,5 分钟均值) | `calc_totalP` + `tsLoadPowerTotal` 两条 `ts-history` | 我们 + 同事 |
| g2 | line 30 天柱状(kz 归档,日均) | `ext` × 2:`REALTIME_TOTAL_PV_POWER.tsPvPowerTotal`、`SITE_OVERVIEW.totalGenerationPower`,day 桶 | 同事资产 · kz |
| g3 | table 分区负荷 | `tsLoadPowerTotalSSP1 / SSP2 / PDR / ABS` | 同事 |
| g4 | overview-card 新能源与充电 | 光伏 / 风电 / 绿电 / EV 充电四条 `ts` | 同事(4 个资产) |

`ext` 的 30 天曲线走 kz `day` 桶:光伏 14 个点(归档自 08-09 起)、发电 14 个点;我们自己的 `calc_totalP` 昨晚才产生,day 桶还没有整天,所以 30 天曲线先用同事的资产。渲染器顺手改了 `ext` 图例名(通用历史用 `params.keys[0]`,不再显示 `kz-0`)。

## 2. 实测(独立大屏 `site.html?site=xrs-mirror-test`,开发服务,2026-09-07 02:10)

| 视角 | 结果 |
|---|---|
| **租户** `tenant@thingsboard.org` | 9 个组件全部有数:负荷 1291.4 kW、发电 10616.6、IED 汇聚 13622.4、光伏 10597.2;24h 曲线两条;30 天柱状 14 天;分区负荷四行;新能源四项。控制台零错误 |
| **客户** `xrs-viewer@gridops.local`(仙人山服务区) | 顶栏「6 个绑定在当前账号下不可见」:同事的 6 个资产(TB 侧 `ts` / `ts-history`)全部「不可用」;我们的 `calc_totalP` 卡片与 24h 曲线有数;**kz 的 30 天柱状照常有数** |

客户视角里 kz 曲线「照常有数」不是因为权限对,而是 kz 目前不校验 token(见 `kz-接口实测-2026-09-07.md` §3)——权限修好后,这两条 `ext` 也会随资产归属一起不可见。

## 3. 阻塞点:资产的 Customer 归属(需要三方定)

TB CE 里一个资产只能属于一个 Customer。现状:

| 实体 | 归属 Customer |
|---|---|
| 仙人山 178 台设备、`xrs-mirror-test`、`xrs-mirror-test-agg`、三个 ScadaPage | **仙人山服务区**(我们 T0.4 建的) |
| 同事的 `SITE_OVERVIEW`、`REALTIME_*`、`HIST_*`(26 个) | **客户账号**(他们现有大屏的登录客户,用户 `jizhan@126.com` 等) |

所以任何一个客户账号都看不全这张页面。三个出路,按推荐排序:

1. **生产环境统一到一个 Customer**:同事的资产与我们发布的站点 / 页面 / 汇聚资产都归同一个项目客户。在镜像上就是把 26 个资产改分给「仙人山服务区」,或者把我们的东西改分给「客户账号」并把 178 台设备也分过去。**是他们的资产,归属改动要高潮 / 庄艳芹点头**,不能我们单方面做。
2. 页面只绑我们自己的实体(设备遥测 + `calc_` 汇聚),同事的站点级量由我们的编译器重算一遍(`aggregate.crossEntity` 已能做)。可行但重复计算,且与「用他们算好的值」初衷相反。
3. 同事的应用用它自己的客户账号看我们的页面:页面资产得分给「客户账号」,则我们的设备级绑定又不可见。

在定下来之前,这张页面按租户视角验收(全有数),客户视角的 6 个不可用项记为已知。已列入 `联调环境.md` §5 待办 ⑥、`给同事的开发说明.md` §4.5。

## 3.1 结论(2026-09-07 晚)

- **kz 鉴权**:高潮 2026-09-07 晚回复:是他之前配置错了,会把 `tskv/**` 改成和 `/biz` 一样的鉴权策略。修复后用 `KZ_AUTH_FIXED=1 pnpm -F @grid/tb-client test:live` 复测(`kz-auth.live.ts`);届时客户视角的两条 `ext` 曲线会随资产归属一起可见 / 不可见。
- **资产归属**:2026-09-07 晚三方同意:资产归属统一到一个 Customer(出路 1)。镜像上两个方向,只读核对(`tb-customers`)后推荐 **A**:

| 方向 | 动作 | 影响 |
|---|---|---|
| **A(推荐)**:并到「仙人山服务区」 | 把「客户账号」名下 39 个资产(含 KEY 清单 26 个 + menu / Report_List / picture 等)与 7 台 `BS_*` 设备改分给「仙人山服务区」 | 与工具「一站一个 Customer、资产随站点」的模型一致;`xrs-viewer` 直接看全;「客户账号」的两个用户(`jizhan@126.com` 最近登录 2026-07-09,报表账号从未登录)之后看不到这些资产——镜像上无人在用,生产上同事应用改用站点客户的用户即可 |
| B:并到「客户账号」 | 把 178 台设备 + 站点 / 汇聚 / 3 个 ScadaPage 改分给「客户账号」 | 我们的 CUSTOMER_USER 在另一个客户下、TB 不能跨客户挪用户,得在「客户账号」下再建预览账号并改 `.env.local`;生产多站点时「客户账号」这种全局客户与一站一客户冲突 |

执行 A 的步骤:租户 token 调 `POST /api/customer/{仙人山服务区}/asset/{id}` × 39、`.../device/{id}` × 7(幂等,可回退);然后 `xrs-viewer` 登录单文件大屏开「运营总览」,顶栏不应再有「不可见」提示;`docs/联调记录` 补一行复验结果,待办 ⑥ 勾掉。

## 4. 顺带发现

- 24h 曲线里 `tsLoadPowerTotal` 是近乎水平的直线(1290 kW 左右),而 `calc_totalP` 在 13 MW 量级——两个口径不同(他们的负荷总功率不含 `PDR4_T3_IED1` 那台 11 MW 的模拟器设备),同屏并列会误导,正式版要么拆成两张图,要么在标题里写清口径。
- 客户视角下,一个组件只要有一条绑定不可见,整张图打「数据不可用」标记,即使另一条曲线画出来了——这是渲染器现有语义(任一绑定失败即错误态),对「部分可见」的页面偏严,记入渲染器待办。
