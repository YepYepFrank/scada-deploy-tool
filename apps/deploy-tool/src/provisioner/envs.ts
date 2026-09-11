// 第 1 步「目标环境 / 项目」下拉的清单(2026-09-11):内置环境 + 本机录入的自定义项目,都能重命名、删除。
// 内置环境的地址走 vite 代理、写死在代码里,所以对它的「重命名 / 删除」是本机覆盖:改显示名、在下拉里隐藏
// (不提供恢复,YY 2026-09-11 定);自定义项目本来就只存在本机,删了就没了。纯函数,不碰 localStorage。

export interface EnvDef {
  label: string
  base: string
  defUser: string
  defPass: string
}
export interface EnvEntry extends EnvDef {
  builtin?: boolean
  custom?: boolean
}
export interface CustomEnv {
  id: string
  label: string
  base: string
}
/** 内置环境的本机覆盖:改过的显示名、是否已从下拉里删掉 */
export type BuiltinOverrides = Record<string, { label?: string; hidden?: boolean }>

export const LS_ENVS = 'gridops_custom_envs'
export const LS_BUILTIN_ENVS = 'gridops_builtin_envs'
export const DEFAULT_USER = 'tenant@thingsboard.org'

/** 下拉里显示的全部环境(按出现顺序:内置在前、自定义在后);已删掉的内置环境不在里面 */
export function mergeEnvs(
  builtins: Record<string, EnvDef>,
  overrides: BuiltinOverrides = {},
  customs: CustomEnv[] = []
): Record<string, EnvEntry> {
  const m: Record<string, EnvEntry> = {}
  for (const [id, e] of Object.entries(builtins)) {
    const o = overrides[id] ?? {}
    if (o.hidden) continue
    m[id] = { ...e, label: o.label?.trim() || e.label, builtin: true }
  }
  for (const e of customs)
    m[e.id] = { label: e.label, base: e.base, defUser: DEFAULT_USER, defPass: '', custom: true }
  return m
}

/** 名字是否已被别的环境占用(去掉首尾空格比较;改名时排除自己) */
export const labelTaken = (envs: Record<string, EnvEntry>, label: string, exceptId: string | null = null): boolean =>
  Object.entries(envs).some(([id, e]) => id !== exceptId && e.label.trim() === label.trim())

/** 当前环境不在清单里(被删了)时退到哪个:优先 prefer,否则清单里第一个;清单空返回 null */
export const fallbackEnv = (envs: Record<string, EnvEntry>, prefer = 'mirror'): string | null =>
  prefer in envs ? prefer : (Object.keys(envs)[0] ?? null)

/** 内置环境改名:空名或与默认名相同 = 恢复默认名(去掉覆盖) */
export function renameBuiltin(
  overrides: BuiltinOverrides,
  builtins: Record<string, EnvDef>,
  id: string,
  label: string
): BuiltinOverrides {
  const name = label.trim()
  const next = { ...overrides, [id]: { ...overrides[id] } }
  if (!name || name === builtins[id]?.label) delete next[id]!.label
  else next[id]!.label = name
  if (!next[id]!.label && !next[id]!.hidden) delete next[id]
  return next
}

/** 删掉(在下拉里隐藏)一个内置环境 */
export const hideBuiltin = (overrides: BuiltinOverrides, id: string): BuiltinOverrides => ({
  ...overrides,
  [id]: { ...overrides[id], hidden: true },
})
