import { expect, test } from '@playwright/test'
import { unlinkSync } from 'node:fs'

const source = process.env.R10_E2E_SOURCE ?? '/Users/pankajkumaryadav/Desktop/development/base/.r10-runtime-fixture.json'
const user = process.env.R10_E2E_USER ?? 'runtime-browser'
const api = process.env.NEXT_PUBLIC_HARNESS_HTTP_URL ?? 'http://127.0.0.1:7444'

test('Canvas uses mounted REST recipe runtime and retains last-good after source deletion', async ({ page }) => {
  await page.goto(`/canvas?user=${encodeURIComponent(user)}`)
  await expect(page.getByText(/^Artifact [0-9a-f-]+$/).first()).toBeVisible()
  await page.getByRole('button', { name: /pin Artifact [0-9a-f-]+/ }).click()
  const firstRefresh = page.waitForResponse(response => response.url().includes('/artifacts/') && response.url().includes('/refresh'))
  await page.getByRole('button', { name: 'refresh' }).click()
  const firstBody = await (await firstRefresh).json() as { recipe?: { last_good?: { payload?: unknown } } }
  expect(firstBody.recipe?.last_good?.payload).toEqual({ value: 6 })

  await page.reload()
  const persisted = await page.evaluate(async ({ api, user }) => (await fetch(`${api}/artifacts?user=${encodeURIComponent(user)}`)).json(), { api, user }) as { recipes?: Array<{ last_good?: { payload?: unknown } }> }
  expect(persisted.recipes?.[0]?.last_good?.payload).toEqual({ value: 6 })
  unlinkSync(source)
  const failedRefresh = page.waitForResponse(response => response.url().includes('/artifacts/') && response.url().includes('/refresh'))
  await page.getByRole('button', { name: 'refresh' }).click()
  const failedBody = await (await failedRefresh).json() as { recipe?: { freshness?: string; last_good?: { payload?: unknown } } }
  expect(failedBody.recipe?.last_good?.payload).toEqual({ value: 6 })
  await expect(page.getByRole('status')).toContainText('stale')
  await page.screenshot({ path: 'test-results/r10-canvas-runtime-stale.png', fullPage: true })
})
