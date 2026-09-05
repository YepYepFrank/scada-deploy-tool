# 里程碑 A 联调记录(T2.7)

> 日期:2026-09-05 · 环境:镜像 TB `192.168.20.61:8080`(LXC 111,CE 4.3.1)· 站点:仙人山服务区 · 记录人:YY

## 1. 交付物

| 项 | 位置 |
|---|---|
| 页面配置 | `docs/联调记录/milestone-A.pageconfig.json`(`overview-a`,9 个组件 / 8 种类型:alarm-list、number-card、gauge、status-light、line、dual-axis、table、overview-card) |
| 写入脚本(临时,T3.7 后删) | `packages/compiler/scripts/put-pageconfig.mjs`:本地 schema + 注册表校验 → 建 / 更新 `ScadaPage` 资产 → 写 `pageConfig` / `pageConfigHistory` → 站点 `Contains` 关系 → 分给 Customer |
| 镜像上的资产 | `ScadaPage`「仙人山服务区 · 总览」`7c739b90-a938-11f1-8b57-bb087795a11f`,`additionalInfo.managedBy = deploy-tool`,`version = 2`(第二次写入验证幂等:历史 1 版);由 `xrs-mirror-test` `Contains`;分配给客户「仙人山服务区」 |
| 我方渲染 | `packages/renderer` `/dev` 页「镜像真数据」面板 → 用 CUSTOMER_USER 登录 → 选「页面(ScadaPage 资产)」→ 原样渲染 |

绑定的实体全部是仙人山真实设备(见 `联调环境.md` §4):`SSP1_GP1_IED1`(P / Uab / F / CB / 24h P)、`PDR1_PGC1_METER1`(光伏 P / Q、24h P)、`SSP1_DP1_IED1`(2h P / Q)、`SSP1_GP8_IED1`(Ia / Ib / Ic)、`PDR4_LP1_ATS1`(switch_state / temperature)、告警取 `PDR1_LP1_IED1`(现有 2 条活动告警)。站点级 `calc_total_p` 尚未建(联调环境待办 ②),24h 曲线先绑设备 P。

## 2. §6 清单核对

| # | 项 | 结果 |
|---|---|---|
| 1 | 镜像 TB 上存在 `ScadaPage` 资产,`pageConfig` 为本文件,通过 schema 校验 | ✅ 脚本写入前 schema + 注册表校验通过;`/dev` 页读回并渲染 |
| 2 | 同事应用 `/scada/:assetId` 渲染,≥6 种组件,数据为实时值 | ⏳ 宿主接入(T2.6)待同事;我方 `/dev` 页已渲染 8 种组件,实时值与 TB latest 一致(P 48.7 kW、Uab 42.1 V、三相电流时间戳与 TB 同秒) |
| 3 | ~~svg-diagram~~ | 暂缓(2026-09-04),`overview-a` 无 main 槽位,本页未放 image |
| 4 | `ts-history` 24h 曲线加载 < 3 秒且点数 ≤ 300 | ✅ 两条 24h 序列(AVG · 5 分钟桶)各 95 ms / 78 ms,115 / 111 点;2h 原始点 493(不在此项范围) |
| 5 | 断开后端 10 秒:徽标变 offline;恢复后续传,无需刷新 | ✅ 容器内 `systemctl restart thingsboard`:2 秒内徽标「离线 · 重连中」,每 3 秒重试,TB 起来后 1 秒内「live」,订阅重放,值继续更新(P 48.3 → 47.0,表格时间戳刷新),全程 0 条 TB 报错 |
| 6 | 宿主构建产物只出现一份 Vue | ⏳ 待同事宿主 |
| 7 | 部署工具 `/dev` 页与宿主渲染同一份 JSON,视觉一致 | ⏳ 宿主侧待同事;我方侧已就绪(同一份 `pageConfig`) |

结论:我方能做的 4 项全部通过;2 / 6 / 7 三项等同事的宿主接入(T2.6),届时在本表补勾并附并排截图。

## 3. 给同事宿主接入的输入

- 资产 id:`7c739b90-a938-11f1-8b57-bb087795a11f`;读 SERVER_SCOPE 属性 `pageConfig`(JSON 字符串)→ `JSON.parse` → `<ScadaPage :config>`。
- 页面列表:站点资产 `xrs-mirror-test`(`22e38540-a2c1-11f1-b6b5-f5e88fe257c3`)的 `Contains` 关系里 type = `ScadaPage` 的资产。
- 用 CUSTOMER_USER(`xrs-viewer@…`)登录即可看到该资产与全部 178 台设备;不需要 Public。
- 数据层在 `TbClient` 交付前可先注入 `LegacyDataSource`(`@grid/tb-client`),`provideDataSource(new LegacyDataSource({ baseUrl, getToken }))`。

## 4. 备注

- 模拟器的频率 / 电压数值是随机的(F ≈ 24 Hz、Uab ≈ 42 V),仪表量程告警状态因此不真实,不影响验收。
- `pageConfigHistory` 已按契约 §5 的 `{ ts, publishedBy, version, config }` 写入,里程碑 B 的回滚可直接用。
