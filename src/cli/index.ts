import WebSocket from 'ws'
import * as readline from 'readline'
import { homedir, userInfo } from 'os'
import { existsSync } from 'fs'
import { resolve } from 'path'
import { ClientMessage, ServerMessage } from '../types.js'
import pkg from '../../package.json' with { type: 'json' }
import { routingStats } from '../analysis/cli.js'
import { findAuditEntry, listAudit } from '../audit/query.js'
import { undoAuditEntry } from '../audit/undo.js'

if (process.argv.includes('--version') || process.argv.includes('-v')) {
  console.log(`harness ${pkg.version}`)
  process.exit(0)
}

if (process.argv[2] === 'stats' && process.argv[3] === 'routing') {
  try {
    const flagValue = (flag: string) => { const index = process.argv.indexOf(flag); return index >= 0 ? process.argv[index + 1] : undefined }
    const sinceArg = flagValue('--since')
    const stageArg = flagValue('--stage')
    const classArg = flagValue('--class')
    console.log(routingStats({ since: sinceArg && !sinceArg.startsWith('--') ? new Date(sinceArg) : undefined, stage: stageArg && !stageArg.startsWith('--') ? stageArg : undefined, taskClass: classArg && !classArg.startsWith('--') ? classArg : undefined, shadow: process.argv.includes('--shadow') }))
  } catch (error: any) {
    console.error(error.message)
    process.exitCode = 1
  }
  process.exit(0)
}

if (process.argv[2] === 'audit') {
  const toolIndex = process.argv.indexOf('--tool')
  const tool = toolIndex >= 0 ? process.argv[toolIndex + 1] : undefined
  const undoIndex = process.argv.indexOf('--undo')
  if (undoIndex >= 0) {
    const id = process.argv[undoIndex + 1]
    const user = process.env.HARNESS_USER ?? userInfo().username
    const entry = id ? findAuditEntry(user, id) : null
    if (!entry) {
      console.error(id ? `audit entry not found: ${id}` : 'usage: harness audit --undo <entry-id>')
      process.exitCode = 1
    } else if (!entry.undo) {
      console.error(`audit entry ${id} is not undoable`)
      process.exitCode = 1
    } else {
      const candidates = [resolve(homedir(), '.harness', 'profiles', `${entry.profile}.yaml`)]
      const profilePath = candidates.find(existsSync)
      if (entry.undo.kind === 'memory_restore' && !profilePath) {
        console.error(`cannot undo memory entry: profile "${entry.profile}" is unavailable`)
        process.exitCode = 1
      } else {
        console.log(await undoAuditEntry(entry, profilePath ?? ''))
      }
    }
  } else {
    for (const entry of listAudit(undefined, tool)) console.log(JSON.stringify(entry))
  }
  process.exit()
}

const PORT = parseInt(process.env.HARNESS_PORT ?? '7337')
const ws = new WebSocket(`ws://localhost:${PORT}`)

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  terminal: true,
})

const send = (msg: ClientMessage) => ws.send(JSON.stringify(msg))

ws.on('open', () => {
  send({ type: 'hello', user_id: process.env.HARNESS_USER ?? userInfo().username })
  console.log(`Connected to harness (ws://localhost:${PORT})`)
  console.log('Commands: /exit  /cancel  /resume <session-id>')
  prompt()
})

ws.on('message', (raw) => {
  const msg = JSON.parse(raw.toString()) as ServerMessage
  switch (msg.type) {
    case 'token':
      process.stdout.write(msg.content)
      break
    case 'tool_start':
      process.stdout.write(`\n[tool:start] ${msg.name} ${JSON.stringify(msg.input)}\n`)
      break
    case 'tool_end':
      process.stdout.write(`[tool:end] ${msg.name}\n`)
      break
    case 'tool_prompt':
      rl.question(
        `\n[permission] Allow "${msg.name}"?\n  Input: ${JSON.stringify(msg.input)}\n  [y/N] `,
        (ans) => {
          send(
            ans.trim().toLowerCase() === 'y'
              ? { type: 'tool_approve', id: msg.id }
              : { type: 'tool_deny', id: msg.id }
          )
        }
      )
      break
    case 'session_end':
      process.stdout.write(`\n[session: ${msg.sessionId}]\n`)
      prompt()
      break
    case 'session_resumed':
      process.stdout.write(`\n[resumed: ${msg.sessionId}]\n`)
      prompt()
      break
    case 'error':
      process.stdout.write(`\n[error] ${msg.message}\n`)
      prompt()
      break
  }
})

ws.on('close', () => { console.log('\nDisconnected.'); process.exit(0) })
ws.on('error', (e) => { console.error('Connection error:', e.message); process.exit(1) })

function prompt() {
  rl.question('> ', (input) => {
    const trimmed = input.trim()
    if (!trimmed) { prompt(); return }
    if (trimmed === '/exit') { ws.close(); rl.close(); return }
    if (trimmed === '/cancel') { send({ type: 'cancel' }); prompt(); return }
    if (trimmed.startsWith('/resume ')) {
      send({ type: 'resume', sessionId: trimmed.slice(8).trim() })
      return
    }
    send({ type: 'message', content: trimmed })
  })
}
