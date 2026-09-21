# @grid/scada-renderer 变更记录

版本按 SemVer;0.x 期间次版本号可含破坏性变更,会在条目里标「破坏」。契约(`schemaVersion`)的变更走 ADR,不随包版本隐式变化。

## 0.9.0 — 2026-09-21

**绑定上下文 BindingContext**(方案见 `docs/方案讨论-BindingContext-2026-09-21.md`,庄 09-21 答复后定稿)。全部是可选新增,
`schemaVersion` 仍为 1、旧配置零改动;但 **0.8.0 及更早的渲染器不认识新写法,会判那一页配置无效——宿主先升 0.9.0,再发布这类页面**。

- **契约**:绑定里的实体 / 测点 / 时间范围除了写死,还能写「取自页面上下文」:
  - `entity: { source: 'context', key, type?, fallback?, whenMissing? }`(ts / ts-history / attr / alarm,以及 ext 的 `params.entity`);
  - `key` / `keys[i]`:`{ source: 'context', key: 'selectedMeasurePoint', fallback?, whenMissing? }`(ext 的 `params.keys[i]` 同);
  - `window`:`'24h'`、**绝对区间 `{ from, to }`(毫秒)**,或 `{ source: 'context', key: 'timeRange', … }`。
  - 上下文键只收 `selectedSite` / `selectedDevice` / `selectedMeasurePoint` / `timeRange` 与 `custom.<名字>`(JSON Schema 的 pattern 管着);`selectedAlarm` 预留。
  - `whenMissing`:`empty`(缺省,「未选择设备」空态,不订阅不报错)/ `hide` / `error` / `fallback`(必须同时给 `fallback`,注册表校验 `context-fallback-missing`)。
    **`fallback` 只有 whenMissing 为 `fallback` 时才在运行时生效**——样例设备不会悄悄成为生产页面的默认值。
- **宿主接口**:`<ScadaPage :binding-context>` / `<ScadaWidget :binding-context>`,或 `provideBindingContext(ctx)`(props 优先;provide 限定在组件树内,不是全局单例)。
  渲染器只读不写。`defineExpose` 多了 `contextKeys`(这页 / 这张卡要喂哪些键)、`ctxStates`、`stats()`。
  类型:`BindingContext`、`MeasurePoint`、`ContextTimeRange`;工具函数 `applyContext` / `contextKeysOf` / `contextSignature` / `lookupContext` / `isContextRef`。
- **按组件粒度重订**:绑定运行时从「配置一变全部退订重建」改成对账式——只有「具体绑定」变了的组件才重订。
  换设备时固定绑定的卡订阅不断、数值不闪;同一设备重复赋值(新对象、同 id)不重订;**只改 props(标题、单位)也不再重订**。
- **绝对时间区间**:`DataSource.getHistory` 的第三个参数放宽为 `TimeRange = 窗口字面量 | { from, to }`;`ExtQuery` 多了可选的 `range`。
  `@grid/tb-client` 0.0.3 导出 `AbsoluteRange` / `TimeRange` / `isAbsoluteRange` / `resolveTimeRange`,`LegacyDataSource` 已支持(kz 通用历史同)。
  绝对区间只拉历史、不追加实时。**宿主自己的 tbClient 要跟着支持**,否则用到绝对区间的曲线会报错(只用「最近 N」的不受影响)。
- **联动事件**(`widget-event`):整卡点击 `click`(任何组件;该卡只绑了一个实体时 `detail.entity` 给出,已是解析后的具体实体)、
  表格 `row-click`(`{ index, label, key, entity? }`)、告警列表 `alarm-click`(`{ alarm, entity }`)。宿主收到后自己改上下文即可联动;design 态不抛。
- 测点取自上下文且给了 `{ key, label }` 时,曲线图例 / 表格列名用 `label`。声明了 `receivesBindings` 的组件拿到的是解析后的具体绑定。
- `/dev` 演示页加了一块「绑定上下文」:选设备 / 测点 / 时间范围看卡片换订阅,点表格行联动选中设备。

## 0.8.0 — 2026-09-21

- **叠放层次**:`SldNode.z` / `SldBus.z`(可选,缺省 0)。图元与母线放在一起排:**先比 z,z 相同再按「母线 < 连线 < 图元」,再按数组顺序**,
  大的盖住小的。全是缺省值时和以前一模一样(图元压连线、连线压母线);图元设 −1 垫到母线底下,母线设 1 浮到图元上面。
  分组框恒在最底、标签恒在最上。四个图层(`sr-sld-layer-*`)的结构不变:被压低的图元画进「线」层最前,被抬高的母线混排进「图元」层。

## 0.7.1 — 2026-09-21

- 节点放大倍数的候选档从 `0.5 … 4` 放宽到 `0.5 … 6`(步长 0.5,`SLD_NODE_SCALES`):部署工具改成**拖拉图元四角的手柄**改大小,
  松手吸附到最近的合法档,档位要够密、够大。渲染没有变化——0.7.0 本来就能画任意倍数,这里只影响 `validNodeScales` / `bad-scale` 校验。

## 0.7.0 — 2026-09-20

一次接线图的四项增补(YY 走查时提的)。`SldDoc` 只加了可选字段,`v` 仍为 1,旧图不用迁移;页面配置契约不变。

- **在线 / 离线状态灯**:在线 = 绿点、外圈光晕呼吸;离线 = 红点常亮;没数据 = 灰点。
  - 节点:`SldNode.online = { pt, at? }`,灯挂在图元包围盒的角上(缺省右上)。
  - 整站(或任何一路通讯):新的标签类型 `kind: 'status'` —— 一盏灯 + 文字,后面自动跟「在线 / 离线 / 未知」。
  - 测点一般绑设备的服务端属性 `active`。**不判数据过期**:`active` 只在上下线那一刻更新,时间戳旧恰恰说明一直稳定
    (`resolveOnlineState`);灯也不吃带电着色——设备离线和线路失电是两回事。尊重 `prefers-reduced-motion`。
- **母线粗细 / 颜色**:`SldBus.width`(缺省 4)、`SldBus.color`。自定义颜色盖过电压等级色,但**失电照样变灰**,否则带电着色就白做了。
- **文字样式**:标签 `bold`;`size` / `color` 本来就在契约里,这次部署工具的属性面板才给出入口。
- **节点大小**:`SldNode.scale`。图元整体(线宽、图元内文字)等比放大,端口跟着走;
  只许取「放大后包围盒与全部端口仍落栅格」的倍数(`validNodeScales(def)`,不同图元不一样),`validateSldDoc` 对不合法的值报 `bad-scale`。
  `<SldSymbol :scale>`、`symbolBoxSize(def, rot, scale)`、`nodeScale(node)`。
- **母线搭母线算连通**:一条母线的端头落在另一条上(T 形 / L 形 / 首尾相接)→ 带电计算里两条互通(`busesTouch`,
  连通图多一种边 `joint`);十字交叉不算。此前必须再补一根零长度的连线,否则搭上去的那条永远是失电灰。
- 只有标签、没有图元和母线的图不再被当成「未绘制」。

## 0.6.0 — 2026-09-20

**大屏抬头**。YY:「最后大屏要有能力编辑抬头 / 标题。」抬头从此是页面的一部分——工程人员在部署工具里填,
跟着页面一起发布,大屏、宿主应用、编辑器预览看到的是同一份。契约仍是 v1(只加了可选字段)。

- **`PageConfig.header`(可选)**:`{ title?, subtitle?, org?, logo?, align?, show? }`。
  - `title` 为空 / `show: false` / 没有 `header` → 不画,行为与 0.5.0 完全一致。
  - `logo` 收 `http(s)` URL 或 `data:image/…`(部署工具选图后转 data URI,限 200 KB)。
  - `align: 'center'`(缺省)主标题居中、左侧放 logo 与单位名;`'left'` 则标题紧跟 logo。
- **抬头与舞台一起缩放**:抬头在设计稿坐标里占 84 px(导出 `HEADER_DESIGN_H`),`computeScale` 多了第三个参数
  把它算进竖向比例——所以编辑器里的小预览和 1080p 大屏上的比例完全一致,加了抬头也不会把页面挤出容器。
- **新 prop `header`(默认 `true`)**:宿主想用自己的标题栏就传 `<ScadaPage :header="false">`,页面里那条就不画。
- **主标题是三层叠出来的**(光一层渐变字太素):① 描边层 —— 同一段字垫在底下只描 0.055em 的深蓝边,
  把标题从背景里抠出来,远看有厚度;② 本体 —— 白→青渐变填充 + 外发光 + 向下一格的实影;
  ③ 扫光层 —— 同一段字用高光色再画一遍,一条移动的渐变遮罩每 7 秒放出一道窄光扫过。
  ①③ 用 `content: attr(data-text)` 复制标题,描边 / 发光用 `em` 计量(字号有 `max(16px, …)` 的下限,
  用 `--sr-scale` 算会在小预览里缩没)。
- **标题两侧有翼饰**:一道向外淡出的细线 + 内端一颗小菱形,线和菱形是同一个 `clip-path` 多边形,右边那只镜像。仅居中版式。
- 主题令牌:`--sr-header-bg`、`--sr-header-line`、`--sr-header-title-fill`、`--sr-header-title-ink`
  (这两个是一对:主标题是渐变字,靠 `background-clip: text` + 透明字色实现,要改一起改)、
  `--sr-header-title-stroke` / `-glow` / `-drop`、`--sr-header-shine`、`--sr-header-wing`。
  扫光不想要:`--sr-header-shine-anim: none`(系统开了「减少动态效果」时本来就不动)。

与架构 §6「页面标头 / 导航菜单 / 时钟归宿主」不冲突:那说的是宿主应用自己的框架(导航、时钟、登录身份),
这里是这张大屏印在最上面的名字——换一张页面就该换一个,只能由配页面的人决定。

## 0.5.0 — 2026-09-20

**交付级观感**。纯视觉,零契约变更:页面配置、组件 props、事件、数据链路一个字都没动,升级后现有页面自动变样。
YY 的原话是「配出来的页面太像 demo,不像最终交付的页面」——所以这版补的全是「点缀 / 背景 / 品牌」。

- **页面装饰层**:`<ScadaPage>` 画深海蓝渐变底 + 两团光晕 + 细网格 + 四周暗角;固定设计稿的大屏模板(`overview-a` / `monitor-3col`)另加舞台四角 L 形角标。整层 `pointer-events: none`,不挡任何交互。
  - 新 prop **`decor`(默认 `true`)**。宿主自己有整套背景、或不想要这层:`<ScadaPage :decor="false">`,观感回到 0.4.0。
  - 各层都有令牌可调:`--sr-page-bg`、`--sr-glow-1/2`、`--sr-grid-line`、`--sr-grid-size`、`--sr-vignette`、`--sr-corner`、`--sr-corner-len`。
- **固定设计稿的大屏在容器里居中**(此前只水平居中,容器比设计稿「高」时下方空一条)。
- **面板质感**:卡片改上下渐变底 + 顶边发丝高光 + 外投影;卡头加一道向右淡出的蓝色洗底,标题前加渐变小竖条。令牌:`--sr-panel-top/bot/edge/shadow/hairline`、`--sr-title-wash`。
- **组件细节**:数字卡顶部色条向下洇一层同色微光、数字带弱辉光;状态灯圆点双层光晕;表格斑马行 + 表头渐变;告警横幅用面板同款底(没有告警时也「有东西」);**接线图 `sld` 从「浮在页面上」改成一块面板**(此前它没有底)。
- **可选字体包 `@grid/scada-renderer/fonts.css`**:标题用优设标题黑、数字用 Barlow SemiBold —— 主题里 `--sr-font-title` / `--sr-font-num` 一直指名这两款,但包里没带字体,不装就一路回退到微软雅黑(大屏「像 demo」的一半原因在这)。两款都可商用,已转 woff2(616 KB + 49 KB)。**不 import 就一个字节都不加载**,主包体积不变。

  ```ts
  import '@grid/scada-renderer/style.css'
  import '@grid/scada-renderer/fonts.css' // 新增这一行就够
  ```

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
