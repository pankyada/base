import { expect, test } from '@playwright/test'

test('executes every permanent surface escape payload and blocks it', async ({ page }) => {
  await page.goto('/surface-escape')
  await expect(page.locator('#corpus-status')).toHaveText('6/6 tested', { timeout: 15_000 })
  const results = page.locator('output[data-testid^="result-"]')
  await expect(results).toHaveCount(6)
  await expect(results).toHaveText(['blocked', 'blocked', 'blocked', 'blocked', 'blocked', 'blocked'])
})
