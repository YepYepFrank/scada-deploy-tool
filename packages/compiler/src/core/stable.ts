/** 与键顺序无关的 JSON 串:比对 TB 读回的对象与计划里的对象时用(TB 不保证键的顺序) */
export const stableJson = (v: unknown): string => {
  if (Array.isArray(v)) return `[${v.map(stableJson).join(',')}]`
  if (v && typeof v === 'object')
    return `{${Object.keys(v)
      .sort()
      .map(k => JSON.stringify(k) + ':' + stableJson((v as Record<string, unknown>)[k]))
      .join(',')}}`
  return JSON.stringify(v ?? null)
}
