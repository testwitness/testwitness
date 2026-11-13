import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['scripts/**', '.stryker-tmp/**', 'reports/**', 'bench/rss-hook.cjs', 'bench/.prof/**', '**/dist/**', '**/node_modules/**', 'fixtures/*/project/**', 'fixtures/*/cases/**', 'fixtures/*/results/**', 'corpus/**', 'study/data/**', 'study/smoke/**', 'study/cache/**', 'packages/cli/bin/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/consistent-type-imports': 'error',
    },
  },
);
