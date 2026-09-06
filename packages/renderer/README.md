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
  layout/            scaled(父容器为基准缩放)/ grid(grid-template-areas)
  provide.ts
  templates/         overview-a  monitor-3col  grid-3x3(builtinTemplates)
  widgets/           _shared/(echarts 按需 + CardFrame)  number-card  gauge  line  dual-axis  overview-card  alarm-list
                     status-light  table  image  text(共 10 种,builtinWidgets)
  theme/default.css  --sr-* 令牌
dev/                 展示页(不进 dist)
test/                schema.test  binding-resolver.test  scada-page.test  mock-data-source
```
