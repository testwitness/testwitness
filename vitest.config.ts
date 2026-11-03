import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { conditions: ['development'] },
  test: {
    projects: [
      {
        test: {
          name: 'unit',
          include: ['packages/**/src/**/*.test.ts'],
          environment: 'node',
        },
      },
      {
        test: {
          name: 'fixtures',
          include: ['fixtures/runner/*.golden.test.ts'],
          environment: 'node',
          testTimeout: 60_000,
        },
      },
    ],
  },
});
