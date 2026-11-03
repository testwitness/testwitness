// @ts-nocheck
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  retries: 1,
  workers: 1,
  reporter: [['list'], ['junit', { outputFile: '../junit/junit.xml' }]],
  projects: [
    { name: 'unit', testMatch: /unit\.spec\.ts/ },
    { name: 'api', testMatch: /api\.spec\.ts/, use: { browserName: 'chromium' } },
  ],
});
