import { expect, test, type Page, type Route } from '@playwright/test'

const USER = 'web-user'
const profile = 'coding'
const stamp = '2026-09-24T08:00:00.000Z'
type TownResponse = Record<string, unknown> | { status: number; body: unknown }

function project(id: string, name: string, size: number | undefined = 80, scannedAt = stamp) {
  return {
    id,
    path: `/fixture/${id}`,
    display: { name, description: `Isolated acceptance fixture for ${name}` },
    size: size === undefined ? { source: 'git_tracked_regular_files', status: 'unknown', measured_at: stamp, max_entries: 5000 } : { source: 'git_tracked_regular_files', status: 'complete', tracked_regular_files: size, measured_at: stamp, max_entries: 5000 },
    git: { status: 'known', head: '0123456789abcdef', dirty: id === 'running', last_commit_at: stamp },
    scanned_at: scannedAt,
  }
}

function task(id: string, projectId: string, state: string, extra: Record<string, unknown> = {}) {
  return { id, project_id: projectId, title: `${id} title`, prompt: `${id} prompt`, state, revision: 1, depends_on: [], workspace_mode: 'shared', created_at: stamp, updated_at: stamp, ...extra }
}

function snapshot(user: string, suffix = '') {
  const ids = (id: string) => `${id}${suffix}`
  const taskRows = [
    task(ids('run-task'), ids('running'), 'running', { agent_id: ids('worker'), session_id: 'session-match', run_id: 'run-match' }),
    task(ids('queue-task'), ids('queued'), 'queued_quota', { block_reason: 'Provider capacity unavailable' }),
    task(ids('ready-task'), ids('queued'), 'ready'),
    task(ids('dispatching-task'), ids('queued'), 'dispatching'),
    task(ids('dependency-task'), ids('queued'), 'queued_dependency', { block_reason: 'Waiting for its prerequisite' }),
    task(ids('workspace-task'), ids('queued'), 'queued_workspace', { block_reason: 'Workspace lease is occupied' }),
    task(ids('concurrency-task'), ids('queued'), 'queued_concurrency', { block_reason: 'Worker slot is occupied' }),
    task(ids('question-task'), ids('question'), 'waiting_user', { agent_id: ids('question-worker'), session_id: 'question-session', run_id: 'question-run' }),
    task(ids('blocked-task'), ids('blocked'), 'blocked', { block_reason: 'Waiting for an explicit safe directory', updated_at: '2026-09-24T08:12:00.000Z' }),
    task(ids('terminal-task'), ids('history'), 'completed', { terminal_evidence: 'Task closed by fixture' }),
    task(ids('failed-task'), ids('history'), 'failed', { terminal_evidence: 'Fixture failure is historical' }),
    task(ids('interrupted-task'), ids('history'), 'interrupted', { terminal_evidence: 'Fixture interruption is historical' }),
    task(ids('cancelled-task'), ids('history'), 'cancelled', { terminal_evidence: 'Fixture cancellation is historical' }),
    task(ids('unlinked-task'), ids('unlinked'), 'running', { agent_id: ids('unlinked-worker'), session_id: 'task-session', run_id: 'task-run' }),
  ]
  return {
    cursor: 14,
    generated_at: stamp,
    settings: { revision: 1, discovery_root: '/fixture', saved_viewpoints: [], pinned_project_ids: [ids('running')] },
    discovery: { status: 'partial', root: '/fixture', scanned_at: stamp, project_count: 6, skipped_count: 2, error_count: 1, warnings: ['entry limit reached'] },
    projects: [
      project(ids('running'), 'Running repo', 130),
      project(ids('queued'), 'Queued repo', 80),
      project(ids('question'), 'Question repo'),
      project(ids('blocked'), 'Blocked repo', 1200),
      project(ids('history'), 'History repo', undefined, '2026-09-13T08:00:00.000Z'),
      project(ids('unlinked'), 'Unlinked repo', 800),
    ],
    agents: [
      { id: ids('worker'), display_name: 'Asha', state: 'working', profile, home_project_id: ids('running'), task_id: ids('run-task'), session_id: 'session-match', run_id: 'run-match' },
      { id: ids('question-worker'), display_name: 'Kavi', state: 'waiting_user', profile, home_project_id: ids('question'), task_id: ids('question-task'), session_id: 'question-session', run_id: 'question-run' },
      { id: ids('unlinked-worker'), display_name: 'Malli', state: 'working', profile, home_project_id: ids('unlinked'), task_id: ids('unlinked-task'), session_id: 'other-session', run_id: 'other-run' },
    ],
    tasks: taskRows,
    messages: [{ id: ids('question-message'), revision: 1, project_id: ids('question'), task_id: ids('question-task'), from: ids('question-worker'), to: user, kind: 'question', body: 'Which fixture folder is in scope?', state: 'delivered', continuation_id: ids('continuation'), created_at: stamp }],
    quota: { provider: 'fixture', account_scope: 'isolated', status: 'unsupported', fetched_at: stamp, windows: [], source: 'isolated browser fixture' },
  }
}

async function guardAndMockTown(page: Page, resolveSnapshot: (user: string) => Promise<TownResponse> | TownResponse) {
  const writes: string[] = []
  const requests: string[] = []
  await page.route('**/town/**', async (route: Route) => {
    const request = route.request()
    const url = new URL(request.url())
    const origin = request.headers().origin
    const corsHeaders: Record<string, string> = origin ? { 'access-control-allow-origin': origin, 'access-control-allow-credentials': 'true', vary: 'Origin' } : {}
    if (url.pathname.endsWith('/town/snapshot') && request.method() === 'GET') {
      const user = url.searchParams.get('user') ?? ''
      requests.push(user)
      const result = await resolveSnapshot(user)
      const failed = Object.prototype.hasOwnProperty.call(result, 'status') && Object.prototype.hasOwnProperty.call(result, 'body')
      const status = failed ? (result as { status: number }).status : 200
      const body = failed ? (result as { body: unknown }).body : result
      try { await route.fulfill({ status, headers: corsHeaders, contentType: 'application/json', body: JSON.stringify(body) }) } catch { /* Scope changes intentionally abort stale requests. */ }
      return
    }
    if (url.pathname.endsWith('/town/events') && request.method() === 'GET') {
      await route.fulfill({ status: 200, headers: { ...corsHeaders, 'content-type': 'text/event-stream', 'cache-control': 'no-cache' }, body: ': fixture connected\n\n' })
      return
    }
    if (request.method() !== 'GET') {
      writes.push(`${request.method()} ${url.pathname}`)
      await route.fulfill({ status: 403, headers: corsHeaders, contentType: 'application/json', body: JSON.stringify({ error: 'Blocked by PT-104 read-only acceptance fixture' }) })
      return
    }
    await route.continue()
  })
  return { writes, requests }
}

async function openProject(page: Page, name: string) {
  const projects = page.getByRole('button', { name: 'Projects' })
  await projects.click()
  const panel = page.getByRole('region', { name: 'Projects controls' })
  await panel.getByRole('button', { name: new RegExp(name) }).click()
  return page.getByTestId('town-selection-card')
}

test('PT-104: current work, questions, blockers and terminal history stay in truthful card sections', async ({ page }) => {
  test.setTimeout(90_000)
  const { writes } = await guardAndMockTown(page, user => snapshot(user))
  const pageErrors: string[] = []
  page.on('pageerror', error => pageErrors.push(error.message))
  await page.goto('/town')
  await expect(page.getByTestId('orchestrator-town')).toBeVisible()

  const running = await openProject(page, 'Running repo')
  await expect(running.getByTestId('town-work-now')).toBeVisible()
  await expect(running.getByTestId('town-repository-snapshot')).toBeVisible()
  await expect(running.getByTestId('town-history')).toBeVisible()
  await expect(running.locator('.town-card-header small')).toHaveText('1 work now · 0 past work orders')
  await expect(running.getByTestId('town-work-now')).toContainText('run-task title')
  await expect(running.getByTestId('town-repository-snapshot')).toContainText(/As surveyed/i)
  await expect(running.getByTestId('town-repository-snapshot')).toContainText(/01234567/)
  await expect(running.getByTestId('town-repository-snapshot')).toContainText(/dirty/i)
  await expect(running.getByTestId('town-repository-snapshot')).toContainText(/tracked regular files/i)
  await expect(page.getByTestId('town-survey-status')).toContainText(/partial survey/i)
  await expect(page.getByTestId('town-survey-status')).toContainText(/2 skipped · 1 errors · entry limit reached/i)

  const queued = await openProject(page, 'Queued repo')
  await expect(queued.getByTestId('town-work-now')).toContainText('Provider capacity unavailable')
  for (const state of ['queued quota', 'ready', 'dispatching', 'queued dependency', 'queued workspace', 'queued concurrency']) {
    await expect(queued.getByTestId('town-work-now')).toContainText(state)
  }
  await expect(queued.getByTestId('town-work-now')).not.toContainText(/is working on task/i)

  const question = await openProject(page, 'Question repo')
  await expect(question).toContainText('Which fixture folder is in scope?')
  await expect(question).toContainText(/waiting for you|question|waiting_user/i)

  const blocked = await openProject(page, 'Blocked repo')
  await expect(blocked.getByTestId('town-work-now')).toContainText('Waiting for an explicit safe directory')
  await expect(page.locator('.town-communication-marker[data-project-id="blocked"][data-marker-kind="attention"]')).toHaveCount(1)

  const history = await openProject(page, 'History repo')
  await expect(history.getByTestId('town-repository-snapshot').locator('time')).toHaveAttribute('datetime', '2026-09-13T08:00:00.000Z')
  await expect(page.locator('.town-communication-marker[data-project-id="history"][data-marker-kind="attention"]')).toHaveCount(0)
  for (const id of ['terminal-task', 'failed-task', 'interrupted-task', 'cancelled-task']) {
    await expect(history.getByTestId('town-history')).toContainText(`${id} title`)
    await expect(history.getByTestId('town-work-now')).not.toContainText(`${id} title`)
  }

  const unlinked = await openProject(page, 'Unlinked repo')
  await expect(unlinked.getByTestId('town-work-now')).toContainText(/unknown activity/i)
  await expect(unlinked).not.toContainText(/working now|work loop/i)
  expect(writes).toEqual([])
  expect(pageErrors).toEqual([])
})

test('PT-104: delayed old-scope success cannot replace the newly selected scope', async ({ page }) => {
  let releaseOld!: (value: TownResponse) => void
  let oldRequested!: () => void
  const oldStarted = new Promise<void>(resolve => { oldRequested = resolve })
  const heldOld = new Promise<TownResponse>(resolve => { releaseOld = resolve })
  const { writes, requests } = await guardAndMockTown(page, user => {
    if (user === USER) { oldRequested(); return heldOld }
    return snapshot(user, '-new')
  })
  await page.goto('/town')
  await oldStarted
  await page.goto('/')
  await page.keyboard.press('Meta+,')
  const identityInput = page.getByText('Session identity (scope only)').locator('..').locator('input')
  await expect(identityInput).toHaveValue(USER)
  await identityInput.fill('pt104-new-scope')
  await page.goto('/town')
  const projects = page.getByRole('button', { name: 'Projects' })
  await projects.click()
  const projectPanel = page.getByRole('region', { name: 'Projects controls' })
  const newScopeOffice = projectPanel.getByRole('button').filter({ hasText: '/fixture/running-new' })
  const oldScopeOffice = projectPanel.getByRole('button').filter({ hasText: /\/fixture\/running(?:\s|$)/ })
  await expect(newScopeOffice).toBeVisible()
  await expect(oldScopeOffice).toHaveCount(0)
  releaseOld(snapshot(USER))
  await page.waitForTimeout(100)
  await expect(newScopeOffice).toBeVisible()
  await expect(oldScopeOffice).toHaveCount(0)
  expect(requests).toContain(USER)
  expect(requests).toContain('pt104-new-scope')
  expect(writes).toEqual([])
})

test('PT-104: delayed old-scope failure cannot clear the newly selected scope', async ({ page }) => {
  let releaseOld!: (value: TownResponse) => void
  let oldRequested!: () => void
  const oldStarted = new Promise<void>(resolve => { oldRequested = resolve })
  const heldOld = new Promise<TownResponse>(resolve => { releaseOld = resolve })
  const { writes } = await guardAndMockTown(page, user => {
    if (user === USER) { oldRequested(); return heldOld }
    return snapshot(user, '-new')
  })
  await page.goto('/town')
  await oldStarted
  await page.goto('/')
  await page.keyboard.press('Meta+,')
  const identityInput = page.getByText('Session identity (scope only)').locator('..').locator('input')
  await expect(identityInput).toHaveValue(USER)
  await identityInput.fill('pt104-new-scope')
  await page.goto('/town')
  const projects = page.getByRole('button', { name: 'Projects' })
  await projects.click()
  const projectPanel = page.getByRole('region', { name: 'Projects controls' })
  const newScopeOffice = projectPanel.getByRole('button').filter({ hasText: '/fixture/running-new' })
  await expect(newScopeOffice).toBeVisible()
  releaseOld({ status: 503, body: { error: 'late fixture failure' } })
  await page.waitForTimeout(100)
  await expect(newScopeOffice).toBeVisible()
  await expect(projectPanel).not.toContainText('Town data unavailable')
  expect(writes).toEqual([])
})

test('PT-104: narrow layout, lighting controls and reduced-motion preference remain usable', async ({ page }) => {
  const { writes } = await guardAndMockTown(page, user => snapshot(user))
  await page.setViewportSize({ width: 390, height: 844 })
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto('/town')
  await expect(page.getByTestId('orchestrator-town')).toBeVisible()

  const view = page.getByRole('button', { name: 'View' })
  await view.click()
  const panel = page.getByRole('region', { name: 'View controls' })
  await panel.getByRole('button', { name: 'Night' }).click()
  await expect(page.getByTestId('orchestrator-town')).toHaveAttribute('data-town-mode', 'night')
  await panel.getByRole('button', { name: 'Day' }).click()
  await expect(page.getByTestId('orchestrator-town')).toHaveAttribute('data-town-mode', 'day')

  const card = await openProject(page, 'Running repo')
  await expect(card).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(card).toHaveCount(0)
  await page.getByRole('button', { name: 'View', exact: true }).click()
  await page.getByRole('button', { name: 'Projects' }).click()
  await expect(page.getByTestId('orchestrator-town')).toHaveAttribute('data-reduced-motion', 'true')
  expect(writes).toEqual([])
})

test('PT-107: topic islands render with electronic billboards and offices', async ({ page }) => {
  test.setTimeout(90_000)
  await guardAndMockTown(page, user => ({
    ...snapshot(user),
    projects: [
      project('home-assistant', 'Smart home'),
      project('chatur-platform', 'Personal assistant'),
      project('base-harness', 'Harness engineering'),
      project('ontology-graph', 'Ontology and data analysis'),
      project('misc-repo', 'Miscellaneous'),
    ],
    agents: [{ id: 'signal-agent', display_name: 'Asha', state: 'idle', profile, home_project_id: 'chatur-platform' }],
    tasks: [task('signal-work', 'chatur-platform', 'queued_quota', { title: 'Speech bridge review' })],
    messages: [],
  }))
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/town')
  await page.getByRole('button', { name: 'View', exact: true }).click()
  await page.getByRole('switch', { name: 'Map labels' }).check()
  await expect(page.getByRole('application', { name: /Interactive 3D map/ })).toHaveAttribute('data-billboard-count', '5')
  await expect(page.locator('.town-map-label')).toHaveCount(5)
  await page.getByRole('button', { name: 'View', exact: true }).click()
  await page.screenshot({ path: '/tmp/base-town-pt107-billboards.png' })
  await expect(page.getByRole('application', { name: /Interactive 3D map/ })).toHaveAttribute('data-billboard-slide', 'agents', { timeout: 20_000 })
  await page.screenshot({ path: '/tmp/base-town-pt107-agents.png' })
  await expect(page.getByRole('application', { name: /Interactive 3D map/ })).toHaveAttribute('data-billboard-slide', 'work', { timeout: 20_000 })
  await page.screenshot({ path: '/tmp/base-town-pt107-work.png' })
  await openProject(page, 'Personal assistant')
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: 'Projects', exact: true }).click()
  await page.screenshot({ path: '/tmp/base-town-pt107-closeup.png' })
  await page.getByRole('button', { name: 'View', exact: true }).click()
  await page.getByRole('region', { name: 'View controls' }).getByRole('button', { name: 'Night' }).click()
  await page.getByRole('button', { name: 'View', exact: true }).click()
  await page.screenshot({ path: '/tmp/base-town-pt107-night.png' })
})

test('PT-104: failed transport reports Town data unavailable without retaining old state', async ({ page }) => {
  await guardAndMockTown(page, () => ({ status: 503, body: { error: 'fixture offline' } }))
  await page.goto('/town')
  await expect(page.getByText('Town data unavailable')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Projects' })).toBeVisible()
  await page.getByRole('button', { name: 'Projects' }).click()
  await expect(page.getByRole('region', { name: 'Projects controls' })).toContainText(/unavailable/i)
  await expect(page.getByRole('region', { name: 'Projects controls' }).locator('.town-directory-list button')).toHaveCount(0)
})
