import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      globals: globals.browser,
    },
    rules: {
      // 「解构掉几个字段再取 rest」是 TS 里表达“去掉这两个键”的惯用写法，
      // 测试里靠它构造「没有 score_max」的样本。默认配置会把被丢掉的那几个键
      // 报成 unused-vars，于是要么写 _ 前缀别名、要么写 Object.entries().filter()——
      // 两者都比原写法绕。这条不是放宽标准：rest 之外的未使用变量照样报。
      '@typescript-eslint/no-unused-vars': [
        'error',
        { ignoreRestSiblings: true, argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
])
