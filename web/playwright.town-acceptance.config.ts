import { defineConfig } from '@playwright/test'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import clientAcceptance from './playwright.client-acceptance.config'

// Reuse the established temp-HOME runtime and fake provider while selecting
// only the Town browser acceptance fixture. Give Next its own output directory
// so this run cannot replace the build served on the user's port 3000.
const isolatedNextDist = join(tmpdir(), `base-town-pt104-next-${process.pid}-${Date.now()}`)
process.env.NEXT_DIST_DIR = isolatedNextDist
const webServer = clientAcceptance.webServer
const isolatedWebServer = Array.isArray(webServer)
  ? webServer.map(server => ({ ...server, env: { ...server.env, NEXT_DIST_DIR: isolatedNextDist } }))
  : webServer ? { ...webServer, env: { ...webServer.env, NEXT_DIST_DIR: isolatedNextDist } } : undefined

export default defineConfig({
  ...clientAcceptance,
  testMatch: /town-assets-state\.spec\.ts/,
  globalTeardown: './e2e/town-acceptance.global-teardown.ts',
  webServer: isolatedWebServer,
})
