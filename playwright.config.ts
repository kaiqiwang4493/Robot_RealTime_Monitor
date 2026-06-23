import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  use: {
    baseURL: 'http://127.0.0.1:8080',
    headless: true,
  },
  webServer: {
    command: 'npm start',
    url: 'http://127.0.0.1:8080/health',
    reuseExistingServer: true,
  },
});
