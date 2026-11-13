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
      {
        // The corpus replayed as working tree changes (the agent guard's proof); about three minutes.
        test: {
          name: 'replay',
          include: ['corpus/runner/*.test.ts'],
          environment: 'node',
          testTimeout: 120_000,
          hookTimeout: 900_000,
        },
      },
    ],
  },
});
