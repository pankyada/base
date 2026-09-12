import { defineConfig, devices } from '@playwright/test'

const providerPort = 18831
const harnessPort = 18832
const webPort = 3012

export default defineConfig({
  testDir: './e2e',
  testMatch: /client-acceptance\.spec\.ts/,
  globalSetup: './e2e/client-acceptance.global-setup.ts',
  fullyParallel: false,
  workers: 1,
  reporter: 'line',
  timeout: 45_000,
  use: { baseURL: `http://127.0.0.1:${webPort}`, trace: 'retain-on-failure', ...devices['Desktop Chrome'] },
  webServer: {
    command: `pnpm build && pnpm start -p ${webPort}`,
    env: { ...process.env, NEXT_PUBLIC_HARNESS_HTTP_URL: `http://127.0.0.1:${harnessPort}`, NEXT_PUBLIC_HARNESS_WS_URL: `ws://127.0.0.1:${harnessPort}` },
    url: `http://127.0.0.1:${webPort}`,
    reuseExistingServer: false,
    timeout: 180_000,
  },
})
