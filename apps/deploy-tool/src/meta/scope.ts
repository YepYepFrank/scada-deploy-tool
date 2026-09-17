/**
 * 实体树按站点范围裁剪(2026-09-17 YY:第 4 步选实体列的是 TB 全库,应只列第 2 步认领的设备 + 第 3 步运算涉及的资产)。
 * 规则(按名字匹配,与 ADR-002「按名字存」口径一致):
 *   - 设备:名字在 scope.devices 里才留;网关:自己在范围里或有留下的子设备就留;
 *   - 资产:名字在 scope.assets 里才留,祖先资产为了保住结构一并留(站点 Contains 结果资产);
 *   - 分组 / 站点根:有内容才留(根总留)。
 * 纯函数,不改输入。
 */
import type { MetaNode } from './MetaNode'

export interface EntityScope {
  /** 设备名(含网关名) */
  devices: Iterable<string>
  /** 资产名(站点资产、结果资产等) */
  assets: Iterable<string>
}

export function pruneTree(root: MetaNode | null, scope: EntityScope | null | undefined): MetaNode | null {
  if (!root || !scope) return root
  const dev = new Set(scope.devices)
  const ast = new Set(scope.assets)
  const walk = (n: MetaNode): MetaNode | null => {
    const kids = n.children.map(walk).filter((c): c is MetaNode => !!c)
    switch (n.kind) {
      case 'device':
        return dev.has(n.name) ? { ...n, children: kids } : null
      case 'gateway':
        return dev.has(n.name) || kids.length ? { ...n, children: kids } : null
      case 'asset':
        return ast.has(n.name) || kids.length ? { ...n, children: kids } : null
      case 'group':
        return kids.length ? { ...n, children: kids } : null
      default:
        return { ...n, children: kids }
    }
  }
  return walk(root)
}
