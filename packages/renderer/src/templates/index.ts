import type { TemplateDefinition } from '../schema/registry'
import { overviewA } from './overview-a'
import { monitor3col } from './monitor-3col'
import { grid3x3 } from './grid-3x3'

export { overviewA, monitor3col, grid3x3 }

/** 包内自带模板(T2.3):态势总览台 / 三栏监控屏 / 3×3 栅格 */
export const builtinTemplates: TemplateDefinition[] = [overviewA, monitor3col, grid3x3]
