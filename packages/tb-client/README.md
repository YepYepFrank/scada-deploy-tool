# @grid/tb-client

ThingsBoard 数据访问包。现在包含两样东西:

- **`DataSource` 契约类型**(`src/data-source.ts`,契约 v1 §4):渲染器只依赖这个接口。
- **`LegacyDataSource`**(`src/legacy-adapter.ts`,T1.1 预案):在同事的 `TbClient` 交付前,用向导同一套 TB 调用(REST + `/api/ws/plugins/telemetry` 的 `tsSubCmds / attrSubCmds`)临时实现 `DataSource`,让 `/dev` 页与宿主能吃镜像真数据。同事版到位后整个文件删除。

```ts
import { LegacyDataSource } from '@grid/tb-client'
import { provideDataSource } from '@grid/scada-renderer'

const ds = new LegacyDataSource({ baseUrl: '/tbm', getToken: () => token })
provideDataSource(ds) // 之后换成 provideDataSource(new TbClient(...)),渲染器一行不改
```

刻意保持薄:一条 WS;断线 3 秒后重连并重放全部订阅;同一 tick 内的订阅变更合并成一条消息(渲染器切配置时 dispose 全部再重订);没有订阅时关掉连接;告警走 REST 轮询(10 秒);不合并重复订阅;不做 token 刷新(宿主通过 `getToken` 提供)。`getHistory` 按窗口自适应聚合:≤2h 原始点,2h–24h 5 分钟 AVG,24h–7d 1 小时,>7d 1 天。

- **`ext()` 通用历史(2026-09-06,第三轮回填定稿)**:`params = { entity, keys, agg?, startTs?, endTs? }` → `GET {kz}/kzserver/tskv/{桶}/telemetry/{type}/{id}/values/timeseries`;契约 `interval` → 路径段 + 毫秒的映射表 `KZ_BUCKETS`(缺省按窗口 `defaultKzInterval`),`agg` ∈ AVG / MAX / MIN / ZD(默认 AVG);返回按量名升序归一,`meta { bucket, agg, startTs, endTs }`。一致性套件里有对应用例,同事 TbClient 也要过。
- **`ext()` 收益趋势(ADR-004 路线 A,T3.8 起)**:`LegacyDataSource` 实现了 `source: 'kz'` 的收益趋势——`kzBaseUrl` 选项给 kz 地址(同源 `/kz` 反代或 `http://host:8099`),用同一个 TB token 鉴权;`params.stationId` 必填,`params.metric` 可指定只要 `inc / cost / net` 之一;kz 只支持「本月逐日 / 本年逐月」,本月没归档自动降级为逐月(`meta.mode`)。同事的 TbClient 照此语义实现即可,`test/legacy-adapter.test.ts` 的 kz 用例可搬到一致性套件。

## 一致性测试(同事交付 TbClient 时的验收)· 子路径 `@grid/tb-client/testing`

按第二轮回填(2026-09-06)的分工,`TbClient` **留在同事的应用仓库**(直接 import 她的 `request.js / websocket.js`,不进本仓库);本包只放契约类型、`LegacyDataSource` 预案和这套一致性用例。

```
src/testing/fake-tb.ts        内存版 TB:REST(timeseries / alarm)+ WS(tsSubCmds / attrSubCmds)+ kz 收益趋势,含真实 TB 的怪脾气
src/testing/conformance.ts    describeDataSourceConformance(name, setup) —— 任何 DataSource 实现共用的 15 条用例
test/legacy-adapter.test.ts   LegacyDataSource 跑上面这套 + 自己的细节
```

同事在自己的仓库里(需要 vitest ≥ 2,`vitest` 是本包的可选 peer;该子路径顶层 import 了 vitest,只能在 vitest 运行时里引):

```ts
import { describeDataSourceConformance, FakeTb, FakeSocket } from '@grid/tb-client/testing'
import { TbClient } from '../src/tb-client'

describeDataSourceConformance('TbClient', () => {
  const tb = new FakeTb()
  const ds = new TbClient({ baseUrl: 'http://tb', getToken: () => tb.token, fetchImpl: tb.fetch, WebSocketImpl: FakeSocket })
  return { ds, tb }
})
```

## live 用例(连真 TB + kz,CI 不跑)

```bash
pnpm -F @grid/tb-client test:live     # test/live/*.live.ts;凭据从向上找到的 .env.local 读(TB_BASE / TB_USER / TB_PASSWORD / 可选 KZ_BASE),没凭据整组 skip
```

`kz-auth.live.ts`(2026-09-08):kz `tskv/**` 的 token 校验——有效 token 通过,假 / 篡改 / 过期 token 必须被拒(与 `biz/**` 一致),4 条;现场 kz 若是旧版本这组会红。

`kz-ext.live.ts`(2026-09-07):`ext()` 通用历史六个桶、缺省粒度按窗口、ZD / MAX、资产 key(`calc_totalP`)、key 不存在报错、收益趋势,7 条;首跑记录与接口怪癖见 `docs/联调记录/kz-接口实测-2026-09-07.md`。

## kz 真数据上的坑(镜像 8099,2026-09-07)

- 粒度只由路径段(`minute … year`)决定,`interval` 参数被忽略;非 ZD 时 `zdValue` 是 0 不是 null;`agg=ZD` 时 `value === zdValue`。
- 缺数据的时段不补 0,直接没有点;`year` 桶只回 1 个点且 `ts` 是查询时刻(适合数字卡,不适合曲线)。
- 不存在的 key:HTTP 200 + `{ code: 500, msg: "key不存在" }`,多 key 里一个不存在整个请求失败 → `ext()` 抛该 msg;不支持的 agg 静默返回 `data: {}`(适配器只放行 AVG / MAX / MIN / ZD)。
- 首次调用冷启动约 5 s,之后几十毫秒。
- **kz 的 `tskv/**` 不校验 token**(假 / 篡改 / 过期 token 都返回数据;`biz/**` 正常),同事修复前不要把 8099 暴露给客户可达网络。

## 真数据上踩到的坑(镜像 CE 4.3.1,2026-09-05;详见第二轮回填清单 4.8)

- 退订命令必须带 `entityType / entityId`,只发 `{cmdId, unsubscribe: true}` 会被 TB 当成关闭整个会话,之后同一连接上的命令全部报 `Session meta-data not found!`。
- 订阅即回一包当前值;不存在的 key 推 `[[ts, null]]`。
- 推送与 REST 的值都是字符串,`"44.851"` / `"true"` / `"0"` 要归一;REST 历史是降序。
