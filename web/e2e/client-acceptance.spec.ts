import { test, expect } from '@playwright/test'
import { readFileSync } from 'node:fs'

const http = 'http://127.0.0.1:18832'

async function installSocketProbe(page: import('@playwright/test').Page) {
  await page.addInitScript(() => {
    const Native = window.WebSocket
    const stats = { created: 0, opened: 0, closed: 0, active: 0 }
    class TrackedSocket extends Native {
      constructor(url: string | URL, protocols?: string | string[]) {
        super(url, protocols as any)
        stats.created++
        ;(stats as any).last = this
        this.addEventListener('open', () => { stats.opened++; stats.active++ })
        this.addEventListener('message', event => { const m = JSON.parse(event.data); if (m.type === 'session_ready' || m.type === 'session_resumed') (stats as any).ready = m })
        this.addEventListener('close', () => { stats.closed++; stats.active = Math.max(0, stats.active - 1) })
      }
    }
    window.WebSocket = TrackedSocket as typeof WebSocket
    ;(window as any).__caSocketStats = stats
  })
}

async function openAnalyst(page: import('@playwright/test').Page) {
  await page.goto('/')
  await expect(page.getByPlaceholder('Message harness...')).toBeVisible()
}

async function setScope(page: import('@playwright/test').Page, user: string, profile?: string) {
  await page.keyboard.press('Meta+,')
  const identity = page.getByText('Session identity (scope only)', { exact: true }).locator('..').locator('input')
  await identity.fill(user)
  await expect.poll(() => page.evaluate(() => localStorage.getItem('harness-user-id'))).toBe(user)
  await page.keyboard.press('Escape')
  await expect(page.getByText(/session #/)).toBeVisible()
  if (profile) {
    const picker = page.locator('select[aria-label="profile"]')
    if (await picker.count()) await picker.selectOption(profile)
  }
  await expect(page.getByText('ready')).toBeVisible({ timeout: 15_000 })
}

test.describe('PT-041 client acceptance fixture', () => {
  test('CA-03: two user/profile scopes expose isolated memory, audit, usage and transcript reads', async ({ page, request }) => {
    await installSocketProbe(page)
    await openAnalyst(page)
    const memoryA = await request.get(`${http}/memory?user=ca-user-a&profile=fixture-p&scope=user`)
    const memoryB = await request.get(`${http}/memory?user=ca-user-b&profile=fixture-q&scope=user`)
    const auditA = await request.get(`${http}/audit?user=ca-user-a&profile=fixture-p`)
    const auditB = await request.get(`${http}/audit?user=ca-user-b&profile=fixture-q`)
    const usageA = await request.get(`${http}/usage?user=ca-user-a`)
    const usageB = await request.get(`${http}/usage?user=ca-user-b`)
    const bodyA = await memoryA.json(); const bodyB = await memoryB.json()
    expect(bodyA.entries.map((entry: any) => entry.content).join('\n')).toContain('CA_MEMORY_A')
    expect(bodyB.entries.map((entry: any) => entry.content).join('\n')).toContain('CA_MEMORY_B')
    expect(JSON.stringify(await auditA.json())).toContain('Bash')
    expect(JSON.stringify(await auditB.json())).toContain('Bash')
    expect((await usageA.json()).total.input).toBeGreaterThan(0)
    expect((await usageB.json()).total.input).toBeGreaterThan(0)
    const fixture = JSON.parse(readFileSync(process.env.CLIENT_ACCEPTANCE_FIXTURE!, 'utf8'))
    const transcriptA = await request.get(`${http}/sessions/${fixture.sessions.a}/messages?user=ca-user-a&profile=fixture-p`)
    const transcriptB = await request.get(`${http}/sessions/${fixture.sessions.b}/messages?user=ca-user-b&profile=fixture-q`)
    const transcriptBodyA = JSON.stringify(await transcriptA.json())
    const transcriptBodyB = JSON.stringify(await transcriptB.json())
    expect(transcriptBodyA).toContain('CA_SCOPE_A')
    expect(transcriptBodyA).not.toContain('CA_SCOPE_B')
    expect(transcriptBodyB).toContain('CA_SCOPE_B')
    expect(transcriptBodyB).not.toContain('CA_SCOPE_A')
    await setScope(page, 'ca-user-a', 'fixture-p')
    const composer = page.getByPlaceholder('Message harness...')
    await composer.fill('CA_SCOPE_A browser transcript')
    await composer.press('Enter')
    await expect(page.getByText('fixture A complete')).toBeVisible({ timeout: 15_000 })
    await setScope(page, 'ca-user-b', 'fixture-q')
    await expect(page.getByText('CA_SCOPE_A browser transcript')).not.toBeVisible()
    await composer.fill('CA_SCOPE_B browser transcript')
    await composer.press('Enter')
    await expect(page.getByText('fixture B complete')).toBeVisible({ timeout: 15_000 })
    await expect(page.getByText('CA_SCOPE_A browser transcript')).not.toBeVisible()
    for (const [user, profile, own, other] of [
      ['ca-user-a', 'fixture-p', 'A', 'B'],
      ['ca-user-b', 'fixture-q', 'B', 'A'],
      ['ca-user-a', 'fixture-p', 'A', 'B'],
    ]) {
      await setScope(page, user, profile)
      await page.goto('/home')
      await expect.poll(() => page.evaluate(() => Boolean((window as any).__caSocketStats.ready))).toBe(true)
      await page.evaluate(p => (window as any).__caSocketStats.last.send(JSON.stringify({ type: 'set_profile', profile: p })), profile)
      await expect(page.getByText(`CA_MEMORY_${own} private memory`, { exact: true })).toBeVisible()
      await expect(page.getByText(`CA_MEMORY_${other} private memory`, { exact: true })).not.toBeVisible()
      const auditResponse = page.waitForResponse(response => new URL(response.url()).pathname === '/audit' && new URL(response.url()).searchParams.get('user') === user && new URL(response.url()).searchParams.get('profile') === profile)
      const usageResponse = page.waitForResponse(response => new URL(response.url()).pathname === '/usage' && new URL(response.url()).searchParams.get('user') === user)
      await page.getByRole('link', { name: 'ops', exact: true }).click()
      const audit = await (await auditResponse).json()
      expect(audit.entries.length).toBeGreaterThan(0)
      await expect(page.locator('.audit-table tbody')).toContainText(audit.entries[0].ts)
      const usage = await (await usageResponse).json()
      expect(usage.total.input).toBeGreaterThan(0)
      await page.getByRole('tab', { name: 'Telemetry' }).click()
      await page.locator('.observability summary').click()
      await expect(page.locator('.observability pre')).toContainText('"usage"')
      await page.getByRole('link', { name: 'analyst', exact: true }).click()
    }
  })

  test('CA-04: delayed transcript response cannot repopulate superseded identity', async ({ page }) => {
    await openAnalyst(page)
    let held: import('@playwright/test').Route | undefined
    await page.route('**/sessions/**/messages?*', async route => {
      if (new URL(route.request().url()).searchParams.get('user') === 'ca-user-a' && !held) { held = route; return }
      await route.continue()
    })
    await setScope(page, 'ca-user-a', 'fixture-p')
    await setScope(page, 'ca-user-b', 'fixture-q')
    expect(held).toBeDefined()
    await held!.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ messages: [{ role: 'user', content: 'CA_STALE_A' }] }) })
    await page.waitForTimeout(250)
    await expect(page.getByText('CA_STALE_A')).not.toBeVisible()
  })

  test('CA-05: browser reconnect and identity switch keep one live socket with zero orphan', async ({ page }) => {
    const live = new Set<import('@playwright/test').WebSocket>()
    let created = 0
    page.on('websocket', socket => {
      if (!socket.url().includes(':18832')) return
      created++
      live.add(socket)
      socket.on('close', () => live.delete(socket))
    })
    await installSocketProbe(page)
    await page.goto('/ops')
    await expect(page.getByRole('tab', { name: 'Audit' })).toBeVisible()
    await expect.poll(() => live.size).toBe(1)
    const beforeNavigation = created
    await page.getByRole('link', { name: 'assistant', exact: true }).click()
    await expect(page.locator('.memory-timeline')).toBeVisible()
    await page.getByRole('link', { name: 'ops', exact: true }).click()
    await page.getByRole('link', { name: 'analyst', exact: true }).click()
    await expect(page.getByPlaceholder('Message harness...')).toBeVisible()
    expect(created).toBe(beforeNavigation)
    await page.evaluate(() => (window as any).__caSocketStats.last.close())
    await expect(page.getByText(/Disconnected/)).toBeVisible({ timeout: 5_000 })
    await page.getByRole('button', { name: 'Reconnect', exact: true }).click()
    await expect(page.getByText('ready')).toBeVisible({ timeout: 15_000 })
    for (const user of ['ca-user-b', 'ca-user-a', 'ca-user-b']) {
      await setScope(page, user)
      await expect.poll(() => live.size).toBe(1)
    }
    expect(created).toBeGreaterThanOrEqual(4)
    const fixture = JSON.parse(readFileSync(process.env.CLIENT_ACCEPTANCE_FIXTURE!, 'utf8'))
    const serverConnections = () => JSON.parse(readFileSync(fixture.socketCount, 'utf8')).active
    await expect.poll(serverConnections).toBe(1)
    await page.close()
    await expect.poll(serverConnections).toBe(0)
  })

  test('CA-09: partial endpoint failure preserves healthy panels and exposes retry plus loading', async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('harness-user-id', 'ca-user-a'))
    let failUsage = true
    await page.route('**/usage?*', route => failUsage ? route.abort('failed') : route.continue())
    await page.goto('/ops')
    await expect(page.locator('.unavailable-state')).toContainText('usage:', { timeout: 15_000 })
    await expect(page.getByRole('tab', { name: 'Audit' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Runs' })).toBeVisible()
    failUsage = false
    await page.getByRole('button', { name: 'Retry' }).click()
    await expect(page.locator('.unavailable-state')).toHaveCount(0, { timeout: 15_000 })
  })

  test('CA-10: memory read failure reports reason and retry restores scoped content', async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('harness-user-id', 'ca-user-a'))
    let failures = 2
    await page.route('**/memory**', async route => { if (new URL(route.request().url()).pathname === '/memory' && failures > 0) { failures--; await route.abort('failed'); return }; await route.continue() })
    await page.goto('/home')
    await expect(page.locator('.unavailable-state')).toContainText('memory:', { timeout: 15_000 })
    await page.getByRole('button', { name: 'Retry' }).click()
    await expect(page.getByText('CA_MEMORY_A private memory', { exact: true })).toBeVisible({ timeout: 15_000 })
  })

  test('CA-10 analyst history: transcript fault is visible with Retry and stale session response is discarded', async ({ page }) => {
    await installSocketProbe(page)
    await page.addInitScript(() => localStorage.setItem('harness-user-id', 'ca-user-a'))
    let failHistory = true
    await page.route('**/sessions/**/messages**', async route => {
      if (failHistory) { await route.abort('failed'); return }
      await route.continue()
    })
    await openAnalyst(page)
    const transcriptAlert = page.locator('div[role="alert"]').filter({ hasText: 'Transcript unavailable' })
    await expect(transcriptAlert).toBeVisible({ timeout: 15_000 })
    const fixture = JSON.parse(readFileSync(process.env.CLIENT_ACCEPTANCE_FIXTURE!, 'utf8'))
    await page.evaluate(id => (window as any).__caSocketStats.last.send(JSON.stringify({ type: 'resume', sessionId: id })), fixture.sessions.a)
    await expect(page.getByText(/session #/)).toContainText(fixture.sessions.a.slice(0, 4))
    failHistory = false
    await page.getByRole('button', { name: 'Retry' }).click()
    await expect(transcriptAlert).toHaveCount(0, { timeout: 15_000 })
  })

  test('CA-02 browser write refusal keeps composer text and reports exact transport reason', async ({ page }) => {
    await installSocketProbe(page)
    await openAnalyst(page)
    await page.evaluate(() => (window as any).__caSocketStats.last.close())
    await expect(page.getByText(/Disconnected/)).toBeVisible({ timeout: 5_000 })
    const composer = page.getByPlaceholder('Message harness...')
    await composer.fill('CA02 retained control text')
    await composer.press('Enter')
    await expect(page.locator('.composer-send-error')).toContainText('not connected', { timeout: 5_000 })
    await expect(composer).toHaveValue('CA02 retained control text')
  })

  test('CA-06 browser reconnect resumes live session state after transport loss', async ({ page }) => {
    await installSocketProbe(page)
    await openAnalyst(page)
    const picker = page.locator('select[aria-label="profile"]')
    await expect(picker).toBeVisible({ timeout: 15_000 })
    await picker.selectOption('fixture-q')
    await expect(picker).toHaveValue('fixture-q')
    const composer = page.getByPlaceholder('Message harness...')
    await composer.fill('CA06 cross-profile resume marker')
    await composer.press('Enter')
    await expect(page.getByText('fixture complete')).toBeVisible({ timeout: 15_000 })
    const before = await page.getByText(/session #/).innerText()
    await page.evaluate(() => (window as any).__caSocketStats.last.close())
    await expect(page.getByText(/Disconnected/)).toBeVisible({ timeout: 5_000 })
    await expect(page.getByText('ready')).toBeVisible({ timeout: 15_000 })
    await expect(page.getByText('CA06 cross-profile resume marker')).toBeVisible()
    await expect(page.getByText(/session #/)).toHaveText(before)
    await expect(picker).toHaveValue('fixture-q')
  })

  test('CA-06 selected Q session adopts authoritative profile; missing resume stays truthful', async ({ page }) => {
    await installSocketProbe(page)
    await page.addInitScript(() => localStorage.setItem('harness-user-id', 'ca-user-b'))
    await openAnalyst(page)
    const picker = page.locator('select[aria-label="profile"]')
    await expect(picker).toHaveValue('fixture-p')
    const fixture = JSON.parse(readFileSync(process.env.CLIENT_ACCEPTANCE_FIXTURE!, 'utf8'))
    await page.evaluate(id => (window as any).__caSocketStats.last.send(JSON.stringify({ type: 'resume', sessionId: id })), fixture.sessions.b)
    await expect(picker).toHaveValue('fixture-q')
    await expect(page.getByText('CA_SCOPE_B transcript marker', { exact: true })).toBeVisible()
    const selected = await page.getByText(/session #/).innerText()
    await page.evaluate(() => (window as any).__caSocketStats.last.send(JSON.stringify({ type: 'resume', sessionId: 'missing-acceptance-session' })))
    await expect(page.getByText(/Session missing-acceptance-session not found/)).toBeVisible()
    await expect(page.getByText(/session #/)).toHaveText(selected)
    await expect(picker).toHaveValue('fixture-q')
  })

  test('CA-10 DatasetDrawer list fault exposes retry after workspace surface mounts', async ({ page }) => {
    let failures = 1
    await page.route('**/datasets**', async route => {
      if (new URL(route.request().url()).pathname === '/datasets' && failures > 0) { failures--; await route.abort('failed'); return }
      await route.continue()
    })
    await openAnalyst(page)
    const composer = page.getByPlaceholder('Message harness...')
    await composer.fill('CA_DATASET open workspace')
    await composer.press('Enter')
    await expect(page.getByRole('heading', { name: 'Datasets' })).toBeVisible({ timeout: 15_000 })
    const drawer = page.locator('.dataset-drawer')
    await expect(drawer.locator('.unavailable-state')).toContainText('datasets:', { timeout: 15_000 })
    await drawer.getByRole('button', { name: 'Retry' }).click()
    await expect(drawer.getByText('No datasets.')).toBeVisible({ timeout: 15_000 })
    await drawer.locator('input[type="file"]').setInputFiles({ name: 'acceptance.csv', mimeType: 'text/csv', buffer: Buffer.from('category,amount\nCA_DATASET_ROW,42\n') })
    const dataset = drawer.getByRole('button', { name: /acceptance/ })
    await expect(dataset).toBeVisible()
    let schemaFailure = true
    await page.route('**/datasets/*/schema**', route => schemaFailure ? route.fulfill({ status: 503, body: 'CA schema unavailable' }) : route.continue())
    await dataset.click()
    await expect(drawer.locator('.unavailable-state')).toContainText('503')
    await expect(drawer.getByText('CA_DATASET_ROW')).not.toBeVisible()
    schemaFailure = false
    await drawer.getByRole('button', { name: 'Retry' }).click()
    await expect(drawer.getByText('CA_DATASET_ROW')).toBeVisible()

  })
})
