import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['**/*.test.ts'],
    coverage: { exclude: ['src/gen/**', 'src/legacy/**'] },
  },
});
