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

## 一致性测试(同事交付 TbClient 时的验收)

```
test/fake-tb.ts        内存版 TB:REST(timeseries / alarm)+ WS(tsSubCmds / attrSubCmds),含真实 TB 的怪脾气
test/conformance.ts    describeDataSourceConformance(name, setup) —— 任何 DataSource 实现共用的 13 条用例
test/legacy-adapter.test.ts   LegacyDataSource 跑上面这套 + 自己的细节
```

`TbClient` 交付时新建 `test/tb-client.test.ts`:

```ts
describeDataSourceConformance('TbClient', () => {
  const tb = new FakeTb()
  const ds = new TbClient({ baseUrl: 'http://tb', getToken: () => tb.token, fetchImpl: tb.fetch, WebSocketImpl: FakeSocket })
  return { ds, tb }
})
```

## 真数据上踩到的坑(镜像 CE 4.3.1,2026-09-05;详见第二轮回填清单 4.8)

- 退订命令必须带 `entityType / entityId`,只发 `{cmdId, unsubscribe: true}` 会被 TB 当成关闭整个会话,之后同一连接上的命令全部报 `Session meta-data not found!`。
- 订阅即回一包当前值;不存在的 key 推 `[[ts, null]]`。
- 推送与 REST 的值都是字符串,`"44.851"` / `"true"` / `"0"` 要归一;REST 历史是降序。
