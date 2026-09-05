// ESLint 9 flat config:TS 包 + Vue 应用。规则从宽起步,一期只挡明显错误;风格交给 Prettier。
import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import vue from 'eslint-plugin-vue'
import prettier from 'eslint-config-prettier'
import globals from 'globals'

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/dist-site/**',
      '**/node_modules/**',
      '**/*.schema.json',
      'apps/deploy-tool/src/provisioner/Provisioner.vue',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  ...vue.configs['flat/essential'],
  {
    // Node 侧文件:vite 配置、脚本、CLI
    files: ['**/*.config.{js,mjs,ts}', '**/scripts/**', '**/bin/**', 'eslint.config.js'],
    languageOptions: { globals: globals.node },
  },
  {
    files: ['**/*.vue'],
    languageOptions: { parserOptions: { parser: tseslint.parser, extraFileExtensions: ['.vue'] } },
  },
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'vue/multi-word-component-names': 'off',
    },
  },
  {
    files: ['apps/deploy-tool/src/**/*.{js,vue}'],
    languageOptions: {
      globals: {
        window: 'readonly',
        document: 'readonly',
        console: 'readonly',
        fetch: 'readonly',
        WebSocket: 'readonly',
        localStorage: 'readonly',
        sessionStorage: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
        URLSearchParams: 'readonly',
        location: 'readonly',
        navigator: 'readonly',
        requestAnimationFrame: 'readonly',
        ResizeObserver: 'readonly',
        Blob: 'readonly',
        URL: 'readonly',
        FileReader: 'readonly',
        confirm: 'readonly',
        alert: 'readonly',
        prompt: 'readonly',
        crypto: 'readonly',
        AbortController: 'readonly',
        Intl: 'readonly',
      },
    },
    // 迁入的现有向导代码:只告警不阻断;新写的 TS 模块不在此列
    rules: {
      'no-unused-vars': 'warn',
      'vue/no-unused-vars': 'warn',
      'no-undef': 'warn',
      'no-empty': 'warn',
      'no-useless-escape': 'off',
      'no-irregular-whitespace': 'warn',
    },
  },
  prettier
)
