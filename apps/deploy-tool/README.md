# deploy-tool(占位,T0.3 由 tb-frontend/ 复制迁入)

部署工具 = 编辑壳。现有向导 `Provisioner.vue`(JS,保留)+ 新增 TS 模块。见 `dev/docs/开发计划-v2.md` §2.3、T0.3、T3.1–T3.8,架构 v2 §9。

迁入后新增的目录(其余沿用 tb-frontend 结构):

```
src/
  editor/      EditorApp.vue  TemplatePicker.vue  SlotBoard.vue  WidgetPicker.vue  PropsForm.vue  BindingRow.vue
               BindingsPanel.vue  EntityTree.vue  PreviewPane.vue(T3.6)  PublishPanel.vue(T3.7)  validate.ts  useEditorState.ts
  meta/        MetaNode.ts(实体树,Contains 递归,虚拟滚动)  useMeta.ts(连接与元数据状态)
  migrate/     siteConfigToPageConfig.ts(转发到 compiler)
  publish/     publishPage.ts(转发到 compiler 的 page/publish-page.ts:六步发布 + 逆序回滚 + 漂移检测)
  project/     scadaproj.ts(.scadaproj 序列化 / 解析)  useProject.ts(导出 / 导入 / 已发布记录)
  standalone/  独立单文件大屏薄壳(T3.8):StandaloneApp.vue 登录页(token 只在 sessionStorage)→ 页面列表(登录身份看得到的
               ScadaPage 资产,?site= 按站点 Contains 关系过滤)→ 标头 / 时钟 / 菜单 + <ScadaPage>(LegacyDataSource,含 kz ext)
  api/tb.js    只剩地址解析(?base= / ?env= / ?kz=)
  components/  KeyPicker.vue(向导第 3 步用)
```

页面入口:`provisioner.html`(向导:第 4 步嵌入 `EditorApp`——嵌入态只显示画布缩略图,点击进入全屏编辑(Teleport 覆盖层 + 浏览器全屏,同一实例,Esc / 「返回向导」退出;2026-09-07),第 5 步页面发布 + 规则发布 + `.scadaproj` 下载,T3.7)、`editor.html`(独立组态编辑器,自带 TB 连接面板,联调用)、`site.html`(独立大屏薄壳,`pnpm build:site` 产出单文件 `dist-site/site.html`,约 0.8 MB;放进任意静态目录后用 `?base=http://TB:8080&site=<站点名>` 打开,登录后看当前账号被分配的页面)。早期演示首页 `index.html` / `App.vue` 已在迁入时删除。

已删除(T3.8,2026-09-06):`siteview/`(旧大屏)、`composables/useTelemetry.js`、`shared/layoutTemplates.js`、`components/{StatTile,LineChart,VehicleMap,GaugeArc,SlotCard}.vue`、leaflet 依赖;`api/tb.js` 的 Public 匿名登录、`REPORT_AUTH / reportAuth / getCustomerDevices` 三级取数与 `?pub=` 参数;`.env` 的 `VITE_REPORT_*`。大屏没有任何内置身份:看得到什么由登录账号在 TB 里的分配决定。
