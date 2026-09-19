import { test, expect, type Page } from '@playwright/test'
import { readFile, mkdir, writeFile, rename } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'

async function openOps(page: Page, user: string) {
  await page.addInitScript(user => {
    localStorage.setItem('harness-user-id', user)
    const Native = window.WebSocket
    ;(window as any).__operator = { count: 0, frames: [], hold: false, queue: [] }
    class Probe extends Native {
      send(data: Parameters<WebSocket['send']>[0]) {
        if (typeof data === 'string') {
          const msg = JSON.parse(data)
          if ((window as any).__operator.failType === msg.type) throw new Error('CA transport refused')
          if ((window as any).__operator.reject && msg.type === 'tool_approve') data = JSON.stringify({ ...msg, id: 'deliberately-stale' })
        }
        super.send(data)
      }
      constructor(url: string | URL, protocols?: string | string[]) {
        super(url, protocols)
        const state = (window as any).__operator
        state.socket = this; state.count++
        this.addEventListener('message', event => {
          const message = JSON.parse(event.data)
          state.frames.push(message)
          if (state.hold && ['notice', 'tool_end', 'session_end', 'runtime'].includes(message.type)) { event.stopImmediatePropagation(); state.queue.push(event.data) }
        })
      }
    }
    window.WebSocket = Probe as typeof WebSocket
  }, user)
  await page.goto('/ops')
  await expect.poll(() => page.evaluate(() => (window as any).__operator.frames.some((frame: any) => frame.type === 'session_ready'))).toBe(true)
  await expect(page.getByText(/Last full snapshot update:/)).toBeVisible()
}
async function send(page: Page, message: unknown) { await page.evaluate(message => (window as any).__operator.socket.send(JSON.stringify(message)), message) }
async function seedAsk(user: string, kind: 'text' | 'select' | 'multi_select', expiresMs = 60_000) {
  const fixture = JSON.parse(await readFile(process.env.CLIENT_ACCEPTANCE_FIXTURE!, 'utf8'))
  if (!fixture.root.includes('harness-client-acceptance-')) throw new Error('unexpected fixture root')
  const id = randomUUID(); const sessionId = randomUUID(); const runId = randomUUID(); const at = new Date().toISOString()
  const record = { id, user, profile: 'fixture-p', session_id: sessionId, run_id: runId, prompt: `Operator ${kind} ${id}`, kind, options: ['red', 'blue,green'], tool_call_id: `ask-${id}`, created_at: at, expires_at: new Date(Date.now()+expiresMs).toISOString(), state: 'open', answered_at: null }
  const session = { id: sessionId, user, profile: 'fixture-p', project: 'inbox', created_at: at, messages: [{ role: 'user', content: 'operator fixture question' }, { role: 'assistant', content: null, tool_calls: [{ id: record.tool_call_id, type: 'function', function: { name: 'AskUser', arguments: JSON.stringify({ prompt: record.prompt, kind, options: record.options }) } }] }], tool_calls: [], usage: { input: 0, output: 0, cost_usd: 0 }, session_memory: {}, todos: [] }
  const run = { id: runId, user, profile: 'fixture-p', session_id: sessionId, trigger: 'rest', input: 'operator fixture', status: 'waiting_input', started_at: at, updated_at: at }
  const pendingPath = join(fixture.root, '.harness', 'pending', user, `${at.slice(0,10)}_${id}.json`)
  for (const [folder, key, data] of [['sessions', sessionId, session], ['runs', runId, run], ['pending', id, record]] as const) {
    const dir = join(fixture.root, '.harness', folder, user); await mkdir(dir, { recursive: true })
    const path = join(dir, `${at.slice(0,10)}_${key}.json`); await writeFile(path, JSON.stringify(data))
  }
  return { record, pendingPath }
}

test('PT-007: live approval survives event overflow and client navigation; waits for correlated acknowledgment', async ({ page }) => {
  await openOps(page, 'operator-approval')
  await send(page, { type: 'set_approval_mode', mode: 'strict' })
  await send(page, { type: 'message', content: 'CA_AUDIT_A operator approval' })
  const queue = page.locator('.approval-queue')
  await expect(queue.getByRole('button', { name: 'allow', exact: true })).toBeVisible()
  await page.evaluate(() => { for (let i=0;i<280;i++) (window as any).__operator.socket.send(JSON.stringify({ type: 'profiles_list' })) })
  await expect.poll(() => page.evaluate(() => (window as any).__operator.frames.filter((f: any) => f.type === 'profiles').length)).toBeGreaterThan(270)
  await expect(queue.getByText('Bash', { exact: true })).toBeVisible()
  await page.getByRole('link', { name: 'assistant', exact: true }).click()
  await page.getByRole('link', { name: 'ops', exact: true }).click()
  await expect(queue.getByRole('button', { name: 'allow', exact: true })).toBeVisible()
  expect(await page.evaluate(() => (window as any).__operator.count)).toBe(1)
  await page.evaluate(() => { (window as any).__operator.reject = true })
  await queue.getByRole('button', { name: 'allow', exact: true }).click()
  await expect(queue.getByRole('alert')).toContainText('stale or unknown decision id')
  await expect(queue.getByRole('button', { name: 'allow', exact: true })).toBeEnabled()
  await page.evaluate(() => { (window as any).__operator.reject = false; (window as any).__operator.hold = true })
  await queue.getByRole('button', { name: 'allow', exact: true }).click()
  await expect(queue.getByText('Waiting for confirmation…')).toBeVisible()
  await expect(queue.getByRole('button', { name: 'allow', exact: true })).toBeDisabled()
  await expect.poll(() => page.evaluate(() => (window as any).__operator.queue.length)).toBeGreaterThan(0)
  await page.evaluate(() => { const s = (window as any).__operator; s.hold = false; for (const data of s.queue.splice(0)) s.socket.dispatchEvent(new MessageEvent('message', { data })) })
  await expect(queue.getByRole('button', { name: 'allow', exact: true })).not.toBeVisible()
})

test('PT-044: live approval recovers after the controlling browser socket reconnects', async ({ page }) => {
  await openOps(page, 'operator-reconnect-approval')
  await send(page, { type: 'set_approval_mode', mode: 'strict' })
  await send(page, { type: 'message', content: 'CA_AUDIT_A reconnect approval' })
  const queue = page.locator('.approval-queue')
  await expect(queue.getByRole('button', { name: 'allow', exact: true })).toBeVisible()
  await page.evaluate(() => (window as any).__operator.socket.close())
  await expect.poll(() => page.evaluate(() => (window as any).__operator.frames.some((frame: any) => frame.type === 'session_resumed'))).toBe(true)
  await expect(queue.getByRole('button', { name: 'allow', exact: true })).toBeVisible()
  await queue.getByRole('button', { name: 'allow', exact: true }).click()
  await expect(queue.getByRole('button', { name: 'allow', exact: true })).not.toBeVisible()
  await send(page, { type: 'cancel' })
  await expect.poll(() => page.evaluate(() => (window as any).__operator.frames.some((frame: any) => frame.type === 'session_end'))).toBe(true)
})

test('PT-008: out-of-band asks appear; typed answers persist; expired and externally answered asks disappear', async ({ page }) => {
  const user = 'operator-pending'
  await openOps(page, user)
  for (const kind of ['text', 'select', 'multi_select'] as const) {
    const ask = await seedAsk(user, kind)
    const item = page.locator('.inbox article').filter({ hasText: ask.record.prompt })
    await expect(item).toBeVisible({ timeout: 12_000 })
    if (kind === 'text') await item.getByRole('textbox').fill('synthetic answer')
    if (kind === 'select') {
      await item.getByRole('button', { name: 'Send answer' }).click()
      await expect(item.getByRole('alert')).toContainText('Choose')
      await item.getByRole('combobox').selectOption('red')
    }
    if (kind === 'multi_select') await item.getByLabel('blue,green', { exact: true }).check()
    await item.getByRole('button', { name: 'Send answer' }).click()
    await expect.poll(async () => JSON.parse(await readFile(ask.pendingPath, 'utf8')).state).toBe('answered')
    await expect(item).not.toBeVisible({ timeout: 12_000 })
    if (kind === 'multi_select') expect(JSON.parse(await readFile(ask.pendingPath, 'utf8')).answer).toBe('["blue,green"]')
  }
  const external = await seedAsk(user, 'text')
  await expect(page.getByText(external.record.prompt)).toBeVisible({ timeout: 12_000 })
  await writeFile(`${external.pendingPath}.tmp`, JSON.stringify({ ...external.record, state: 'answered', answer: 'external answer', answered_at: new Date().toISOString() }))
  await rename(`${external.pendingPath}.tmp`, external.pendingPath)
  await expect(page.getByText(external.record.prompt)).not.toBeVisible({ timeout: 12_000 })
  await expect(page.locator('.run-board').getByText('completed', { exact: true })).toHaveCount(3, { timeout: 12_000 })
  const expired = await seedAsk(user, 'text', 8000)
  await expect(page.getByText(expired.record.prompt)).toBeVisible({ timeout: 7000 })
  await expect(page.getByText(expired.record.prompt)).not.toBeVisible({ timeout: 12_000 })
})

// Successful channel responses are modeled here; real local server is exercised by other cases.
test('PT-008: channel snapshots refresh without overlapping requests and failed refresh stays explicit', async ({ page }) => {
  let count = 0
  let inFlight = 0
  let overlap = false
  let fail = false
  await page.route('**/channels?*', async route => {
    expect(new URL(route.request().url()).searchParams.get('user')).toBe('operator-channels')
    inFlight++; if (inFlight > 1) overlap = true
    await new Promise(resolve => setTimeout(resolve, 100))
    inFlight--
    if (fail) { await route.fulfill({ status: 503, body: 'unavailable' }); return }
    count++
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ channels: [{ name: `revision-${count}`, binding: 'paired', transport: 'fixture' }] }) })
  })
  await openOps(page, 'operator-channels')
  await expect(page.locator('.channels')).toContainText('revision-')
  const baseline = count
  overlap = false
  await expect.poll(() => count, { timeout: 12_000 }).toBeGreaterThan(baseline)
  fail = true
  await page.getByRole('tab', { name: 'Channels' }).click()
  await expect(page.locator('.unavailable-state')).toContainText('channels: request failed (503)', { timeout: 12_000 })
  fail = false
  const beforeRetry = count
  await page.getByRole('button', { name: 'Retry', exact: true }).click()
  await expect.poll(() => count, { timeout: 12_000 }).toBeGreaterThan(beforeRetry)
  await expect(page.locator('.channels')).toContainText('revision-')
  expect(overlap).toBe(false)
})

test('CA-02: refused approval remains actionable with visible error', async ({ page }) => {
  await openOps(page, 'operator-chat-controls')
  await page.getByRole('link', { name: 'analyst', exact: true }).click()
  await send(page, { type: 'set_approval_mode', mode: 'strict' })
  await send(page, { type: 'message', content: 'CA_AUDIT_B chat approval' })
  const allow = page.getByRole('button', { name: 'Allow (y)', exact: true })
  await expect(allow).toBeVisible()
  await page.evaluate(() => { (window as any).__operator.failType = 'tool_approve' })
  await allow.click()
  await expect(allow).toBeVisible()
  await expect(page.getByText(/CA transport refused/).first()).toBeVisible()
  await page.evaluate(() => { (window as any).__operator.failType = undefined })
  await allow.click()
  await expect(allow).not.toBeVisible()
})

test('CA-02: slow-turn cancel refusal stays busy; retry cancels actual turn', async ({ page }) => {
  await openOps(page, 'operator-cancel')
  await page.getByRole('link', { name: 'analyst', exact: true }).click()
  await page.evaluate(() => { (window as any).__operator.failType = 'cancel' })
  const composer = page.getByPlaceholder('Message harness...')
  await composer.fill('CA_SLOW browser cancellation')
  await composer.press('Enter')
  await page.getByRole('button', { name: 'cancel', exact: true }).click()
  await expect(page.locator('.composer-send-error')).toContainText('CA transport refused')
  await expect(composer).toBeDisabled()
  await page.evaluate(() => { (window as any).__operator.failType = undefined })
  await page.getByRole('button', { name: 'cancel', exact: true }).click()
  await expect(composer).toBeEnabled()
  await expect.poll(() => page.evaluate(() => (window as any).__operator.frames.some((m: any) => m.type === 'session_end'))).toBe(true)
  await page.waitForTimeout(1000)
  await expect(page.getByText('fixture slow complete')).not.toBeVisible()
})
