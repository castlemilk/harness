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
