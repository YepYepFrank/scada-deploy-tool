// 大屏 / 工具的 TB 地址解析——只剩代理常量(T3.8 精简)。
// 曾经这里有 Public 匿名登录、报表账号 REPORT_AUTH 与三级取数,已随 siteview/ 一并删除:
// 现在看得到什么完全由登录身份在 TB 里的分配决定,凭据只在运行时输入。
//
// ?base=<TB 地址>:单文件部署(dist-site/site.html 放进任意静态目录)时必填,指向 TB 的 http://host:8080;
// 开发 / 预览时留空走同源 /api(vite 代理到镜像),?env=mirror 走 /tbm(两条现在等价,留着兼容旧书签)。
export const ENVS = {
  demo: { base: '' },
  mirror: { base: '/tbm' },
}

/** @param {URLSearchParams} qs */
export function resolveApiBase(qs) {
  const override = qs.get('base')
  if (override !== null) return override.replace(/\/+$/, '')
  return ENVS[qs.get('env') === 'mirror' ? 'mirror' : 'demo'].base
}

/**
 * kz 归档服务地址(ADR-004 路线 A,`mode: 'ext'`):?kz= 显式给;否则同源部署下用 /kz 反代(vite 与 nginx 都配了);
 * 直连 ?base= 且没给 ?kz= 时返回空串,数据源会把 ext 绑定报为「kz 未配置」。
 * @param {URLSearchParams} qs
 * @param {string} apiBase
 */
export function resolveKzBase(qs, apiBase) {
  const kz = qs.get('kz')
  if (kz !== null) return kz.replace(/\/+$/, '')
  return /^https?:\/\//.test(apiBase) ? '' : '/kz'
}
