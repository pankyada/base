import { expect, test } from '@playwright/test'

const initial = {
  id: 'recipe-fixture-1',
  version: 1,
  user: 'browser-fixture',
  profile: 'coding@fixture',
  generating_tool: 'fixture.generate',
  code_ref: 'fixture.ts#render',
  parameters: { kind: 'heatmap', title: 'Fixture heatmap' },
  provenance: { session_id: 'session-browser', tool_call_id: 'tool-browser', source: 'fixture' },
  freshness: 'current',
  last_good: { version: 1, source_cursor: 'cursor-1', payload: { columns: ['Jan', 'Feb'], rows: [{ label: 'before', values: [1, null] }] } },
}

test('Canvas pins real lineage, refreshes once, persists on reload, and keeps last-good on failure', async ({ page }) => {
  let refreshes = 0
  await page.route('**/artifacts*', route => route.request().method() === 'GET' ? route.fulfill({ json: { recipes: [initial] } }) : route.continue())
  await page.route('**/artifacts/recipe-fixture-1/refresh*', route => {
    refreshes++
    if (refreshes === 1) return route.fulfill({ json: { recipe: { ...initial, freshness: 'current', last_good: { version: 2, source_cursor: 'cursor-2', payload: { columns: ['Jan', 'Feb'], rows: [{ label: 'after', values: [2, 3] }] } } } } })
    return route.fulfill({ status: 500, json: { error: 'source deleted' } })
  })

  await page.goto('/canvas')
  await expect(page.getByText('Fixture heatmap', { exact: true }).first()).toBeVisible()
  await expect(page.getByText('session session-browser · tool call tool-browser · code fixture.ts#render')).toBeVisible()
  await page.getByRole('button', { name: 'pin Fixture heatmap' }).click()
  await expect(page.getByRole('button', { name: 'refresh' })).toBeVisible()
  await page.getByRole('button', { name: 'refresh' }).click()
  await expect(page.getByText('after', { exact: true }).first()).toBeVisible()

  await page.reload()
  await expect(page.getByText('after', { exact: true }).first()).toBeVisible()
  await page.getByRole('button', { name: 'refresh' }).click()
  await expect(page.getByText(/stale/)).toBeVisible()
  await expect(page.getByText('after', { exact: true }).first()).toBeVisible()
  expect(refreshes).toBe(2)
  await page.screenshot({ path: 'test-results/r10-canvas-stale-retention.png', fullPage: true })
})
