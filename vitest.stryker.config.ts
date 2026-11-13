import { defineConfig } from 'vitest/config';

// Used by StrykerJS (stryker.config.json). Unit tests only: the golden fixture
// project spawns a git repository per case and would make every mutant cost
// minutes. Lang package tests are included because they exercise core's
// inventory and tree-sitter helpers through the development condition.
export default defineConfig({
  resolve: { conditions: ['development'] },
  test: {
    name: 'unit',
    include: ['packages/**/src/**/*.test.ts'],
    // Hostile input timing tests run minutes under instrumentation; they prove linearity, not behaviour.
    exclude: ['**/node_modules/**', '**/review-hardening.test.ts'],
    environment: 'node',
    env: { TESTWITNESS_TIMING: 'off' },
  },
});
