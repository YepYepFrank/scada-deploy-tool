// 浏览器内发布器 —— 薄壳。编译与写入全部在 @grid/tbsite-compiler(T1.3 起),
// 这里只保留向导用惯的旧签名:publish(cfg, devIds, api, report, publishedBy, retry) / cleanup(cfg, devIds, api, report)。
// 改编译逻辑请去 dev/packages/compiler,不要在这里加代码。
import { publish as publishPlan, cleanup } from '@grid/tbsite-compiler'

export { cleanup }
export {
  validateConfig,
  expandTemplates,
  matchSelector,
  resolveAggMembers,
  buildAggCfs,
  compile,
  summarizePlan,
  cfInputDevices,
  assetCfLoad,
  MAX_CF_PER_ENTITY,
} from '@grid/tbsite-compiler'

export function publish(cfg, devIds, api, report, publishedBy = '', retry = null) {
  return publishPlan(cfg, devIds, api, report, { publishedBy, retry })
}
