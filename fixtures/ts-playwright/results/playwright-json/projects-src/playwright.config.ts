import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  retries: 1,
  workers: 1,
  projects: [
    { name: 'first', testMatch: /unit\.spec\.ts/ },
    { name: 'second', testMatch: /unit\.spec\.ts/ },
  ],
});
