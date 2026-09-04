import js from '@eslint/js';
import { defineConfig, globalIgnores } from 'eslint/config';
import react from 'eslint-plugin-react';
import reactHooksV7 from 'eslint-plugin-react-hooks-v7';
import globals from 'globals';
import tseslint from 'typescript-eslint';

// Scratch config for Phase 6B: measures eslint-plugin-react-hooks v7's React Compiler
// rules (`recommended-latest`) against this codebase without touching `eslint.config.mjs`
// or the v6 devDependency that `npm run check` uses. Mirrors that config's parser/globals/
// files/jsx-runtime/tests blocks; only the react-hooks block differs.
export default defineConfig([
  globalIgnores(['dist/**', 'node_modules/**']),
  {
    files: ['src/**/*.{ts,tsx}', 'tests/**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      react.configs.flat.recommended,
      // `recommended-latest` is the React Compiler suite (set-state-in-effect, refs, purity,
      // etc.) — a separate adoption from the classic rules-of-hooks/exhaustive-deps pair.
      reactHooksV7.configs.flat['recommended-latest'],
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
    // `tsx`/esbuild apply a tsconfig's compiler options only to files that config's
    // `include` actually covers, not just the nearest tsconfig.json by directory. `src` is
    // covered by this directory's tsconfig.json (`jsx: "react-jsx"`), so Vite and `tsc -b`
    // both compile it with the automatic runtime. `tests/` is outside that `include`
    // (["src", "../shared"]), so every `test:*` script in package.json passes
    // `--tsconfig tsconfig.tests.json` explicitly — that config's `include` does cover
    // `tests/` and also sets `jsx: "react-jsx"`, so tests type-check *and* run under the
    // same automatic runtime as `src`. Neither directory needs a `React` import for JSX
    // alone anymore.
    files: ['src/**/*.{ts,tsx}', 'tests/**/*.{ts,tsx}'],
    extends: [react.configs.flat['jsx-runtime']],
  },
]);
