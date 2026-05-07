import { defineConfig } from 'eslint/config'
import tseslint from '@electron-toolkit/eslint-config-ts'
import eslintConfigPrettier from '@electron-toolkit/eslint-config-prettier'
import eslintPluginReact from 'eslint-plugin-react'
import eslintPluginReactHooks from 'eslint-plugin-react-hooks'
import eslintPluginReactRefresh from 'eslint-plugin-react-refresh'

export default defineConfig(
  // `studio/` is a vendored Next.js app with its own prettier/eslint conventions
  // (single quotes, no semicolons) — it has its own `next lint`. `dist-studio/`
  // is the staged production tree we ship; never lint generated output.
  {
    ignores: [
      '**/node_modules',
      '**/dist',
      '**/out',
      'studio',
      'dist-studio',
      // Bundled Node 24 runtime. We renamed its `node_modules/` to
      // `vendor_modules/` to dodge electron-builder's extraResources
      // filter, so eslint's default `**/node_modules` ignore no longer
      // covers npm's own source tree.
      'resources/node/**'
    ]
  },
  tseslint.configs.recommended,
  eslintPluginReact.configs.flat.recommended,
  eslintPluginReact.configs.flat['jsx-runtime'],
  {
    settings: {
      react: {
        version: 'detect'
      }
    }
  },
  {
    files: ['**/*.{ts,tsx}'],
    plugins: {
      'react-hooks': eslintPluginReactHooks,
      'react-refresh': eslintPluginReactRefresh
    },
    rules: {
      ...eslintPluginReactHooks.configs.recommended.rules,
      ...eslintPluginReactRefresh.configs.vite.rules
    }
  },
  // Build scripts (scripts/*.mjs) are plain ESM, not TypeScript — TS-only
  // rules from `tseslint.configs.recommended` don't apply.
  {
    files: ['**/*.{js,mjs,cjs}'],
    rules: {
      '@typescript-eslint/explicit-function-return-type': 'off'
    }
  },
  eslintConfigPrettier
)
