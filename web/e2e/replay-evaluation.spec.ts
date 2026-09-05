import { expect, test } from '@playwright/test'

test('replay browser controls render discovered journals and invoke playback/branch endpoints', async ({ page }) => {
  let playback = 0; let branch = 0
  await page.route('**/replay', route => route.request().resourceType() === 'document' ? route.continue() : route.fulfill({ status: 200, headers: { 'access-control-allow-origin': '*' }, contentType: 'application/json', body: JSON.stringify({ journals: [{ id: 'run-1', mode: 'fixture', events: 2, effects: 1, unknown_effects: 0 }] }) }))
  await page.route('**/replay/run-1/playback', route => { playback++; return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ mode: 'playback', events: 2, events_payload: [] }) }) })
  await page.route('**/replay/run-1/branch*', route => { branch++; return route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ journal: { mode: 'live-branch', parent_run_id: 'run-1' } }) }) })
  await page.goto('/replay'); await expect(page.getByText('run-1')).toBeVisible(); await expect(page.getByRole('button', { name: /Playback/ }).first()).toBeVisible(); await page.getByRole('button', { name: /Playback/ }).first().click(); await page.getByRole('button', { name: 'Branch at turn start' }).click(); await page.screenshot({ path: 'test-results/r5-replay-controls.png', fullPage: true }); expect(playback).toBe(1); expect(branch).toBe(1)
})

test('evaluation browser controls run and cancel against fixture API responses', async ({ page }) => {
  let calls = 0
  await page.route('**/evaluations', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ datasets: [], runs: [] }) }))
  await page.route('**/evaluations/run', async route => { calls++; const request = route.request(); const body = request.postDataJSON() as { cancel?: boolean }; return route.fulfill({ status: body.cancel ? 409 : 200, contentType: 'application/json', body: JSON.stringify({ run: { status: body.cancel ? 'cancelled' : 'completed' }, summary: { run_id: `run-${calls}`, accuracy: body.cancel ? null : 1, cost_usd: 0, mean_latency_ms: 1, completed_count: body.cancel ? 0 : 1, sample_count: 1, status: body.cancel ? 'cancelled' : 'completed' } }) }) })
  await page.goto('/evaluation'); await page.getByLabel('Dataset id').fill('dataset-1'); await page.getByRole('button', { name: 'Run fixture' }).click(); await expect(page.getByText('completed').first()).toBeVisible(); await page.getByRole('button', { name: 'Cancel' }).click(); await expect(page.getByText('cancelled').first()).toBeVisible(); await page.screenshot({ path: 'test-results/r6-evaluation-controls.png', fullPage: true }); expect(calls).toBe(2)
})
