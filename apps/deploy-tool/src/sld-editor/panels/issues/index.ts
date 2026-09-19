/** 「问题」面板(T5.7):结构校验 + 图 ↔ 绑定一致性;角标 = error + warning 数。 */
import { defineSldExtension } from '../../ext'
import IssuesPanel from './IssuesPanel.vue'
import { issuesOf } from './state'

export default defineSldExtension({
  panels: [
    {
      id: 'issues',
      title: '问题',
      order: 30,
      component: IssuesPanel,
      badge: ctx => {
        const r = issuesOf(ctx).report.value
        return r.errors + r.warnings || undefined
      },
    },
  ],
})
