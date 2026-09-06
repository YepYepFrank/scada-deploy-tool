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
  standalone/  独立单文件大屏薄壳:登录页 + 页面列表 + 标头/时钟 + <ScadaPage>(替代 siteview/)
```

页面入口只有两个:`provisioner.html`(向导)与 `site.html`(大屏,T3.8 改为带登录的独立薄壳)。早期演示首页 `index.html` / `App.vue` 已在迁入时删除。

迁入时删除 / 精简:`api/tb.js` 的 `REPORT_AUTH / reportAuth / getCustomerDevices / PUBLIC_ID`、第 5 步「设为 Public」、`components/SlotCard.vue`(拆进渲染器)。
