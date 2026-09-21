# @grid/scada-renderer

组态渲染器 + 页面配置契约。只认 JSON、不认业务:`<ScadaPage :config>` 把配置里的绑定翻译成对 `DataSource` 的订阅,按模板槽位放组件。

- 契约:`src/schema/`(`PageConfig` / 注册表类型 / `ScadaPageProps`),子路径 `@grid/scada-renderer/schema`;JSON Schema 由类型生成(`pnpm gen:schema`)。
- 注册表:`registerWidget / registerTemplate / validateAgainstRegistry`;`registerBuiltins()` 注册包内组件与模板。
- 数据源注入:`provideDataSource(ds)` 或 `<ScadaPage :dataSource>`;key 为 `Symbol.for('grid:data-source')`,tb-client 的 Vue 层可直接 provide 同一 key。
- `vue` 与 `@grid/tb-client` 是 peerDependencies;`echarts` 是 dependency,按子路径(`echarts/core` 等)引入。**宿主 Vite 需 `optimizeDeps.include` 这四个子路径**,否则预构建拆成两份实例、图表空白。

## 接入示例(宿主应用)

monorepo 内用 `workspace:*`;仓库外用 `pnpm pack` 出的 tarball 或私有 registry。宿主需自带 `vue`、`echarts`、`@grid/tb-client`。

```ts
// main.ts
import { createApp } from 'vue'
import '@grid/scada-renderer/style.css'
import { registerBuiltins } from '@grid/scada-renderer'
registerBuiltins() // 登记包内 10 组件 + 3 模板,只需一次
```

```vue
<!-- ScadaView.vue:路由 /scada/:assetId -->
<script setup lang="ts">
import { ScadaPage, provideDataSource, validatePageConfig, type PageConfig } from '@grid/scada-renderer'
import { LegacyDataSource } from '@grid/tb-client' // 同事的 TbClient 就绪后换成它,接口相同

provideDataSource(new LegacyDataSource({ baseUrl: '/api-proxy', getToken: () => tokenStore.jwt }))
const raw = await tb.getAttributes('ASSET', assetId, 'SERVER_SCOPE', ['pageConfig']) // 宿主自己的 REST 封装
const checked = validatePageConfig(JSON.parse(raw.pageConfig))
const config: PageConfig | null = checked.ok ? checked.value : null
</script>

<template>
  <div style="height: calc(100vh - 56px)">
    <!-- scaled 模板以这个容器为缩放基准;宿主给定高度即可,不要再包一层缩放 -->
    <ScadaPage v-if="config" :config="config" @status="s => (badge = s)" @invalid="showErrorPage" />
    <ErrorPage v-else />
  </div>
</template>
```

```ts
// vite.config.ts —— 必需,否则 ECharts 被预构建成两份实例、图表空白
export default defineConfig({
  optimizeDeps: { include: ['echarts/core', 'echarts/charts', 'echarts/components', 'echarts/renderers'] },
})
```

仓库外的最小宿主(tarball 安装 → `vue-tsc` → `vite build`)在 T2.4 验证通过,见 CHANGELOG 0.1.0。

## 单张卡片嵌进宿主自己的页面(0.3.0)

页面里每张卡本来就是一段自包含配置(`{ id, type, props, bindings }`,`slot` 只是它在整页里的位置)。`<ScadaWidget>` 把其中一张单独渲染出来,校验、绑定、组件都和 `<ScadaPage>` 共用同一份代码;宿主按**页面 id(ScadaPage 资产 id)+ 组件 id** 引用。

```vue
<script setup lang="ts">
import { ScadaWidget, pickWidget, validatePageConfig } from '@grid/scada-renderer'
// 读法和整页一样:该资产 SERVER_SCOPE 属性 pageConfig
const checked = validatePageConfig(JSON.parse(raw.pageConfig))
const card = checked.ok ? pickWidget(checked.value, 'w_3k9f2a1c') : undefined // 找不到返回 undefined
</script>
<template>
  <!-- 宿主给容器尺寸(px / rem / 百分比都行),卡片 width/height: 100% 填满;不做整页缩放 -->
  <div style="width: 20rem; height: 10rem"><ScadaWidget v-if="card" :config="card" /></div>
</template>
```

- 数据源同 `<ScadaPage>`:`provideDataSource()` 注入,或 `:dataSource` 显式传。同一页放 N 张卡就是 N 份独立订阅,各自退订;一次读回 `pageConfig` 后 `pickWidget` 多次取,不必每张卡各读一遍资产。
- props:`config`(必填)、`dataSource?`、`theme?`(默认 `default`)、`design?`(sampleData,不订阅)、`expandable?`(0.3.2 起,默认 `true`,右上角「放大」)。事件:`invalid`(类型未知 / 绑定形状错,卡片显示错误态)、`bindError(widgetId, slot, message)`(某个绑定订阅失败,如无权访问实体,卡片显示「不可用」)、`expand(widgetId | null)`。
- 卡可以来自普通页面或**卡片库**(资产 `additionalInfo.kind === 'cards'`,模板 `cards`);读法完全一样,列页面时按 `kind` 把卡片库和大屏页分开。部署工具的大屏 `site.html?site=X&cards=1` 是卡片库的检视页:每张卡左栏用真数据渲染、右栏引用信息,给宿主对照用。
- 主题令牌在卡片根节点(`.sr-page.sr-widget-standalone`)生效,祖先上覆盖 `--sr-*` 即可换色;图表随容器 ResizeObserver 自动 resize。
- **组件 id 的稳定性**:工具在创建组件时生成一次(`w_` + 8 位随机),改属性 / 绑定 / 换模板都不变;把槽位里的组件换成别的类型 = 另一张卡 = 新 id。旧页面里 `w-<slot>` / `<type>-<slot>` 形式的 id 同样有效。
- `listWidgetRefs(pageConfig)` 列出一页里全部卡片的 `{ id, type, slot, title }`,给对照 / 排查引用用。

## 绑定上下文(0.9.0)

绑定里的实体 / 测点 / 时间范围可以写成「取自页面上下文」,宿主只管给上下文,渲染器解析、订阅、换设备时只重订受影响的组件:

```ts
// 配置(部署工具产出):entity / key / window 三处各自可跟随,也可写死
{ mode: 'ts-history',
  entity: { source: 'context', key: 'selectedDevice', type: 'DEVICE' },
  keys:   [{ source: 'context', key: 'selectedMeasurePoint' }],
  window: { source: 'context', key: 'timeRange' } }

// 宿主
const ctx = reactive<BindingContext>({ selectedDevice: null, selectedMeasurePoint: 'P', timeRange: '24h' })
provideBindingContext(ctx)                      // 或 <ScadaWidget :binding-context="ctx">,props 优先
ctx.selectedDevice = { type: 'DEVICE', id, name }
ctx.timeRange = { from: Date.parse('2026-09-01'), to: Date.parse('2026-09-08') }   // 绝对区间:只拉历史
```

- 键:`selectedSite` / `selectedDevice` / `selectedMeasurePoint` / `timeRange` / `custom.<名字>`。
- 缺上下文时按 `whenMissing`:`empty`(缺省,「未选择设备」)/ `hide` / `error` / `fallback`(显式选了才用 `fallback`)。
- 渲染器只读不写;联动靠 `widget-event`(整卡 `click`、表格 `row-click`、告警 `alarm-click`、接线图 `node-click`),宿主收到后自己改上下文。
- `contextKeysOf(widgets)` / 组件实例的 `contextKeys`:这页 / 这张卡要喂哪些键。
- 0.8.0 及更早的渲染器不认识这种写法。详见 CHANGELOG 0.9.0 与 `docs/给同事的-渲染器0.9.0交付-2026-09-21.md`。

## 组件放大(0.3.2)

`<ScadaPage>` 与 `<ScadaWidget>` 里每个组件右上角有「⤢」按钮(悬停时显示):点开把该组件铺满整个视口再渲染一份,共用同一份实时值、不新建订阅;✕ / Esc 关闭,另有「浏览器全屏」。默认开着,`:expandable="false"` 关掉;`design` 态不显示。事件 `expand(widgetId | null)`。放大层 Teleport 到 body,根节点 `.sr-page.sr-expand.sr-theme-<theme>`,令牌照常可覆盖。

```bash
pnpm dev          # /dev 展示页(5180):注册表、design 模式、随机数据、断线开关
pnpm test         # vitest(happy-dom)
pnpm typecheck    # vue-tsc
pnpm build        # Vite library mode → dist/index.js、dist/schema/index.js、d.ts、style.css、schema JSON
```

目录:

```
src/
  schema/            page-config.ts  registry.ts  scada-page.ts  validate.ts  page-config.schema.json(生成)
  registry.ts        运行时登记 + 针对注册表的配置校验
  binding-resolver.ts  六种 mode → DataSource;退订对账
  ScadaPage.vue      根组件:校验 → 模板 → 槽位 → 绑定 → 状态徽标(默认关)
  ScadaWidget.vue    单卡入口(0.3.0):一份 WidgetConfig → 校验 → 绑定 → 渲染;尺寸由宿主容器定
  widget-runtime.ts  绑定运行时(values / bindErrors / sampleData),ScadaPage 与 ScadaWidget 共用
  pick.ts            pickWidget / listWidgetRefs
  layout/            scaled(父容器为基准缩放)/ grid(grid-template-areas)
  provide.ts
  templates/         overview-a  monitor-3col  grid-3x3(builtinTemplates)
  widgets/           _shared/(echarts 按需 + CardFrame)  number-card  gauge  line  dual-axis  overview-card  alarm-list
                     status-light  table  image  text(共 10 种,builtinWidgets)
  theme/default.css  --sr-* 令牌
dev/                 展示页(不进 dist)
test/                schema.test  binding-resolver.test  scada-page.test  mock-data-source
```
