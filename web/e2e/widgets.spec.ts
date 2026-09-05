import { expect, test } from '@playwright/test'

test('R1 fixture page renders actual heatmap, box plot, and correlation SVGs', async ({ page }) => {
  await page.goto('/widgets')
  await expect(page.getByRole('img', { name: 'Heatmap chart' })).toBeVisible()
  await expect(page.getByRole('img', { name: 'Box plot chart' })).toBeVisible()
  await expect(page.getByRole('img', { name: 'Correlation matrix chart' })).toBeVisible()
  await expect(page.getByText('alpha', { exact: true })).toBeVisible()
  await expect(page.getByText('Latency', { exact: true })).toBeVisible()
  await expect(page.getByText('quality', { exact: true }).first()).toBeVisible()
  await page.screenshot({ path: 'test-results/r1-visual-widgets.png', fullPage: true })
})
