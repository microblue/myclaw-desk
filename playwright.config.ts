import { defineConfig } from '@playwright/test'

// E2E tests launch the packaged Electron app via Playwright's `_electron`
// API. Tests assume `out/main/index.js` exists — globalSetup runs the
// electron-vite build first.

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 120_000,
  expect: { timeout: 15_000 },
  fullyParallel: false, // electron tests share host resources (ports, daemon)
  workers: 1,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  globalSetup: './tests/e2e/global-setup.ts'
})
