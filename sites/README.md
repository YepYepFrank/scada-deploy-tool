# sites/ · 站点声明与页面文件(入库,可重放)

| 目录 / 文件 | 内容 | 发布命令 |
|---|---|---|
| `<站点>.tbsite.json` | 站点声明:认领的设备与测点、设备模板、运算 / 告警、`outputPrefix`、`alarm.propagate`(tbsite/v2) | `node packages/compiler/bin/tbsite.mjs publish sites/<站点>.tbsite.json --by <人>` |
| `migrations/<站点>.rename.json` | ADR-003 迁移表(发布时自动生成,只记录不执行) | — |
| `pages/<站点>-<页面>.pageconfig.json` | 页面配置(渲染器契约 `PageConfig`,实体带 `name`,发布时按名重解析 id) | `node packages/compiler/bin/tbsite.mjs page sites/pages/<文件> --site <站点> --name "<页面名>" --by <人>` |

凭据从向上找到的 `.env.local` 读(`TB_BASE / TB_USER / TB_PASSWORD`),不接受命令行明文。

现有:

- `xrs-mirror-test.tbsite.json`:镜像仙人山(36 台,`calc_` 前缀;2026-09-06,联调环境待办 ②)。
- `pages/xrs-mirror-test-运营总览.pageconfig.json`:里程碑 C 候选页(2026-09-07,`docs/联调记录/milestone-C-运营总览.md`)。里程碑 A 的页面文件在 `docs/联调记录/milestone-A.pageconfig.json`。
