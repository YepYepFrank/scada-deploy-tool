# @grid/scada-renderer 变更记录

版本按 SemVer;0.x 期间次版本号可含破坏性变更,会在条目里标「破坏」。契约(`schemaVersion`)的变更走 ADR,不随包版本隐式变化。

## 0.4.0 — 2026-09-19

一次接线图(ADR-005)。全部是纯新增,现有页面与宿主接入代码不用改;契约 JSON Schema 不变。

- **新组件 `sld`(一次接线图)**:纯 Vue + SVG,零新依赖。图存在 `props.doc`(`SldDoc`,部署工具的接线图编辑器画);画分组框(虚线 + 标题)、母线、连线、图元、图元名称、文字 / 数值标签(相色 a 黄 / b 绿 / c 红;`format.scale / digits / unit / map`)。
  - 开关三态按测点值取(`state.map`);接地刀、状态灯这类有状态图形的图元同样按 `state` 画;没配 `state` 的开关视为常合。
  - 带电着色:从电源点沿连线 / 母线 / 合位开关 / 变压器传播,按电压等级取色(缺省 35 kV 黄、10 kV 红、0.4 kV 橙,其余主题强调色),失电灰;开关状态未知时其后部分画成同色虚线半透明(「不确定」,不当带电画)。图里没标电源点时不着色并在角落提示。
  - 数据过期按**数据时间戳**判(`staleSeconds`,缺省 600,0 为不判):数值变灰并提示「数据时间 …」,开关按未知画。
  - 告警闪烁:`alarms` 槽位里未清除的告警先按 originator 的 **id** 匹配(id 取自本组件绑定里的实体),取不到再按**类型 + 名称**(`originatorName`)匹配节点的 `entity`,CRITICAL / MAJOR 红、其余黄;尊重 `prefers-reduced-motion`。
  - 交互:滚轮缩放(以指针为中心)、拖动平移、双击复位;坐标一律经 `getScreenCTM()` 换算,放在 `transform: scale()` 的大屏里也准。design 态不响应。放大层里那份的缩放状态独立。
  - props:`doc`、`staleSeconds`、`showNames`(默认 true)、`energizeColoring`(默认 true)、`interactive`(默认 true)、`kvColors`(`[{ kv, color }]`)。
  - 模板:`monitor-3col` 的 `main`、`overview-a` 的 `g1`–`g4` 接受 `sld`。
- **动态槽位**:`WidgetDefinition.dynamicSlots`(按前缀匹配,如 `pt.<pointId>`);`stamped: true` 的槽位值为 `{ v, ts }`;`sampleData(cfg)` 收到组件配置。`PropSchema` 加不透明对象 `{ type: 'object', format: 'sld-doc' }`。
- **`WidgetDefinition.receivesBindings`**:组件定义声明后,渲染器把该组件自己的 `bindings` 作为只读 prop 传入(`<ScadaPage>` / `<ScadaWidget>` / 放大层一致);`sld` 用它取节点实体 id。其他组件不受影响。
- **组件事件 `widget-event`**:`<ScadaPage>` / `<ScadaWidget>`(含放大层)新增事件,载荷 `{ widgetId, type, name, detail? }`。`sld` 发 `node-click`,`detail` 为:

  ```ts
  { nodeId: string; name?: string; entity?: { type: 'DEVICE' | 'ASSET'; name: string; id?: string } }
  ```

  `entity.id` 来自本组件绑定里同名实体(发布器按名解析后才有);未发布 / 没解析时不带,宿主可退回按 `entity.name` 查。
- **图元库**:`SldSymbol` / `SldSymbolBox` 组件与 29 个内置图元(开关、常通、变压器、终端、电源、储能 / 变流、通用),`registerSldSymbol` 可加自定义图元;`SldDoc` 模型的纯函数(几何、带电计算、校验、复制间隔、迁移)一并从包入口导出。

- `cards`(卡片库)模板从 4 × 6 = 24 格放到 4 × 12 = 48 格(2026-09-17):工具里「格子」只是存储位置,不再作为概念出现(按列表看、按单卡编辑、检视页逐卡看实时值);已发布的卡片库页面不受影响(槽位名 `c01…c24` 仍在前 24 个)。
- `overview-a`(态势总览台)的 `g1` 不再是必填槽位:新页面一打开就报「必填槽位未放组件」是噪音,只放指标位不放图表的页面也合理。内置四个模板从此都没有必填槽位;`required` 机制保留(自定义模板可用),`validateAgainstRegistry` 的 `template-slot-required` 检查不变。

## 0.3.2 — 2026-09-16

组件放大(YY 提:大屏上每个组件有按钮,点开全屏放大整个组件)。

- `<ScadaPage>` / `<ScadaWidget>` 每个组件右上角有「⤢ 放大」按钮(悬停 / 键盘聚焦时显示,触屏常显):点开把该组件 Teleport 到 body 铺满视口再渲染一份,**共用同一份 values / bindErrors、不新建订阅**;标题栏显示组件标题与类型,✕ / Esc 关闭,另有「浏览器全屏」(Fullscreen API,不允许时只用覆盖层);组件被移除 / 配置换掉时自动收起。
- 新 prop `expandable`(默认 `true`;design 态不显示),新事件 `expand(widgetId | null)`。页面配置(契约)不变。
- 放大层根节点 `.sr-page.sr-expand.sr-theme-<theme>`,`--sr-scale: 1`,主题令牌照常生效,宿主可覆盖。

## 0.3.1 — 2026-09-14

单卡片嵌入方案 P2:卡片库。

- 新模板 `cards`(`CARDS_TEMPLATE_ID`):grid,4 × 6 = 24 个等大槽位,任意组件,无必填——站点的「卡片库」页用它,工程人员在里面配可复用卡片,宿主按「页面 id + 组件 id」引用;它不是大屏页(工具的大屏列表按资产 `additionalInfo.kind === 'cards'` 跳过)。`builtinTemplates` 由 3 个变 4 个。

## 0.3.0 — 2026-09-14

单张卡片嵌入宿主页面(方案 `docs/方案讨论-单卡片嵌入-2026-09-14.md` P1)。契约 `schemaVersion` 不变,`PageConfig` 不加字段。

- 新增 `<ScadaWidget :config :dataSource? :theme? :design?>`:把一份 `WidgetConfig`(`slot` 可省)单独渲染;校验走 `validateWidgetAgainstRegistry`(不传模板时不查槽位),绑定 / sampleData / 退订与 `<ScadaPage>` 共用新抽出的 `useBindingRuntime`(`widget-runtime.ts`);根节点 `.sr-page.sr-widget-standalone` 带主题令牌、`--sr-scale: 1`,`width/height: 100%` 由宿主容器定尺寸;事件 `invalid` / `bindError`。
- 新增 `pickWidget(page, widgetId)`(找不到返回 `undefined`)与 `listWidgetRefs(page)`。
- 新增导出 `validateWidgetAgainstRegistry`、`useBindingRuntime`、`widgetPropsOf`;`resolveBindings` 第一个参数放宽为 `Pick<PageConfig, 'widgets'>`(兼容)。
- `WidgetConfig.id` 语义明确为「创建后不变」(JSON Schema 仅 description 变):工具创建组件时生成 `w_` + 8 位随机,改属性 / 绑定 / 换模板不变,换组件类型 = 新 id;旧的 `w-<slot>` / `<type>-<slot>` 继续有效。
- `/dev` 展示页底部加「单卡嵌入」演示:从当前页面挑一张卡放进 240×120 / 320×160 / 480×280 的容器。
- `ext` 绑定的序列图例名:业务统计用 `params.metric`,通用历史改用 `params.keys[0]`(此前统一显示 `kz-<序号>`),都没有才退到 `kz-<序号>`。
- 新增 `migrateConfigProps(config)`:按各组件的 `migrateProps` 把整份配置的旧属性名正规化(不改输入);编辑器读入 TB 上的旧配置前调用,校验层不再把旧键名当多余属性。

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
