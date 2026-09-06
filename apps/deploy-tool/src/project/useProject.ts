/**
 * 编辑器的项目文件状态(T3.7):当前页面 + 连接(不含密码)+ 已发布记录 → `.scadaproj` 导出 / 导入。
 * 编辑器现阶段只有一页,pages 就是 [当前配置];rules / metaSnapshot 由向导填,这里原样保留。
 */
import { computed, ref } from 'vue'
import type { PageConfig } from '@grid/scada-renderer'
import type { PublishedRecord } from '../publish/publishPage'
import {
  createProject,
  parseProject,
  projectFileName,
  serializeProject,
  type MetaSnapshot,
  type ScadaProject,
} from './scadaproj'

export interface ProjectDeps {
  getConfig: () => PageConfig
  setConfig: (cfg: PageConfig) => void
  conn: { base: string; user: string; siteName: string }
}

export function useProject(deps: ProjectDeps) {
  const published = ref<Record<string, PublishedRecord>>({})
  const rules = ref<unknown | null>(null)
  const metaSnapshot = ref<MetaSnapshot | null>(null)
  /** 最近一次导入 / 导出的文件名(显示用) */
  const fileName = ref('')

  const current = computed<ScadaProject>(() =>
    createProject({
      connection: { base: deps.conn.base, user: deps.conn.user },
      siteName: deps.conn.siteName,
      metaSnapshot: metaSnapshot.value,
      pages: [deps.getConfig()],
      rules: rules.value,
      published: published.value,
    })
  )

  function exportText(): string {
    return serializeProject(current.value)
  }
  /** 浏览器下载;返回文件名 */
  function exportFile(): string {
    const name = projectFileName(current.value)
    const blob = new Blob([exportText()], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = name
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
    fileName.value = name
    return name
  }

  /** 导入文本;成功返回项目,失败抛 ProjectParseError */
  function importText(text: string, name = ''): ScadaProject {
    const p = parseProject(text)
    deps.conn.base = p.connection.base || deps.conn.base
    deps.conn.user = p.connection.user || deps.conn.user
    deps.conn.siteName = p.siteName || deps.conn.siteName
    published.value = { ...p.published }
    rules.value = p.rules
    metaSnapshot.value = p.metaSnapshot
    if (p.pages[0]) deps.setConfig(p.pages[0])
    fileName.value = name
    return p
  }

  function recordPublished(pageName: string, rec: PublishedRecord) {
    published.value = { ...published.value, [pageName]: rec }
  }

  return { published, rules, metaSnapshot, fileName, current, exportText, exportFile, importText, recordPublished }
}
