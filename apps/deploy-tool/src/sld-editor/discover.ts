/**
 * 扩展发现:`panels/<名字>/index.ts`、`tools/<名字>/index.ts` 各 `export default defineSldExtension({...})`,
 * 加一个面板 / 工具不用改骨架的任何文件(ext.ts 的约定)。import.meta.glob 是 Vite 的编译期宏,所以单独放一个文件;
 * 整理 / 排序 / 冲突处理的纯逻辑在 extensions.ts。
 */
import { collectExtensions, type SldExtensionSet } from './extensions'

const modules = import.meta.glob('./{panels,tools}/*/index.ts', { eager: true })

export const discoverExtensions = (): SldExtensionSet => collectExtensions(modules)
