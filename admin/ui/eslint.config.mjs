import js from '@eslint/js';
import { defineConfig, globalIgnores } from 'eslint/config';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

// The repo-root config ignores `admin/**`; this config owns `admin/ui`, so the two never overlap.
export default defineConfig([
  globalIgnores(['dist/**', 'node_modules/**']),
  {
    files: ['src/**/*.{ts,tsx}', 'tests/**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      react.configs.flat.recommended,
      // `recommended` is the hooks ruleset (rules-of-hooks + exhaustive-deps) and understands
      // `useEffectEvent`; `recommended-latest` is the React Compiler suite, a separate adoption.
      reactHooks.configs.recommended,
    ],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.browser, ...globals.node },
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    settings: { react: { version: 'detect' } },
    rules: {
      // A stale-closure dependency is a bug, not a note: `npm run check` must fail on it.
      'react-hooks/exhaustive-deps': 'error',
    },
  },
  {
    // Vite compiles `src` with the automatic runtime (tsconfig `jsx: "react-jsx"`), so no
    // `React` import is needed here. `tests` is deliberately excluded: it sits outside the
    // tsconfig `include`, so tsx compiles it with the classic `React.createElement` runtime
    // and each test's `React` import is load-bearing.
    files: ['src/**/*.{ts,tsx}'],
    extends: [react.configs.flat['jsx-runtime']],
  },
]);
