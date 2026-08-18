import js from '@eslint/js';
import ts from 'typescript-eslint';
import globals from 'globals';

export default ts.config(
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      '**/coverage/**',
      '**/.git/**',
      'packages/db/prisma/generated/**',
      'packages/db/generated/**',
      'apps/server/web/assets/**',
    ],
  },
  js.configs.recommended,
  ...ts.configs.recommended,
  {
    files: ['**/*.ts', '**/*.tsx'],
    extends: [
      ...ts.configs.recommendedTypeChecked,
      ...ts.configs.strictTypeChecked,
      ...ts.configs.stylisticTypeChecked,
    ],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
      globals: {
        ...globals.node,
        ...globals.browser,
      },
    },
    rules: {
      // Async / promise safety
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      '@typescript-eslint/await-thenable': 'error',

      // Type safety
      '@typescript-eslint/no-unsafe-assignment': 'warn',
      '@typescript-eslint/no-unsafe-member-access': 'warn',
      '@typescript-eslint/no-unsafe-call': 'warn',
      '@typescript-eslint/no-unsafe-return': 'warn',
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-non-null-assertion': 'warn',

      // Logic / correctness
      '@typescript-eslint/strict-boolean-expressions': 'off',
      '@typescript-eslint/prefer-nullish-coalescing': 'warn',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],

      // Style
      '@typescript-eslint/consistent-type-imports': 'warn',
      '@typescript-eslint/no-inferrable-types': 'off',
    },
  },
  {
    // The use-case guest contract, enforced rather than asked for.
    //
    // A shell's views get `UseCaseViewProps` and nothing else: six fields, all
    // either already on the wire or a callback Foreman owns. Reaching past that
    // — into the core views' privileged context, into Foreman's own API client,
    // or into the app shell — is how a plugin seam quietly becomes a second
    // copy of the app. It was a convention held by review until now.
    //
    // Scoped to the shell directories only. `core.tsx`, `registry.ts`,
    // `data-source.ts` and `health.tsx` are the seam itself and legitimately
    // import these. Test files are excluded: they assert *about* the seam, and
    // one already imports `ObjectiveState` from `data/api.js` to build a state.
    files: [
      'apps/web/src/foreman/usecases/victoria/**/*.ts',
      'apps/web/src/foreman/usecases/victoria/**/*.tsx',
      'apps/web/src/foreman/usecases/polymarket/**/*.ts',
      'apps/web/src/foreman/usecases/polymarket/**/*.tsx',
      'apps/web/src/foreman/usecases/demo.tsx',
    ],
    ignores: ['**/*.test.ts', '**/*.test.tsx'],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [
          {
            group: ['**/core.js', '**/core.jsx', '**/usecases/core'],
            message:
              'Use-case views get UseCaseViewProps, not CoreViewContext. Core views are the app; a shell is a guest — derive what you need from `state`.',
          },
          {
            group: ['**/data/api.js', '**/data/api', '**/data/useForeman.js'],
            message:
              "Don't call Foreman's own API from a shell. Domain data comes from the shell's own typed client (`createDataSource`); Foreman state arrives as `props.state`, and mutations go through `props.mutate`.",
          },
          {
            group: ['**/ForemanApp.js', '**/ForemanApp'],
            message:
              'A shell must not reach into the app shell. Everything it may touch is on UseCaseViewProps.',
          },
        ],
      }],
    },
  },
  {
    files: [
      '**/*.js',
      '**/*.mjs',
      '**/*.cjs',
      '**/*.jsx',
      '**/*.config.ts',
      '**/*.config.js',
      '**/*.test.ts',
      '**/*.test.tsx',
      'scripts/**/*.js',
      'scripts/**/*.ts',
      'scripts/**/*.mjs',
    ],
    extends: [ts.configs.disableTypeChecked],
    languageOptions: {
      globals: globals.node,
    },
  }
);
