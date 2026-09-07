# ADR-004 kz 归档报表在契约中的归宿

状态:**采纳路线 A**(2026-09-04 同事回填明确「回写 TB 不可行,必须走 `mode: 'ext'`」;T0.2 契约含 ExtBinding,T3.1 报表槽位迁为 line + ext,T3.8 LegacyDataSource 实现 kz `ext()`;正式签字待补)
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

YY:____ 日期:____
同事:____ 日期:____
