# @grid/tb-client(占位,T1.1 起由同事填充)

TB 数据访问包:包一层同事现有 `core/request.js`(axios 拦截器、401 处理)与 `core/websocket.js`(cmdId 路由、指数退避重连、告警订阅),实现 `DataSource` 接口。见 `dev/docs/开发计划-v2.md` T0.2(接口)、T1.1(实现与完成标准)、架构 v2 §7。

导出子路径:`.`(`TbClient`、`DataSource` 类型、`TbClientError`)、`./vue`(`provideTbClient / useTbClient / useTelemetry`)。

计划中的目录:

```
src/
  data-source.ts       DataSource 接口(契约的一部分,T0.2 冻结)
  tb-client.ts         class TbClient implements DataSource
  history.ts           getHistory 自适应聚合粒度表
  normalize.ts         TB 推送格式 → { key, ts, value }
  errors.ts            network / auth / business 三类
  vue/index.ts
  legacy-adapter.ts    (仅 T1.1 延期时的预案:用现有 useTelemetry.js + api/tb.js 临时实现)
test/
  reconnect.test.ts  token-refresh.test.ts  history-agg.test.ts
```

支持范围:TB CE 4.3.x,WS 协议 `tsSubCmds`。一条 WS 与引用计数**不是**一期验收项。
