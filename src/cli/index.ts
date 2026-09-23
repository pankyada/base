import WebSocket from 'ws'
import * as readline from 'readline'
import { userInfo } from 'os'
import { ClientMessage, ServerMessage } from '../types.js'
import pkg from '../../package.json' with { type: 'json' }
import { routingStats } from '../analysis/cli.js'
import { runAuditCommand } from './audit.js'
import { runDoctorCommand } from './doctor.js'
import { runInit } from './init.js'
import { runServerCommand } from './server.js'
import { runMissionCommand } from './missions.js'
import { runReplayCommand } from './replay.js'
import { runEvaluationCommand, runEvaluationCommandAsync } from './evaluation.js'
import { runAuthCommand } from './auth.js'

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
    console.log(routingStats({
      since: sinceArg && !sinceArg.startsWith('--') ? new Date(sinceArg) : undefined,
      stage: stageArg && !stageArg.startsWith('--') ? stageArg : undefined,
      taskClass: classArg && !classArg.startsWith('--') ? classArg : undefined,
      shadow: process.argv.includes('--shadow'),
      suggest: process.argv.includes('--suggest'),
      json: process.argv.includes('--json'),
    }))
  } catch (error: any) {
    console.error(error.message)
    process.exitCode = 1
  }
  process.exit(0)
}

if (process.argv[2] === 'audit') {
  process.exitCode = await runAuditCommand(process.argv.slice(3))
  process.exit()
}

if (process.argv[2] === 'doctor') {
  process.exitCode = await runDoctorCommand(process.argv.slice(3))
  process.exit()
}

if (process.argv[2] === 'auth') {
  process.exitCode = await runAuthCommand(process.argv.slice(3))
  process.exit()
}

if (process.argv[2] === 'init') {
  process.exitCode = await runInit(process.argv.slice(3))
  process.exit()
}

if (process.argv[2] === 'server') {
  process.exitCode = await runServerCommand(process.argv.slice(3))
  process.exit()
}

if (process.argv[2] === 'mission') {
  process.exitCode = runMissionCommand(process.argv.slice(3))
  process.exit()
}

if (process.argv[2] === 'replay') {
  process.exitCode = await runReplayCommand(process.argv.slice(3))
  process.exit()
}

if (process.argv[2] === 'evaluation' || process.argv[2] === 'eval') {
  process.exitCode = await runEvaluationCommandAsync(process.argv.slice(3))
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
  send({ type: 'hello', user_id: process.env.HARNESS_USER ?? userInfo().username, protocol_version: 2 })
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
