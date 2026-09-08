# live 测试(T2.5)

连真实 TB(默认镜像 `http://192.168.20.61:8080`)跑,**CI 不跑**:文件名 `*.live.ts`,只被 `vitest.live.config.ts` 收录。

```bash
pnpm -F @grid/tbsite-compiler test:live
```

凭据只从环境变量或向上找到的 `.env.local` 读(`TB_BASE / TB_USER / TB_PASSWORD`,租户账号),不入库;没凭据时整组 `skip` 而非失败。

| 文件 | 内容 | 状态 |
|---|---|---|
| `rule-chain.live.ts` | 规则链路径:把 `xrs-mirror-test` 的配置改成临时站点(站点名、输出 key、告警名、汇聚 / 收益资产名全部加前缀)→ publish → 断言 CF / 链名与节点数 / Root 转发 / 站点资产 → 再 publish 幂等(快照相等、历史 +1)→ cleanup 全清;前后 `xrs-mirror-test` 快照零差异。`afterAll` 兜底 cleanup,断言失败也不留垃圾 | 可跑 |
| ~~Profile 告警双轨(ADR-001)~~ | 取消(2026-09-06):ADR-001 定稿 Profile 一律不写 | — |

元数据读取那两项(Asset 树按 `Contains` 递归、属性 key 列表)在 `apps/deploy-tool/src/meta/MetaNode.ts`,单元测试在 `apps/deploy-tool/test/meta-tree.test.ts`(Asset 树)与 `apps/deploy-tool/test/meta-attr-keys.test.ts`(属性 key 按 scope、遥测 key 带最新值与类型;2026-09-08),镜像验收记录见开发计划 T2.5。T3.11 于 2026-09-08 收尾:本 live 用例 3/3 重跑通过。

注意:用例的临时站点跑完后 CF 已删,但设备上会留下 `t25xxxx_*` 的遥测 key(历史点 7 天 TTL 后清),KeyPicker 里可能看到,对功能无影响。

注意:计划原文写「对 `xrs-mirror-test` 执行 publish … cleanup」,但 cleanup 会删掉镜像上该站点的规则链与资产,所以改为临时站点,与 T1.3 的手工验证一致。
