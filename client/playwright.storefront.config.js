import { defineConfig } from '@playwright/test';
import baseConfig from './playwright.config.js';

export default defineConfig({
  ...baseConfig,
  testDir: './e2e-isolated',
  outputDir: './.cache/test-results/storefront',
  webServer: undefined,
  workers: 1,
  use: { ...baseConfig.use, baseURL: undefined },
});
