// @ts-check
import eslint from '@eslint/js';
import eslintPluginPrettierRecommended from 'eslint-plugin-prettier/recommended';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['eslint.config.mjs'],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  eslintPluginPrettierRecommended,
  {
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.jest,
      },
      sourceType: 'commonjs',
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-floating-promises': 'warn',
      '@typescript-eslint/no-unsafe-argument': 'warn',
      "prettier/prettier": ["error", { endOfLine: "auto" }],
    },
  },
  {
    // Jest mock objects (`jest.fn()` assigned onto a plain object literal)
    // are the textbook false-positive case for `unbound-method` — there is
    // no real `this` to lose, since the "method" is just a mock function
    // property, never a class instance method being torn off.
    //
    // Patterns are prefixed with `**/` (rather than just `test/**/*.ts`)
    // because lint-staged invokes this config via an explicit `--config`
    // flag from the repo root, not from `backend/` — and ESLint flat config
    // resolves `files` globs relative to the *current working directory* in
    // that case, not the config file's own directory.
    files: ['**/test/**/*.ts'],
    rules: {
      '@typescript-eslint/unbound-method': 'off',
    },
  },
  {
    // supertest's `response.body` is `any` by design (it doesn't know the
    // response schema) — every integration test in this project asserts
    // against it, so these `no-unsafe-*` checks would otherwise need a cast
    // on nearly every line rather than catching anything real.
    files: ['**/test/integration/**/*.ts', '**/test/e2e/**/*.ts'],
    rules: {
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
    },
  },
);
