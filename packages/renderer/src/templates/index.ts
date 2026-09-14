import type { TemplateDefinition } from '../schema/registry'
import { overviewA } from './overview-a'
import { monitor3col } from './monitor-3col'
import { grid3x3 } from './grid-3x3'
import { cards } from './cards'

export { overviewA, monitor3col, grid3x3, cards }

/** 包内自带模板(T2.3):态势总览台 / 三栏监控屏 / 3×3 栅格;卡片库(2026-09-14,可复用卡片,不作为大屏页) */
export const builtinTemplates: TemplateDefinition[] = [overviewA, monitor3col, grid3x3, cards]

/** 卡片库模板 id:大屏页面列表跳过它;工具用它建站点的「卡片库」页 */
export const CARDS_TEMPLATE_ID = cards.id
