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
    // Since the contract moved to `@omega-harness/usecase-kit`, the rule also
    // enforces the direction of the dependency: a shell imports the KIT, never
    // the host's copy of the seam. Reaching for `../registry.js` or
    // `../../types.js` still compiles in-tree and is exactly what would fail
    // the day the shell moves to its own repository, so it is an error here.
    //
    // Scoped to the shell files that are still in this repository, which since
    // OT-3 is exactly one: `demo.tsx`, the host-owned proof shell. Victoria and
    // Polymarket now live in the omega repo (`foreman-plugins/`), where the
    // constraint holds far more strongly than a lint rule could — none of the
    // paths below are reachable from over there at all, and the kit is the only
    // dependency they have on Foreman. The rule stays because it is what an
    // in-repo shell (a new one, or the demo) would be measured against, and
    // because the messages are the documentation of the seam.
    //
    // `core.tsx`, `registry.ts` and `health.tsx` are the seam itself and
    // legitimately import these, so they are not listed. Test files are
    // excluded: they assert *about* the seam, and import the roster
    // (`./index.js`) to exercise the real registration path.
    files: ['apps/web/src/foreman/usecases/demo.tsx'],
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
          {
            // The host's registry, health machinery and view model. Each has a
            // kit equivalent, and the relative paths below are the only shapes
            // these imports can take from inside a shell directory.
            group: [
              '../registry.js',
              '../../registry.js',
              '**/usecases/registry.js',
              '../health.js',
              '../../health.js',
              '**/usecases/health.js',
              '../data-source.js',
              '../../data-source.js',
              '../../types.js',
              '../../../types.js',
              '**/foreman/types.js',
            ],
            message:
              "Import the contract from '@omega-harness/usecase-kit', not from the host. The registry and the health probes are Foreman's; the types a shell may name are the kit's.",
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
