import { perEditorState } from '../_shared/ui-state'

/**
 * 底图的界面状态。显隐不写进文档(SldDoc.background 没有这个字段,也不该为编辑期的开关改契约):
 * 关掉只是这次编辑不画,重新打开编辑器又会显示。
 */
export const bgState = perEditorState(() => ({ visible: true, panel: false, error: '' }))
