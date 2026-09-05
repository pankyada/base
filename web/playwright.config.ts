import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  globalSetup: './e2e/global-setup.ts',
  fullyParallel: true,
  reporter: 'line',
  use: {
    baseURL: 'http://127.0.0.1:3000',
    trace: 'retain-on-failure',
    ...devices['Desktop Chrome'],
  },
  webServer: {
    command: 'pnpm build && pnpm start',
    env: {
      ...process.env,
      NEXT_PUBLIC_HARNESS_HTTP_URL: 'http://127.0.0.1:7444',
      NEXT_PUBLIC_HARNESS_WS_URL: 'ws://127.0.0.1:7444',
    },
    url: 'http://127.0.0.1:3000',
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
})
