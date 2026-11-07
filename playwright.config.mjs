import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  workers: 1,
  timeout: 45000,
  use: { baseURL: process.env.PREVIEW_URL || 'http://127.0.0.1:4173', viewport: { width: 1100, height: 820 } },
  webServer: process.env.PREVIEW_URL ? undefined : {
    command: 'npm run dev',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: !process.env.CI,
  },
});
