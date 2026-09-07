# ADR-002 实体引用:项目文件按名称存,发布时解析为 id

状态:**默认采纳**(2026-09-06,按开发计划 §9 风险 #4:W1 未议定即按推荐方案实施;T3.4 编辑态存 `{type,id,name}`、T3.7 发布时按「类型 + 名称」重解析已落地;同事签字待补)
关联:架构 v2 §0 ⑧、§6「三条补充约定」、§9 模块 ⑥;计划 T3.4、T3.7

## 背景

契约 `EntityRef = { type, id }` 是渲染器的输入,渲染器只认 id。但本地 `.scadaproj` 要能跨 TB 实例重放(演示 → 镜像 → 生产)、能被 CLI 发布、能进 git 做 diff;id 在不同实例上不同。现有 tbsite 已按设备名引用,发布时查 id,这条路径已验证。

## 决定(推荐)

- `.scadaproj` 中一切实体引用使用**选择器对象**:`{ type: 'DEVICE'|'ASSET', name: string, profile?: string }`。`name` 精确匹配 TB 实体名;`profile` 可选,用于同名消歧。
- 发布(T3.7 步骤 ①)时逐个解析:`GET /api/tenant/devices?deviceName=` / `GET /api/tenant/assets?assetName=`;结果按 `profile` 过滤。
  - 0 个匹配 → 错误,阻止发布,列出未解析清单。
  - 1 个 → 采用。
  - ≥ 2 个且无 `profile` 消歧 → 错误,提示补 `profile` 或改名。
- 解析结果写入 TB 上的 `PageConfig`(纯 id),同时缓存到 `.scadaproj.metaSnapshot.resolved[name] = id` 供漂移检测与离线校验;缓存不作为发布依据。
- 渲染器、宿主应用**永远不见名称**。

## 备选与放弃理由

- **项目文件直接存 id**:换实例即失效,git diff 不可读 → 否。
- **契约允许 `EntityRef` 带 name,渲染器运行时查名**:渲染器多一次 REST、Customer 账号未必有查名权限、契约变复杂 → 否。
- **用 TB 的 Entities Version Control 做跨实例迁移**:依赖 git 集成配置,一期不引入 → 列二期。

## 对代码的直接影响

- `apps/deploy-tool/src/publish/resolveEntities.ts`:选择器 → id,带缓存与冲突报告。
- `.scadaproj` schema 中 `pages[].widgets[].bindings.*.entity` 为选择器类型;`packages/renderer/schema` 的 `EntityRef` 不变。
- T3.4 绑定选择器保存的是选择器,不是 id;树节点需携带 `profile`。

## 签字

YY:____ 日期:____
同事:____ 日期:____
