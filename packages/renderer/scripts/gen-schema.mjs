// 由 src/schema/page-config.ts 的 PageConfig 类型生成 JSON Schema(draft 2019-09)。
// 用法:pnpm -F @grid/scada-renderer gen:schema
import { createGenerator } from 'ts-json-schema-generator'
import { writeFileSync, readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const out = resolve(here, '../src/schema/page-config.schema.json')

const generator = createGenerator({
  path: resolve(here, '../src/schema/page-config.ts'),
  tsconfig: resolve(here, '../tsconfig.json'),
  type: 'PageConfig',
  schemaId: 'https://grid.local/schemas/page-config/v1.json',
  expose: 'export',
  topRef: true,
  jsDoc: 'extended',
  skipTypeCheck: true,
  additionalProperties: false,
})
const schema = generator.createSchema('PageConfig')
schema.$schema = 'https://json-schema.org/draft/2019-09/schema'
schema.title = 'PageConfig v1'
schema.description = '0 代码部署工具 · 页面配置契约 v1(由 page-config.ts 生成,请勿手改)'

const json = JSON.stringify(schema, null, 2) + '\n'
const changed = !existsSync(out) || readFileSync(out, 'utf8') !== json
writeFileSync(out, json)
console.log(`${changed ? 'updated' : 'unchanged'} ${out} (${json.length} bytes, ${Object.keys(schema.definitions ?? {}).length} definitions)`)
