# @grid/scada-renderer

组态渲染器 + 页面配置契约。只认 JSON、不认业务:`<ScadaPage :config>` 把配置里的绑定翻译成对 `DataSource` 的订阅,按模板槽位放组件。

- 契约:`src/schema/`(`PageConfig` / 注册表类型 / `ScadaPageProps`),子路径 `@grid/scada-renderer/schema`;JSON Schema 由类型生成(`pnpm gen:schema`)。
- 注册表:`registerWidget / registerTemplate / validateAgainstRegistry`;`registerBuiltins()` 注册包内组件与模板。
- 数据源注入:`provideDataSource(ds)` 或 `<ScadaPage :dataSource>`;key 为 `Symbol.for('grid:data-source')`,tb-client 的 Vue 层可直接 provide 同一 key。
- `vue` 与 `@grid/tb-client` 是 peerDependencies;`echarts` 是 dependency,按子路径(`echarts/core` 等)引入。**宿主 Vite 需 `optimizeDeps.include` 这四个子路径**,否则预构建拆成两份实例、图表空白。

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
  widgets/           _shared/(echarts 按需 + CardFrame)  number-card  gauge  line  dual-axis  overview-card  alarm-list  text
                     (T2.2 加 status-light、table、image)
  theme/default.css  --sr-* 令牌
dev/                 展示页(不进 dist)
test/                schema.test  binding-resolver.test  scada-page.test  mock-data-source
```
