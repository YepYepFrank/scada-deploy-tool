# live 测试(T2.5)

连真实 TB(默认镜像 `http://192.168.20.61:8080`)跑,**CI 不跑**:文件名 `*.live.ts`,只被 `vitest.live.config.ts` 收录。

```bash
pnpm -F @grid/tbsite-compiler test:live
```

凭据只从环境变量或向上找到的 `.env.local` 读(`TB_BASE / TB_USER / TB_PASSWORD`,租户账号),不入库;没凭据时整组 `skip` 而非失败。

| 文件 | 内容 | 状态 |
|---|---|---|
| `rule-chain.live.ts` | 规则链路径:把 `xrs-mirror-test` 的配置改成临时站点(站点名、输出 key、告警名、汇聚 / 收益资产名全部加前缀)→ publish → 断言 CF / 链名与节点数 / Root 转发 / 站点资产 → 再 publish 幂等(快照相等、历史 +1)→ cleanup 全清;前后 `xrs-mirror-test` 快照零差异。`afterAll` 兜底 cleanup,断言失败也不留垃圾 | 可跑 |
| `prune-chains.live.ts` | 发布时清理旧链(R1):独立命名的临时站点先发布「告警 + 多级归档」→ 断言两条链与 Root 转发都在 → 声明里去掉全部运算再发布 → 断言两条链从 TB 消失、Root 转发被摘、与本站点无关的链逐一比对一条没少 → 再发一次幂等。`afterAll` 兜底 `cleanup` | 可跑 |
| `health.live.ts` | 发布后自检:自建一条临时链承载故障(不碰任何站点的链),写一个带 `propagateRelationTypes` 的建告警节点 → 断言自检抓到、报出节点类型与根因、同链正常节点不误报;把字段名改成 `relationTypes` 再存一次 → 断言通过(证明判据取最近一次 STARTED);链不存在时给跳过原因。`afterAll` 删临时链 | 可跑 |
| `cross-device-cf.live.ts` | 即时计算的结果存哪(2026-09-10):用两台持续上报 `temperature` 的测试设备(`Test Device A1 / A2`,本来都没有 CF)建临时站点 → publish → 断言跨设备的 `A1 − A2` 的 CF 建在结果资产(`tbsite-agg`)上并挂到站点下、单设备的 `A1 × 2` 建在 A1 上 → 等真实遥测触发,逐点拿同一时刻的输入核对算出来的值 → cleanup 全清。`afterAll` 兜底 cleanup 并删掉 A1 上临时结果 key 的历史 | 可跑 |
| ~~Profile 告警双轨(ADR-001)~~ | 取消(2026-09-06):ADR-001 定稿 Profile 一律不写 | — |

元数据读取那两项(Asset 树按 `Contains` 递归、属性 key 列表)在 `apps/deploy-tool/src/meta/MetaNode.ts`,单元测试在 `apps/deploy-tool/test/meta-tree.test.ts`(Asset 树)与 `apps/deploy-tool/test/meta-attr-keys.test.ts`(属性 key 按 scope、遥测 key 带最新值与类型;2026-09-08),镜像验收记录见开发计划 T2.5。T3.11 于 2026-09-08 收尾:本 live 用例 3/3 重跑通过。

注意:用例的临时站点跑完后 CF 已删,但设备上会留下 `t25xxxx_*` 的遥测 key(历史点 7 天 TTL 后清),KeyPicker 里可能看到,对功能无影响。

注意:计划原文写「对 `xrs-mirror-test` 执行 publish … cleanup」,但 cleanup 会删掉镜像上该站点的规则链与资产,所以改为临时站点,与 T1.3 的手工验证一致。
