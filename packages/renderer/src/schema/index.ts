// @grid/scada-renderer/schema —— 契约子路径。工具输出它、渲染器消费它、宿主只消费类型。
export * from './page-config'
export * from './registry'
export * from './scada-page'
export { default as pageConfigJsonSchema } from './page-config.schema.json'
export { validatePageConfig, type ValidationIssue } from './validate'
