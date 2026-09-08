# 样例:仙人山服务区声明完站点后的输出(2026-09-08)

> 给前端同事看格式用。场景是模拟的,但骨架全部来自真实产物:设备与测点取自镜像上已发布的仙人山声明(36 台里挑 12 台代表),「运营总览」页就是镜像上已发布的那张,「南区配电房」页是按三栏监控屏模板新配的。四个文件都过了工具自己的校验(`tbsite validate` / `parseProject`)。

| 文件 | 是什么 | 谁用 |
|---|---|---|
| **`xianrenshan.scadaproj`** | 向导第 5 步「下载 .scadaproj」得到的**项目文件**,一个站点的全部声明:连接信息(不含密码)、元数据快照、页面组态、规则、发布记录 | 存档、换环境重放、进版本库。**前端同事主要看里面的 `pages[]`** |
| `xianrenshan.scadaproj.json` | 同一内容,后缀改成 `.json` 方便编辑器直接打开 | 同上 |
| **`xianrenshan.scadaproj.注释版.jsonc`** | 同一文件的**逐段注释版**:每一段定义什么、数据从哪来、走哪个 TB / kz 接口、每个 id 对应镜像上的什么实体(设备只展开 3 台,其余同结构)。去掉 `//` 注释就是原文件,已脚本核对一致 | **第一次看格式从这份开始** |
| `xianrenshan.tbsite.json` | 项目文件里 `rules` 那一段单独抽出来,即**站点规则声明**(`tbsite/v2`);发布时写进站点资产的 `siteConfig` 属性 | 命令行发布器 `tbsite publish` 的输入;后端同事核对运算 / 告警 |
| `xianrenshan.plan.json` | 编译器由规则声明算出的**写入计划**(`tbsite plan --out`):要建哪些计算字段、汇聚资产、规则链节点;不含 id,只是计划 | 核对「工具到底往 TB 写了什么」;不需要给前端 |

## 项目文件各段的意思

```text
version        项目文件格式版本,固定 1
connection     { base, user }  TB 地址与账号,永远没有密码
siteName       站点标识(英文短名),= rules.site.name,= TB 里站点资产的名字,大屏地址 site.html?site=<它>
metaSnapshot   第 1 步「连接并发现设备」时抓的设备 / 资产名单,离线打开项目文件时用作候选,不是权威数据
pages[]        页面组态(PageConfig),每项对应 TB 里一个 ScadaPage 资产的 pageConfig 属性 ← 渲染器 / 宿主应用读的就是这个
rules          站点规则声明(tbsite/v2):设备与测点、设备模板、单项运算、告警、输出前缀
published      每张页面最近一次发布:{ assetId, version, at, by },漂移检测用
```

## `pages[]`:前端真正消费的部分

一张页面 = `{ schemaVersion, template, title, widgets[] }`:

- `template`:页面模板 id,决定有哪些槽位。一期三个:`overview-a`(态势总览台:banner + s1–s4 数字卡 + g1–g4 图表)、`monitor-3col`(三栏监控屏:banner + l1–l3 / r1–r3 侧栏 + main + c1–c2)、`grid-3x3`。
- `widgets[]`:每个组件 `{ id, slot, type, props, bindings }`。`slot` 是模板槽位名;`type` 是组件类型(`number-card / gauge / status-light / line / dual-axis / table / overview-card / alarm-list / image / text`);`props` 是外观参数;**`bindings` 是数据从哪来**。
- 绑定的几种 `mode`:

| mode | 含义 | 例子 |
|---|---|---|
| `ts` | 实时遥测最新值(WebSocket 订阅) | `{ mode: "ts", entity: {type, id, name}, key: "P" }` |
| `ts-history` | TB 短历史(≤ 3 天,自动按窗口选聚合粒度) | `{ mode: "ts-history", entity, keys: ["P"], window: "24h", agg: "AVG" }` |
| `ext` | 外部归档服务(kz),长窗口曲线 | `{ mode: "ext", source: "kz", window: "30d", interval: "1d", params: { entity, keys, agg } }` |
| `alarm` | 某实体(含 Contains 子实体)的活动告警 | `{ mode: "alarm", entity: 站点资产 }` |
| `attr` / `const` | 属性 / 常量 | 样例里没用到 |

- `entity` 里 **`name` 是权威,`id` 只是上次解析的提示**(ADR-002):发布时按名字重新解析,换一套 TB 也能重放。
- 以 `calc_` 开头的 key(如 `calc_totalP`、`calc_pdrInP`)是工具自己算出来写到汇聚资产上的;其它 key(`tsLoadPowerTotal`、`totalGenerationPower` …)是后端同事的资产上已有的量。

完整的字段定义在 `docs/契约-v1.md` §3(PageConfig JSON Schema);渲染器的 `validatePageConfig()` 就是按那份 schema 校验的。

## 怎么复现这份文件

1. 向导第 1 步连镜像,站点标识 `xianrenshan`;第 2 步认领上面 12 台设备;第 3 步套「IED 功率监控」「配电房进线电压监视」「IED 多级归档」三个模板 + 两条跨设备汇聚;第 4 步配两张页面;第 5 步「下载 .scadaproj」。
2. 或者命令行:`tbsite validate docs/样例/xianrenshan.tbsite.json`、`tbsite plan docs/样例/xianrenshan.tbsite.json`。样例只做校验与计划,**没有发布到镜像**(镜像上仍是 `xrs-mirror-test`)。
