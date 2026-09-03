# @grid/scada-renderer(占位,T1.2 起填充)

组态渲染器 + 契约。见 `dev/docs/开发计划-v2.md` T0.2、T1.2、T2.1–T2.4、架构 v2 §6 / §8。

导出子路径:`.`(`ScadaPage`、`registerWidget`、`registerTemplate`)、`./schema`(TS 类型 + `page-config.schema.json`)、`./dev`(假数据展示页)、`./style.css`。
`vue` 与 `@grid/tb-client` 为 peerDependencies。

计划中的目录:

```
src/
  schema/            page-config.ts  registry.ts  page-config.schema.json(生成)
  registry.ts
  ScadaPage.vue
  binding-resolver.ts
  layout/            templates 引擎(scaled / grid)
  templates/         overview-a  monitor-3col  grid-3x3
  widgets/           number-card  gauge  line  dual-axis  overview-card  alarm-list
                     status-light  table  image  text  svg-diagram(同事)
                     _deferred/    VehicleMap(二期)
  theme/default.css
  dev/               /dev 展示页
test/
  fixtures/overview-a.example.json
```
