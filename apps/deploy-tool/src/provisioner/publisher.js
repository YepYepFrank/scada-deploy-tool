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
  expandConfig,
  outputInventory,
  // 第 3 步:建结果资产、同步平台现状、接管 / 交还(2026-09-11)
  ensureResultAssets,
  readPlatformState,
  handBackCf,
  findAsset,
  listCfs,
  // 第 3 步冲突的「以 TB 为准 / 待定」(2026-09-11)
  adoptCf,
  cfItemKey,
  chainItemKey,
} from '@grid/tbsite-compiler'

/** skip:这次发布不写的对象(第 3 步冲突选「待定」的,cfItemKey / chainItemKey) */
export function publish(cfg, devIds, api, report, publishedBy = '', retry = null, skip = []) {
  return publishPlan(cfg, devIds, api, report, { publishedBy, retry, skip })
}
