/**
 * validatePageConfig —— 用生成的 JSON Schema 校验一份配置(契约层校验)。
 * 只做「形状对不对」;绑定存在性 / 模板槽位 / 必填槽位属于工具校验层(计划 T3.5)与渲染器注册表运行时校验。
 */
import Ajv2019 from 'ajv/dist/2019'
import addFormats from 'ajv-formats'
import schema from './page-config.schema.json'
import type { PageConfig } from './page-config'

export interface ValidationIssue {
  /** JSON Pointer,如 /widgets/0/bindings/value/mode */
  path: string
  message: string
  keyword: string
}

let compiled: ReturnType<Ajv2019['compile']> | null = null

function getValidator() {
  if (compiled) return compiled
  const ajv = new Ajv2019({ allErrors: true, strict: false, allowUnionTypes: true })
  addFormats(ajv)
  compiled = ajv.compile(schema as object)
  return compiled
}

export function validatePageConfig(
  input: unknown
): { ok: true; value: PageConfig } | { ok: false; issues: ValidationIssue[] } {
  const validate = getValidator()
  if (validate(input)) return { ok: true, value: input as PageConfig }
  const issues: ValidationIssue[] = (validate.errors ?? []).map(e => ({
    path: e.instancePath || '/',
    message: e.message ?? 'invalid',
    keyword: e.keyword,
  }))
  return { ok: false, issues }
}
