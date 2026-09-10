# 里程碑 A 联调记录(T2.7)

> 日期:2026-09-05 · 环境:镜像 TB `192.168.20.61:8080`(LXC 111,CE 4.3.1)· 站点:仙人山服务区 · 记录人:YY

## 1. 交付物

| 项 | 位置 |
|---|---|
| 页面配置 | `docs/联调记录/milestone-A.pageconfig.json`(`overview-a`,9 个组件 / 8 种类型:alarm-list、number-card、gauge、status-light、line、dual-axis、table、overview-card) |
| 写入脚本 | 原临时脚本 `put-pageconfig.mjs` 已于 T3.7(2026-09-06)删除;同样的六步现在是 `publishPage`(`packages/compiler/src/page/publish-page.ts`),CLI `pnpm tbsite page <页面.json> --site <站点>`,编辑器工具栏「发布」 |
| 镜像上的资产 | `ScadaPage`「仙人山服务区 · 总览」`7c739b90-a938-11f1-8b57-bb087795a11f`,`additionalInfo.managedBy = deploy-tool`,`version = 2`(第二次写入验证幂等:历史 1 版);由 `xrs-mirror-test` `Contains`;分配给客户「仙人山服务区」 |
| 我方渲染 | `packages/renderer` `/dev` 页「镜像真数据」面板 → 用 CUSTOMER_USER 登录 → 选「页面(ScadaPage 资产)」→ 原样渲染 |

绑定的实体全部是仙人山真实设备(见 `联调环境.md` §4):`SSP1_GP1_IED1`(P / Uab / F / CB / 24h P)、`PDR1_PGC1_METER1`(光伏 P / Q、24h P)、`SSP1_DP1_IED1`(2h P / Q)、`SSP1_GP8_IED1`(Ia / Ib / Ic)、`PDR4_LP1_ATS1`(switch_state / temperature)、告警取 `PDR1_LP1_IED1`(现有 2 条活动告警)。站点级 `calc_total_p` 尚未建(联调环境待办 ②),24h 曲线先绑设备 P。

## 2. §6 清单核对

| # | 项 | 结果 |
|---|---|---|
| 1 | 镜像 TB 上存在 `ScadaPage` 资产,`pageConfig` 为本文件,通过 schema 校验 | ✅ 脚本写入前 schema + 注册表校验通过;`/dev` 页读回并渲染 |
| 2 | 同事应用 `/scada/:assetId` 渲染,≥6 种组件,数据为实时值 | ✅ 2026-09-09 在她的应用里对着镜像资产 `7c739b90…` 实测:9 个组件 8 种,P 41.9 / Uab 47.0 / CB 分闸,同刻 TB latest 42.079 / 46.708 / 0(模拟器相邻采样点),截图 `docs/img/里程碑A-同事宿主-2026-09-09.jpg`,记录 `联调记录/同事宿主接入-2026-09-09.md` §3 |
| 3 | ~~svg-diagram~~ | 暂缓(2026-09-04),`overview-a` 无 main 槽位,本页未放 image |
| 4 | `ts-history` 24h 曲线加载 < 3 秒且点数 ≤ 300 | ✅ 两条 24h 序列(AVG · 5 分钟桶)各 95 ms / 78 ms,115 / 111 点;2h 原始点 493(不在此项范围) |
| 5 | 断开后端 10 秒:徽标变 offline;恢复后续传,无需刷新 | ✅ 容器内 `systemctl restart thingsboard`:2 秒内徽标「离线 · 重连中」,每 3 秒重试,TB 起来后 1 秒内「live」,订阅重放,值继续更新(P 48.3 → 47.0,表格时间戳刷新),全程 0 条 TB 报错 |
| 6 | 宿主构建产物只出现一份 Vue | ✅ 2026-09-10 在她的副本上 `npm run build`:6 个 chunk 里只有 `index-*.js` 含 vue(版本号字面量 1 次、`__vue_app__` 2 次),渲染器把 vue 作为外部依赖不打包、也没有自带的 `node_modules/vue`;产物跑起来 `__vue_app__.version = 3.5.31`、9 槽位实时渲染(provide/inject 能通即同一份 Vue)。详见 `联调记录/客户视角验证-2026-09-10.md` §5 |
| 7 | 部署工具 `/dev` 页与宿主渲染同一份 JSON,视觉一致 | ✅ 2026-09-09 并排对照:布局、槽位、组件、配色一致(`docs/img/里程碑A-dev展示页-2026-09-09.jpg` 与 `里程碑A-同事宿主-2026-09-09.jpg`) |

结论:**§6 清单 7 项全部闭合**(第 3 条按 2026-09-04 决定暂缓不计)。我方 4 项 2026-09-05 通过;宿主侧第 2、7 条 2026-09-09 随 T2.6 验收通过,第 6 条 2026-09-10 在她的构建产物上验完。里程碑 A 宿主侧无遗留。

## 3. 给同事宿主接入的输入

- 资产 id:`7c739b90-a938-11f1-8b57-bb087795a11f`;读 SERVER_SCOPE 属性 `pageConfig`(JSON 字符串)→ `JSON.parse` → `<ScadaPage :config>`。
- ~~页面列表:站点资产 `xrs-mirror-test`(`22e38540-a2c1-11f1-b6b5-f5e88fe257c3`)的 `Contains` 关系里 type = `ScadaPage` 的资产。~~(2026-09-10:页面菜单业务上不需要,一期不做)
- 用 CUSTOMER_USER(`xrs-viewer@…`)登录即可看到该资产与全部 178 台设备;不需要 Public。
- 数据层在 `TbClient` 交付前可先注入 `LegacyDataSource`(`@grid/tb-client`),`provideDataSource(new LegacyDataSource({ baseUrl, getToken }))`。

## 4. 备注

- 模拟器的频率 / 电压数值是随机的(F ≈ 24 Hz、Uab ≈ 42 V),仪表量程告警状态因此不真实,不影响验收。
- `pageConfigHistory` 已按契约 §5 的 `{ ts, publishedBy, version, config }` 写入,里程碑 B 的回滚可直接用。
