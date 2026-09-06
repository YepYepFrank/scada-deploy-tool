# @grid/scada-renderer 变更记录

版本按 SemVer;0.x 期间次版本号可含破坏性变更,会在条目里标「破坏」。契约(`schemaVersion`)的变更走 ADR,不随包版本隐式变化。

## 0.2.0 — 2026-09-06

组件 / 模板打磨(T3.9)+ T3.6 起攒下的接口补充。**破坏**:`line` 组件的 `style` 属性改名 `chartStyle`(与 Vue 保留属性同名会触发警告);已发布的旧配置由组件的 `migrateProps` 在渲染前自动转换,不必重发。

- `WidgetDefinition.migrateProps?(props)`:组件旧属性名迁移钩子,`<ScadaPage>` 渲染前调用;`line` 用它把 `style` → `chartStyle`。
- 缩放模板小字号下限:`.sr-root` 带 `--sr-scale`,主题令牌 `--sr-min-text: 10px`;卡片标题 / 副标 / 侧值 / 表格 / 告警行 / 空态提示等 ≤13px 的文字改为 `max(Npx, calc(var(--sr-min-text) / var(--sr-scale)))`,ECharts 全局 `textStyle.fontSize` 同样按缩放抬高——1920 设计稿缩到 0.5 时文字仍 ≥10px 可读(以前 5–6px)。
- 运行态空槽位不再显示「槽位名 + 可放组件」占位(只在 `design` 模式显示);大屏上没配的槽位就是留白。
- 空态 / 错误态文案梳理:图表「暂无数据」、卡片侧栏「数据不可用」、数字卡「不可用 / ——」、告警列表「✓ 当前无活动告警」、图片「未设置图片 / 图片加载失败」、文本「—」;错误态一律带 `title` 显示原因。
- `<ScadaPage>` 新增 `bindError(widgetId, slot, message)` 事件并 expose `bindErrors`:某个绑定解析 / 订阅失败时抛出,宿主可汇总提示(T3.6 预览的「N 个绑定在该 Customer 下不可见」用它)。
- 绑定解析器把 `DataSource.subscribeTs / subscribeAttr / subscribeAlarms` 的可选 `onError`(契约 §4,2026-09-06 补充)接到组件错误态:CUSTOMER_USER 订阅未分配实体被 TB 拒绝时组件显示「不可用」而不是一直空着。没有 `onError` 通道的 DataSource 实现行为不变。

## 0.1.0 — 2026-09-05

首个可接入版本(T2.4)。宿主用 `import { ScadaPage } from '@grid/scada-renderer'` + `import '@grid/scada-renderer/style.css'` 接入,见 README「接入示例」。

- 契约 v1(`schemaVersion: 1`):`PageConfig / WidgetConfig / Binding`(六种 mode:ts、ts-history、attr、alarm、const、ext)、`EntityRef { type, id, name? }`、`actions` 保留(一期渲染为禁用态)。JSON Schema 由类型生成,子路径 `@grid/scada-renderer/schema` 与 `./schema/page-config.schema.json`。
- 注册表:`registerWidget / registerTemplate / validateAgainstRegistry`(模板 / 组件 / 槽位 accepts / 绑定 modes / valueType / multiple 数组规则 / 必填;必填检查带稳定 `code`)。
- `<ScadaPage :config :dataSource? :design? :showStatus?>`:setup 阶段校验,注册表错误只隔离对应组件;design 模式用 `sampleData` 不订阅;scaled 模板以父容器为缩放基准(ResizeObserver);`status` / `invalid` 事件。
- 数据源注入:`provideDataSource(ds)`,key `Symbol.for('grid:data-source')`;`DataSource` 契约类型来自 `@grid/tb-client`(peer)。
- 绑定解析器:ts-history 先拉历史再订阅追加(按 ts 去重、`maxPoints` 截断),ext 走 `ds.ext()`,退订对账。
- 模板 3 个:`overview-a`(scaled,9 槽位)、`monitor-3col`(scaled,10 槽位,`main` 开放给 image / table / line / dual-axis / text)、`grid-3x3`(grid,9 槽位)。
- 组件 10 个:`text`、`number-card`、`gauge`、`line`、`dual-axis`、`overview-card`、`alarm-list`、`status-light`、`table`、`image`;每个带 `propsSchema / bindingSlots / sampleData`。
- 主题:`theme/default.css` 的 `--sr-*` 令牌(自微电网深蓝抽出),宿主可整体覆盖。
- `/dev` 展示页(`pnpm dev`,5180):10 组件 × 3 模板、design / 随机数据(2 秒一推)/ 断线开关、镜像真数据面板(LegacyDataSource)、ScadaPage 资产选择。

### 构建产物(`pnpm build`,Vite library mode)

| 文件 | 原始 | gzip |
|---|---|---|
| `dist/index.js` | 65 KB | 17 KB |
| `dist/schema/index.js`(含 ajv,只在需要运行时校验时引) | 205 KB | 54 KB |
| `dist/style.css` | 7 KB | 2 KB |

`vue`、`@grid/tb-client`、`echarts/*` 全部外置,不打进产物:宿主自带 ECharts(按需注册,`echarts/core` 等四个子路径),因此计划里「ECharts 按需引入后 < 900 KB」要看宿主的打包结果。dist 总计约 1.1 MB 含 source map 与 d.ts。

### 仓库外宿主验证(T2.4 完成标准)

用 `pnpm pack` 出的 `grid-scada-renderer-0.1.0.tgz` + `grid-tb-client-0.0.1.tgz`,在 monorepo 之外新建最小 Vite + Vue 项目(`file:` 安装,`--ignore-workspace`),`import { ScadaPage } from '@grid/scada-renderer'` 与 `import '@grid/scada-renderer/style.css'`,`vue-tsc --noEmit` + `vite build` 通过。宿主整包(Vue + ECharts 按需 + 渲染器 + 一张 line 页面):

| 文件 | 原始 | gzip |
|---|---|---|
| `assets/index.js` | 771 KB | 259 KB |
| `assets/index.css` | 7 KB | 2 KB |

即含 ECharts 在内 < 900 KB gzip 前,达标。ECharts 未按需拆分会到 1 MB 以上,所以宿主 `optimizeDeps.include` 与只引子路径两条都要遵守。

### 已知与未做

- `svg-diagram` 接线图组件暂缓(2026-09-04 决定),`main` 槽位用 `image` 占位。
- `ext` 绑定的 `params` 形状等 ADR-004 冻结。
- 测试里 `line` 组件的 `style` 属性名会触发 Vue 警告(test-utils 传对象),不影响运行,契约冻结时一并处理。
