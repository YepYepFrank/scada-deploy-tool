/// <reference types="vite/client" />
// /dev 页可用的环境变量(来自 monorepo 根 .env.local,仅 VITE_ 前缀会被 Vite 暴露)
interface ImportMetaEnv {
  readonly VITE_TB_USER?: string
  readonly VITE_TB_PASSWORD?: string
}
