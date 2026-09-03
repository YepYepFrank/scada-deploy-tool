// tsup onSuccess:把生成的 JSON Schema 原样带进 dist(供非 JS 工具直接读取;JS 侧走 pageConfigJsonSchema 导出)。
import { copyFileSync, mkdirSync } from 'node:fs'
mkdirSync('dist/schema', { recursive: true })
copyFileSync('src/schema/page-config.schema.json', 'dist/schema/page-config.schema.json')
