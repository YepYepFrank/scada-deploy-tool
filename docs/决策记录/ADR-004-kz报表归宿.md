# ADR-004 kz 归档报表在契约中的归宿

状态:**已采纳路线 A**(2026-09-06 签字;第三轮拿到接口文档并实现通用查询,见文末;2026-09-04 同事回填明确「回写 TB 不可行,必须走 `mode: 'ext'`」;T0.2 契约含 ExtBinding,T3.1 报表槽位迁为 line + ext,T3.8 LegacyDataSource 实现 kz `ext()`;正式签字待补)
关联:架构 v2 §0 ⑫、§6「三条补充约定」;计划 T0.2(契约是否加 `mode: 'ext'`)、T3.1、T3.8

## 背景

现有大屏有 `kind: 'report'` 槽位,前端直调 kzserver `POST /kzserver/biz/power/stationRevenueTrend`(queryType 2 本月逐日 / 3 本年逐月,服务端时钟窗口,鉴权为任意有效 TB token)。契约的五种 `Binding.mode` 都装不下「前端直调扩展服务」。

## 两条路线

| | A · `mode: 'ext'` DataSource 扩展点 | B · kz 回写 TB 遥测,前端只读 TB |
|---|---|---|
| 契约 | 加 `{ mode: 'ext'; source: string; params }`;`DataSource.ext(source, params)` 可选方法 | 不变 |
| 谁改 | YY:tbClient 加 `ext` 实现(把现有 `kzRevenueTrend` 搬进去)、`kz-report` 组件 | 同事:kz 每日把 `stationRevenueTrend` 结果写到站点 Asset 遥测(`calc_revenue_daily` 等) |
| 工作量 | YY 约 0.5 人日 | 同事约 0.5–1 人日(kz 侧)+ YY 0 |
| 符合「运行时只有 TB 一个数据面」(架构 §5 阶段 5) | 否,前端多一条到扩展服务的通道 | 是 |
| 宿主应用要不要知道 kz 地址 | 要(tbClient 配置项) | 不要 |
| 历史可回溯 | 只能查 kz 当前返回 | TB 遥测天然带历史,`ts-history` 直接画 |
| 影响 T3.1 迁移 | `report` 槽位 → `kz-report` 组件 | `report` 槽位 → `line/table` 绑 kz 回写 key |

## 决定(推荐)

**优先 B**。理由:与「结果回写 TB、前端只读 TB」原则一致;宿主与单文件大屏都不需要 kz 地址与反代(顺带消掉 `HAS_KZ` 这类同源判断);报表数据进 TB 后可用 `ts-history` 通用组件画,不需要专用组件。

条件:同事确认 kz 侧回写改造可在 W2 内完成。若不能,一期采用 **A 作为过渡**(契约加 `ext`,标注「过渡,二期迁 B」),且 `ext` 的实现只允许出现在 tbClient 内,渲染器与组件不感知 kz。

## 对代码的直接影响

- 路线 B:契约不变;`api/tb.js` 的 `kzRevenueTrend / kzStations / HAS_KZ` 在 T3.8 删除;T3.1 把 `report` 槽位迁为 `line`(`ts-history`,window `30d`,agg `NONE`)绑 `calc_revenue_daily`;vite 代理 `/kz` 保留到一期末再删。
- 路线 A:T0.2 契约加 `ext`;`packages/tb-client/src/ext/kz.ts`;`packages/renderer/src/widgets/kz-report/`;宿主 tbClient 构造参数加 `extBase`。

## 签字

YY:YY 日期:2026-09-06
同事:高潮、庄艳芹(2026-09-04 / 09-06 两轮书面回填 + 09-06 微信回复视为签字,YY 于 2026-09-06 确认)日期:2026-09-06

## 第二轮回填后的决定(2026-09-06)

- kz 是查询接口服务(数据在 TB 同库的归档表);通用查询按设备 id / 站点 id / 量名 / 毫秒时间段查,鉴权用 TB token,返回 `{ code, msg, data: { <量名>: [{ ts, value, createTime, zdValue }] } }`。
- 契约 `ExtQuery.params` 冻结为 `{ stationId?, deviceId?, keys?, metric? }`;`window` 由 tbClient 换算为 `startTime / endTime`(毫秒);`interval` → kz 粒度参数的映射表放在 tbClient,取值待第三轮。
- `ExtResult.series` = data 里的「量名 → 点列」(`ts / value`,其余字段忽略);统计类 key:value 结果放 `ExtResult.meta`。
- 已实现:`LegacyDataSource.ext()` 的收益趋势(`stationRevenueTrend`,T3.8);通用查询待路径与粒度参数。
- 待第三轮:接口路径、粒度参数、TB TTL 天数、生产 / 现场 kz 地址。

## 第三轮回填后的定稿(2026-09-06,高潮微信 + 接口汇总 docx)

- 通用历史接口:`GET {kz}/kzserver/tskv/{minute|minutefive|hour|day|month|year}/telemetry/{entityType}/{entityId}/values/timeseries?keys=&startTs=&endTs=&interval=&agg=`,头 `X-Authorization: Bearer <TB token>`;`interval` 毫秒;`agg` ∈ AVG / MAX / MIN / ZD;返回 `{ code, msg, data: { 量名: [{ createTime, ts, value, zdValue }] } }`。**粒度是路径段**,映射表 `KZ_BUCKETS` 在 tbClient。
- 查询对象是任意实体 + 任意 key(与 TB 的 `values/timeseries` 同形),不是站点 id → 契约 `params` 改为 `{ entity, keys, agg?, startTs?, endTs? }`;业务统计(收益趋势等 `/biz/power/*`)另用 `{ stationId, metric? }`,按需逐个加。
- 保留期:生产 TB 无 TTL,kz 定时任务 3–7 天清秒级数据;`ts-history` 上限维持 3 天。
- 地址:`http://{ip}:8099/kzserver`,与 TB 同机;`kzBaseUrl` 填主机(或同源反代空串),路径由 tbClient 拼。
- 已实现:`LegacyDataSource.ext()` 通用历史分支(`kzTskv`),一致性用例 +1。本 ADR 无未决项。

## 实测(2026-09-07)

对镜像 kz 逐桶实测(`docs/联调记录/kz-接口实测-2026-09-07.md`):六个粒度桶、四种 agg、资产 key 归档、错误路径与 `LegacyDataSource.ext()` 的实现一致,live 用例 `packages/tb-client/test/live/kz-ext.live.ts` 7/7。三条与文档不同的细节:`interval` 参数被忽略(粒度只看路径)、`year` 桶只回 1 个 `ts` = 查询时刻的点、非 ZD 时 `zdValue` 为 0。**一条安全问题**:kz 的 `tskv/**` 不校验 token(只查非空;`biz/**` 正常,复核见实测记录 §3)——「与 TB 同 token、同权限」的前提在同事修复前不成立,已交高潮(联调环境 §5 待办 ⑤)。
