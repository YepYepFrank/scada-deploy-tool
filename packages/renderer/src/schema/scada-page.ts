/**
 * <ScadaPage> 的 props 契约(宿主应用与部署工具共同依赖)。实现随 T1.2 加入,这里先定形状。
 */
import type { PageConfig } from './page-config'
import type { DataSource } from '@grid/tb-client'

export interface ScadaPageProps {
  /** 页面配置(已通过 validatePageConfig 或由渲染器内部校验) */
  config: PageConfig
  /**
   * 数据源。缺省时从 provide/inject(`provideTbClient`)获取;显式传入优先——部署工具「Customer 视角预览」用另一个实例。
   */
  dataSource?: DataSource
  /**
   * 是否在根节点显示连接状态徽标(connecting / offline)。
   * **默认 false**:宿主应用认为该信息对最终用户无意义(T0.1 回填 C3,庄艳芹);部署工具预览默认传 true 以便排障。
   */
  showStatus?: boolean
  /** 覆盖 config.theme */
  theme?: string
  /**
   * 编辑态:所有绑定改用组件 sampleData 渲染,不建立任何订阅;工具的槽位缩略图与 /dev 展示页使用。
   */
  design?: boolean
}

/** 渲染器根节点向外抛出的事件。 */
export interface ScadaPageEmits {
  /** 配置校验失败(schemaVersion 不符、未知组件 / 模板、绑定形状错) */
  (e: 'invalid', issues: { path: string; message: string }[]): void
  /** 连接状态变化(即使 showStatus=false 也会抛,宿主可自行呈现) */
  (e: 'status', status: 'connecting' | 'live' | 'offline'): void
}
