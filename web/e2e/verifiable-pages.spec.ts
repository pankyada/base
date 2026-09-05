import { expect, test } from '@playwright/test'

test('replay and evaluation surfaces render server summaries', async ({ page }) => {
  const api = process.env.NEXT_PUBLIC_HARNESS_HTTP_URL ?? 'http://127.0.0.1:7444'
  await page.route(`${api}/replay*`, route => route.fulfill({ json: { journals: [{ id: 'run-1', mode: 'fixture', events: 3, effects: 1, unknown_effects: 0 }] } }))
  await page.route(`${api}/evaluations*`, route => route.fulfill({ json: { runs: [{ run_id: 'eval-1', accuracy: 1, cost_usd: 0, mean_latency_ms: 3, completed_count: 1, sample_count: 1, status: 'completed' }], datasets: [], experiments: [] } }))
  await page.goto('/replay')
  await expect(page.getByText('run-1')).toBeVisible()
  await page.goto('/evaluation')
  await expect(page.getByText('eval-1')).toBeVisible()
  await expect(page.getByText('100%')).toBeVisible()
})
