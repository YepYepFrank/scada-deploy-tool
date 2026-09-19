import type { SldSelection } from '@grid/scada-renderer'
import { perEditorState } from '../_shared/ui-state'

/** 对话框开关 + 打开那一刻的选择集快照(对话框开着时画布选择再变也不影响这次复制) */
export const bayDialog = perEditorState(() => ({ open: false, sel: null as SldSelection | null }))
